// Domain types for the "Engineers" section: GitHub-sourced engineers at a
// Canadian company. DB-row shapes live in lib/db/database.types.ts; these are
// the richer types the engineers pipeline passes around, plus the plain-JSON
// payload the /explore page hands to the client.

/** How a directory's engineers were sourced. `org` = a GitHub org's public
 * members; `search` = users whose profile `company` field names the company. */
export type EngineerSource = "org" | "search";

/** One engineer, normalized from the GitHub API. Public profile fields only;
 * the untouched API payload (`raw`) stays server-side for debugging. */
export type Engineer = {
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  html_url: string | null;
  bio: string | null;
  /** The free-text `company` field on their GitHub profile (e.g. "@shopify"). */
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  public_repos: number;
  /** Most-used languages across their recent repos, most frequent first. */
  top_languages: string[];
  hireable: boolean | null;
  /** Untouched GitHub payload, server-only. Never crosses to the client. */
  raw: unknown;
};

/** An engineer after persistence — gains a DB id. */
export type StoredEngineer = Engineer & { id: string };

export type DirectoryStatus = "pending" | "ready" | "failed";

/** The Canadian company a directory is pinned to, resolved from the
 * `companies` table (so the section only ever shows funded-R&D Canadian orgs). */
export type ResolvedCompany = {
  id: string;
  display_name: string;
  province: string | null;
  city: string | null;
  website: string | null;
};

/** An engineer stripped to the fields that cross to the client. Identical to
 * Engineer minus `raw`; carries a stable `id` for React keys / selection. */
export type PublicEngineer = {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  html_url: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  public_repos: number;
  top_languages: string[];
  hireable: boolean | null;
};

/** Payload the /explore (Engineers) page hands to the client. Plain JSON only. */
export type EngineersData = {
  ok: true;
  company: ResolvedCompany;
  source: EngineerSource;
  github_org: string | null;
  count: number;
  cached: boolean;
  engineers: PublicEngineer[];
};

export type EngineersOutcome = EngineersData | { ok: false; error: string };
