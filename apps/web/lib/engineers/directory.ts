import "server-only";
import { env } from "@/lib/env";
import { supabaseService } from "@/lib/db/supabase-server";
import { resolveEngineers } from "./resolve";
import type {
  Engineer,
  EngineerSource,
  PublicEngineer,
  ResolvedCompany,
  StoredEngineer,
} from "./types";

const DIRECTORY_SIZE = 24;

export type DirectoryResult = {
  source: EngineerSource;
  github_org: string | null;
  engineers: PublicEngineer[];
  cached: boolean;
};

/**
 * Resolve a company's engineer directory: serve from cache when a non-expired,
 * ready directory exists, otherwise fetch from the GitHub API, persist, and
 * return.
 *
 * Persistence is best-effort. The engineer_* tables come from migration 0007,
 * which this project applies by hand; until it lands, every DB call here fails
 * and we transparently fall back to a live GitHub fetch (cached: false) with no
 * caching. Once the migration is applied, the same code starts caching.
 */
export async function getOrFetchDirectory(
  company: ResolvedCompany,
): Promise<DirectoryResult> {
  const supabase = supabaseService();
  const companyNorm = normKey(company.display_name);

  // 1. Cache lookup (best-effort — missing table just misses).
  const existing = await tryQuery(() =>
    supabase
      .from("engineer_directories")
      .select("*")
      .eq("company_norm", companyNorm)
      .maybeSingle(),
  );
  const fresh =
    existing?.status === "ready" &&
    existing.expires_at !== null &&
    new Date(existing.expires_at).getTime() > Date.now();

  if (existing && fresh) {
    const engineers = await loadEngineers(existing.id);
    if (engineers.length > 0) {
      return {
        source: existing.source,
        github_org: existing.github_org,
        engineers: engineers.map(toPublic),
        cached: true,
      };
    }
    // Row says ready but engineers vanished — fall through to refetch.
  }

  // 2. Reserve / refresh the directory row (status pending). If this fails the
  //    cache tables aren't there; remember that so we skip all later writes.
  const reserved = await tryQuery(() =>
    supabase
      .from("engineer_directories")
      .upsert(
        {
          company_id: company.id,
          company_name: company.display_name,
          company_norm: companyNorm,
          source: "search",
          status: "pending",
          error: null,
        },
        { onConflict: "company_norm" },
      )
      .select("*")
      .single(),
  );
  const persist = reserved !== null;

  try {
    // 3. Fetch from the GitHub API (the slow step). An empty result is a valid,
    //    cacheable outcome — the company simply has no public GitHub engineers —
    //    not an error, so it's stored 'ready' with count 0 and skipped until TTL.
    const { source, github_org, engineers } = await resolveEngineers(
      company,
      DIRECTORY_SIZE,
    );

    if (!persist) {
      // No cache available — return the freshly fetched set directly.
      return {
        source,
        github_org,
        engineers: engineers.map((e) => toPublic({ ...e, id: e.login })),
        cached: false,
      };
    }

    // 4. Replace any stale engineers, insert the fresh set (skip if empty).
    await supabase.from("engineers").delete().eq("directory_id", reserved.id);
    let inserted: Record<string, unknown>[] | null = [];
    if (engineers.length > 0) {
      const rows = engineers.map((e) => ({ directory_id: reserved.id, ...stripRaw(e), raw: e.raw }));
      ({ data: inserted } = await supabase.from("engineers").insert(rows).select("*"));
    }

    // 5. Mark ready.
    const now = new Date();
    const expires = new Date(now.getTime() + env.ENGINEERS_TTL_DAYS * 86_400_000);
    await supabase
      .from("engineer_directories")
      .update({
        source,
        github_org,
        status: "ready",
        engineer_count: inserted?.length ?? engineers.length,
        fetched_at: now.toISOString(),
        expires_at: expires.toISOString(),
        error: null,
      })
      .eq("id", reserved.id);

    const stored: StoredEngineer[] = (inserted ?? []).map(rowToEngineer);
    return {
      source,
      github_org,
      engineers: (stored.length ? stored : engineers.map((e) => ({ ...e, id: e.login }))).map(
        toPublic,
      ),
      cached: false,
    };
  } catch (e) {
    if (persist) {
      const message = e instanceof Error ? e.message : String(e);
      await tryQuery(() =>
        supabase
          .from("engineer_directories")
          .update({ status: "failed", error: message.slice(0, 500) })
          .eq("id", reserved.id),
      );
    }
    throw e;
  }
}

async function loadEngineers(directoryId: string): Promise<StoredEngineer[]> {
  const supabase = supabaseService();
  const data = await tryQuery(() =>
    supabase
      .from("engineers")
      .select("*")
      .eq("directory_id", directoryId)
      .order("followers", { ascending: false }),
  );
  return (data ?? []).map(rowToEngineer);
}

/** Run a supabase query, returning its data or null on any error (e.g. the
 * engineer_* tables not existing yet). Keeps caching strictly best-effort. */
async function tryQuery<T>(
  run: () => PromiseLike<{ data: T; error: unknown }>,
): Promise<T | null> {
  try {
    const { data, error } = await run();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// --- row <-> domain mapping ------------------------------------------------

function stripRaw(e: Engineer) {
  return {
    github_id: e.github_id,
    login: e.login,
    name: e.name,
    avatar_url: e.avatar_url,
    html_url: e.html_url,
    bio: e.bio,
    company: e.company,
    location: e.location,
    blog: e.blog,
    followers: e.followers,
    public_repos: e.public_repos,
    top_languages: e.top_languages,
    hireable: e.hireable,
  };
}

function rowToEngineer(r: Record<string, unknown>): StoredEngineer {
  return {
    id: r.id as string,
    github_id: r.github_id as number,
    login: r.login as string,
    name: (r.name as string) ?? null,
    avatar_url: (r.avatar_url as string) ?? null,
    html_url: (r.html_url as string) ?? null,
    bio: (r.bio as string) ?? null,
    company: (r.company as string) ?? null,
    location: (r.location as string) ?? null,
    blog: (r.blog as string) ?? null,
    followers: (r.followers as number) ?? 0,
    public_repos: (r.public_repos as number) ?? 0,
    top_languages: Array.isArray(r.top_languages) ? (r.top_languages as string[]) : [],
    hireable: (r.hireable as boolean) ?? null,
    raw: r.raw,
  };
}

/** Drop the server-only `raw` payload so an engineer is safe to send down. */
function toPublic(e: StoredEngineer): PublicEngineer {
  return {
    id: e.id,
    github_id: e.github_id,
    login: e.login,
    name: e.name,
    avatar_url: e.avatar_url,
    html_url: e.html_url,
    bio: e.bio,
    company: e.company,
    location: e.location,
    blog: e.blog,
    followers: e.followers,
    public_repos: e.public_repos,
    top_languages: e.top_languages,
    hireable: e.hireable,
  };
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
