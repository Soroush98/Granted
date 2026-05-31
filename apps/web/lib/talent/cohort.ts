import "server-only";
import { env } from "@/lib/env";
import { supabaseService } from "@/lib/db/supabase-server";
import { embedDocuments } from "@/lib/ai/embeddings";
import { getProvider } from "./provider";
import { normalizeKey, profileEmbedText } from "./normalize";
import type { Cohort, RawProfile, TalentProfile } from "./types";

const COHORT_SIZE = 20;

export type CohortResult = {
  cohort: Cohort;
  profiles: TalentProfile[];
  cached: boolean;
};

/**
 * Resolve a cohort for (company, role): serve from cache when a non-expired,
 * ready cohort exists, otherwise fetch from the provider, embed every profile
 * with Voyage, persist, and return.
 *
 * Caching is the cost lever — a cache hit means zero provider spend. The
 * cohort row's unique (company_norm, normalized_role) key dedupes concurrent
 * first-time requests at the DB level.
 */
export async function getOrFetchCohort(
  company: string,
  role: string,
): Promise<CohortResult> {
  const supabase = supabaseService();
  const companyNorm = normalizeKey(company);
  const roleNorm = normalizeKey(role);

  // 1. Cache lookup.
  const { data: existing } = await supabase
    .from("talent_cohorts")
    .select("*")
    .eq("company_norm", companyNorm)
    .eq("normalized_role", roleNorm)
    .maybeSingle();

  const fresh =
    existing?.status === "ready" &&
    existing.expires_at !== null &&
    new Date(existing.expires_at).getTime() > Date.now();

  if (existing && fresh) {
    const profiles = await loadProfiles(existing.id);
    if (profiles.length > 0) {
      return { cohort: toCohort(existing), profiles, cached: true };
    }
    // Row says ready but profiles vanished (manual delete?) — fall through to refetch.
  }

  // 2. Reserve / refresh the cohort row (status pending).
  const { data: reserved, error: upErr } = await supabase
    .from("talent_cohorts")
    .upsert(
      {
        company_name: company,
        company_norm: companyNorm,
        role_query: role,
        normalized_role: roleNorm,
        source: getProvider().name,
        status: "pending",
        error: null,
      },
      { onConflict: "company_norm,normalized_role" },
    )
    .select("*")
    .single();
  if (upErr || !reserved) {
    throw new Error(`Failed to reserve cohort: ${upErr?.message ?? "no row"}`);
  }

  try {
    // 3. Fetch from provider (the slow / paid step) + embed.
    const raw = await getProvider().fetchCohort(company, role, COHORT_SIZE);
    if (raw.length === 0) throw new Error("Provider returned an empty cohort.");

    const embeddings = await embedDocuments(raw.map(profileEmbedText));

    // 4. Replace any stale profiles, insert the fresh set.
    await supabase.from("talent_profiles").delete().eq("cohort_id", reserved.id);
    const rows = raw.map((p, i) => profileToRow(reserved.id, p, embeddings[i]));
    const { data: inserted, error: insErr } = await supabase
      .from("talent_profiles")
      .insert(rows)
      .select("*");
    if (insErr || !inserted) {
      throw new Error(`Failed to insert profiles: ${insErr?.message ?? "no rows"}`);
    }

    // 5. Mark ready.
    const now = new Date();
    const expires = new Date(now.getTime() + env.COHORT_TTL_DAYS * 86_400_000);
    const { data: ready } = await supabase
      .from("talent_cohorts")
      .update({
        status: "ready",
        profile_count: inserted.length,
        fetched_at: now.toISOString(),
        expires_at: expires.toISOString(),
        error: null,
      })
      .eq("id", reserved.id)
      .select("*")
      .single();

    return {
      cohort: toCohort(ready ?? { ...reserved, status: "ready" }),
      profiles: inserted.map(rowToProfile),
      cached: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("talent_cohorts")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", reserved.id);
    throw e;
  }
}

async function loadProfiles(cohortId: string): Promise<TalentProfile[]> {
  const supabase = supabaseService();
  const { data } = await supabase
    .from("talent_profiles")
    .select("*")
    .eq("cohort_id", cohortId);
  return (data ?? []).map(rowToProfile);
}

// --- row <-> domain mapping ------------------------------------------------

function profileToRow(cohortId: string, p: RawProfile, embedding: number[] | undefined) {
  return {
    cohort_id: cohortId,
    full_name: p.full_name,
    headline: p.headline,
    linkedin_url: p.linkedin_url,
    location: p.location,
    current_title: p.current_title,
    current_company: p.current_company,
    summary: p.summary,
    skills: p.skills,
    experience: p.experience,
    education: p.education,
    years_experience: p.years_experience,
    embedding: embedding ?? null,
    raw: p.raw,
  };
}

function rowToProfile(r: Record<string, unknown>): TalentProfile {
  return {
    id: r.id as string,
    cohort_id: r.cohort_id as string,
    full_name: r.full_name as string,
    headline: (r.headline as string) ?? null,
    linkedin_url: (r.linkedin_url as string) ?? null,
    location: (r.location as string) ?? null,
    current_title: (r.current_title as string) ?? null,
    current_company: (r.current_company as string) ?? null,
    summary: (r.summary as string) ?? null,
    skills: Array.isArray(r.skills) ? (r.skills as string[]) : [],
    experience: Array.isArray(r.experience) ? (r.experience as TalentProfile["experience"]) : [],
    education: Array.isArray(r.education) ? (r.education as TalentProfile["education"]) : [],
    years_experience: (r.years_experience as number) ?? null,
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    raw: r.raw,
  };
}

function toCohort(r: Record<string, unknown>): Cohort {
  return {
    id: r.id as string,
    company_name: r.company_name as string,
    role_query: r.role_query as string,
    status: r.status as Cohort["status"],
    profile_count: (r.profile_count as number) ?? 0,
    fetched_at: (r.fetched_at as string) ?? null,
    expires_at: (r.expires_at as string) ?? null,
  };
}
