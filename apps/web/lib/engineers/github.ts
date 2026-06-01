import "server-only";
import { env } from "@/lib/env";
import { corroboratedByMembers, loginRelatesToCompany, orgConfirmed } from "./names";
import type { Engineer } from "./types";

/** Raw shapes we read off the GitHub REST API (only the fields we use). */
type GhUser = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  html_url?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  followers?: number | null;
  public_repos?: number | null;
  hireable?: boolean | null;
};
type GhSearchUsers = { total_count: number; items: Array<{ login: string }> };
type GhSearchOrgs = {
  total_count: number;
  items: Array<{ login: string; type?: string }>;
};
type GhOrg = { login: string; blog?: string | null; name?: string | null };
type GhRepo = { fork?: boolean; language?: string | null };

/** Thin GitHub REST client. Centralizes auth, the version header, error
 * surfacing, and retry/backoff on transient (429 / 5xx / abuse) responses.
 *
 * GitHub is free but rate-limited: 5000 core req/hr and 30 search req/min on a
 * token. Directories are cached (see directory.ts) so this only runs on a miss.
 */
export class GitHubClient {
  private readonly base = env.GITHUB_API_BASE;
  private readonly token: string;

  constructor() {
    if (!env.GITHUB_TOKEN) {
      throw new Error(
        "GITHUB_TOKEN is unset. Add a GitHub token to apps/web/.env.local " +
          "(a classic PAT with no scopes is enough for public data).",
      );
    }
    this.token = env.GITHUB_TOKEN;
  }

  /** Resolve a company to a GitHub org and return its public members as full
   * Engineer records, or null when no org credibly matches.
   *
   * A single org rarely has the exact company name as its login — Amii's real
   * org is `AmiiThinks`, Cohere's is `Cohere-Labs-Community`. So we search orgs,
   * loosely pre-filter the hits by login, then CONFIRM each survivor against its
   * real display name (orgConfirmed) or a website-domain match before trusting
   * it — this is what keeps "Qube"→QubesOS, "ICES"→ICESat-2 and similar
   * coincidences out. Among confirmed orgs with public members, the one with the
   * most members wins (a domain match wins outright). Returns null if none
   * confirm, letting the caller fall back to user search. */
  async resolveOrgMembers(
    company: string,
    website: string | null,
    limit: number,
  ): Promise<{ login: string; engineers: Engineer[] } | null> {
    const q = `${quote(company)} type:org`;
    const res = await this.get<GhSearchOrgs>(
      `/search/users?q=${encodeURIComponent(q)}&per_page=8`,
    );
    const candidates = (res?.items ?? [])
      .filter((i) => i.type !== "User" && loginRelatesToCompany(i.login, company))
      .slice(0, 6);
    if (candidates.length === 0) return null;

    const wantDomain = domainOf(website);
    let best: { login: string; logins: string[] } | null = null;

    for (const c of candidates) {
      // Confirm the candidate really is this company before counting members.
      const org = await this.get<GhOrg>(`/orgs/${encodeURIComponent(c.login)}`);
      if (!org) continue;
      const domainOk = wantDomain !== null && domainOf(org.blog) === wantDomain;
      if (!domainOk && !orgConfirmed(company, c.login, org.name ?? null)) continue;

      const logins = await this.publicMemberLogins(c.login, limit);
      if (logins.length === 0) continue;
      if (domainOk) {
        best = { login: c.login, logins };
        break; // strongest possible signal
      }
      if (!best || logins.length > best.logins.length) best = { login: c.login, logins };
    }
    if (!best) return null;

    const engineers = await this.hydrate(best.logins.slice(0, limit));
    if (engineers.length === 0) return null;
    // Final gate: members must corroborate the company (kills name collisions
    // like IBM's carbon-design-system for "Carbon").
    if (!corroboratedByMembers(company, engineers)) return null;
    return { login: best.login, engineers };
  }

  /** Public member logins of an org (empty when membership is private). Uses
   * /public_members so an unscoped token still works. */
  private async publicMemberLogins(org: string, limit: number): Promise<string[]> {
    const members = await this.get<Array<{ login: string }>>(
      `/orgs/${encodeURIComponent(org)}/public_members?per_page=${Math.min(100, limit)}`,
    );
    return (members ?? []).map((m) => m.login);
  }

  /** Users whose profile `company` field names the company, hydrated to full
   * Engineer records. The company is Canadian by construction (resolved from the
   * companies table), so we don't force a location qualifier. */
  async searchEngineers(company: string, limit: number): Promise<Engineer[]> {
    const q = `company:${quote(company)} type:user`;
    const res = await this.get<GhSearchUsers>(
      `/search/users?q=${encodeURIComponent(q)}&per_page=${Math.min(100, limit)}`,
    );
    const logins = (res?.items ?? []).map((i) => i.login).slice(0, limit);
    return this.hydrate(logins);
  }

  /** One page (≤100) of a user search, most-followed first, with the shard's
   * total. Used by the person-pool crawl to shard location:<city> language:<lang>.
   * GitHub caps retrieval at 1000 (10 pages) regardless of total_count. */
  async searchUserLogins(
    query: string,
    page: number,
  ): Promise<{ logins: string[]; total: number }> {
    const res = await this.get<GhSearchUsers>(
      `/search/users?q=${encodeURIComponent(query)}&per_page=100&page=${page}` +
        `&sort=followers&order=desc`,
    );
    return { logins: (res?.items ?? []).map((i) => i.login), total: res?.total_count ?? 0 };
  }

  /** Public wrapper over hydrate() for the person-pool crawl. */
  async hydratePeople(logins: string[]): Promise<Engineer[]> {
    return this.hydrate(logins);
  }

  /** Fetch each login's full profile + top languages, dropping any that fail.
   * Order is preserved (logins arrive ranked by GitHub relevance). Concurrency
   * is capped so a directory's ~24 logins don't burst ~48 parallel requests and
   * trip GitHub's secondary rate limit — important under a sustained crawl. */
  private async hydrate(logins: string[]): Promise<Engineer[]> {
    const out: Array<Engineer | null> = new Array(logins.length).fill(null);
    const CONCURRENCY = 6;
    let next = 0;
    const worker = async () => {
      while (next < logins.length) {
        const i = next++;
        const login = logins[i]!;
        const user = await this.get<GhUser>(`/users/${encodeURIComponent(login)}`);
        if (!user) continue;
        out[i] = toEngineer(user, await this.topLanguages(login));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out.filter((e): e is Engineer => e !== null);
  }

  /** The engineer's most-used languages across their recent non-fork repos. */
  private async topLanguages(login: string): Promise<string[]> {
    const repos = await this.get<GhRepo[]>(
      `/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=30`,
    );
    const counts = new Map<string, number>();
    for (const r of repos ?? []) {
      if (r.fork || !r.language) continue;
      counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang);
  }

  /** GET a path, returning parsed JSON or null on 404. Retries transient 429 /
   * 5xx with exponential backoff; throws on other 4xx so config errors surface. */
  private async get<T>(path: string): Promise<T | null> {
    const url = `${this.base}${path}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "granted-engineers",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404) return null;
        // Rate limiting: primary (403/429 + x-ratelimit-remaining: 0) and
        // secondary/abuse (403/429 + retry-after) are both retryable. Wait the
        // server-indicated time (capped so one stuck call can't hang a crawl),
        // and let the crawl's own pacer keep us under budget proactively.
        const limited =
          (res.status === 403 || res.status === 429) &&
          (res.headers.get("x-ratelimit-remaining") === "0" ||
            res.headers.has("retry-after"));
        if (limited) {
          await sleep(rateLimitWaitMs(res.headers));
          continue;
        }
        if (res.status >= 500) throw new Error(`retryable GitHub ${res.status}`);
        if (!res.ok) {
          throw new Error(`GitHub ${path} failed: ${res.status} ${await res.text()}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.message.includes("failed:")) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`GitHub ${path} failed after retries: ${String(lastErr)}`);
  }

  /** Current core rate-limit budget, for a crawl to pace itself. Reading
   * /rate_limit doesn't count against any limit. */
  async rateLimit(): Promise<{ remaining: number; resetMs: number }> {
    const r = await this.get<{
      resources: { core: { remaining: number; reset: number } };
    }>("/rate_limit");
    const core = r?.resources?.core;
    return {
      remaining: core?.remaining ?? 0,
      resetMs: core ? core.reset * 1000 : Date.now(),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** Milliseconds to wait from a rate-limited response: prefer `retry-after`
 * (seconds), else time until `x-ratelimit-reset` (epoch seconds). Capped at 60s
 * per wait — the crawl pacer handles longer primary-limit windows. */
function rateLimitWaitMs(headers: Headers): number {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 60) * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 1000), 60_000);
  }
  return 5000;
}

function toEngineer(u: GhUser, top_languages: string[]): Engineer {
  return {
    github_id: u.id,
    login: u.login,
    name: u.name ?? null,
    avatar_url: u.avatar_url ?? null,
    html_url: u.html_url ?? null,
    bio: u.bio ?? null,
    company: u.company ?? null,
    location: u.location ?? null,
    blog: u.blog && u.blog.trim() ? u.blog.trim() : null,
    followers: u.followers ?? 0,
    public_repos: u.public_repos ?? 0,
    top_languages,
    hireable: u.hireable ?? null,
    raw: u,
  };
}

/** Wrap a phrase in quotes for GitHub's search grammar when it has spaces. */
function quote(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

/** Bare registrable-ish domain from a URL or host string (drops scheme + www). */
function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}
