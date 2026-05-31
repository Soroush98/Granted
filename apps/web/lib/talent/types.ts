// Domain types for the "Am I Competitive?" section. DB-row shapes live in
// lib/db/database.types.ts (so the typed supabase client knows them); these are
// the richer types the talent pipeline passes around.

/** Normalized profile produced by a ProfileProvider, before it gets an
 * embedding and a DB id. Provider-agnostic — ApifyProvider and MockProvider
 * both emit this shape via lib/talent/normalize.ts. */
export type RawProfile = {
  full_name: string;
  headline: string | null;
  linkedin_url: string | null;
  location: string | null;
  current_title: string | null;
  current_company: string | null;
  summary: string | null;
  skills: string[];
  /** Free-form experience entries; kept as-is for the cohort summary. */
  experience: Array<{ title?: string; company?: string; duration?: string }>;
  education: Array<{ school?: string; degree?: string; field?: string }>;
  years_experience: number | null;
  /** Untouched provider payload, for debugging only. Never rendered. */
  raw: unknown;
};

/** A cohort profile after embedding + persistence. */
export type TalentProfile = RawProfile & {
  id: string;
  cohort_id: string;
  embedding: number[] | null;
};

export type CohortStatus = "pending" | "ready" | "failed";

export type Cohort = {
  id: string;
  company_name: string;
  role_query: string;
  status: CohortStatus;
  profile_count: number;
  fetched_at: string | null;
  expires_at: string | null;
};

/** Aggregate stats the verdict LLM sees instead of 20 raw profiles — keeps the
 * call cheap and grounded. */
export type CohortSummary = {
  profile_count: number;
  median_years_experience: number | null;
  top_skills: Array<{ skill: string; count: number }>;
  common_prior_companies: Array<{ company: string; count: number }>;
  common_schools: Array<{ school: string; count: number }>;
};

export type VerdictLabel = "competitive" | "borderline" | "not_yet";

/** Strict-JSON output from the Claude verdict call. */
export type Verdict = {
  verdict: VerdictLabel;
  score: number; // 0..1
  strengths: string[];
  gaps: string[];
  summary: string;
};

/** The most-similar real person, surfaced when the verdict isn't "not_yet". */
export type MostSimilar = {
  full_name: string;
  headline: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  location: string | null;
  similarity: number; // cosine 0..1
  rationale: string;
};

export type CompeteResult = {
  ok: true;
  company: string;
  role: string;
  cohort_size: number;
  cohort_summary: CohortSummary;
  verdict: Verdict;
  percentile: number; // user's cosine percentile within the cohort, 0..100
  most_similar: MostSimilar | null; // null when verdict is "not_yet"
  cached: boolean; // true when the cohort came from cache (no provider spend)
};

export type CompeteOutcome =
  | CompeteResult
  | { ok: false; error: string };
