// Placeholder typed schema for the supabase-js generic.
// Run `pnpm supabase gen types typescript --linked > apps/web/lib/db/database.types.ts`
// once your Supabase project is linked to replace this with the real one.
//
// Note: supabase-js's GenericTable requires {Row, Insert, Update, Relationships}
// and GenericSchema requires {Tables, Views, Functions}. Missing any of those
// keys collapses the whole schema to `never` and every typed call returns
// `unknown` — silent failure that's annoying to debug.

import type {
  BrowseGrant,
  BrowseSort,
  Company,
  CompanyHit,
  CompanyNameHit,
  CompanyTotals,
  FilterFacet,
  FundingProgram,
  Grant,
  GrantChunkKind,
  GrantPartner,
  OrgType,
  StatsByProgram,
  StatsByProvince,
  StatsByYear,
} from "./types";

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

type GrantChunkRow = {
  id: string;
  grant_id: string | null;
  company_id: string;
  kind: GrantChunkKind;
  content: string;
  embedding: number[] | null;
  source_url: string | null;
  created_at: string;
};

type SearchLogRow = {
  id: string;
  query: string;
  org_filter: string | null;
  result_count: number | null;
  ip: string | null;
  created_at: string;
};

// --- "Am I Competitive?" section (migration 0006) -------------------------

type TalentCohortRow = {
  id: string;
  company_name: string;
  company_norm: string;
  company_linkedin_url: string | null;
  role_query: string;
  normalized_role: string;
  source: string;
  apify_run_id: string | null;
  status: "pending" | "ready" | "failed";
  profile_count: number;
  error: string | null;
  fetched_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type TalentProfileRow = {
  id: string;
  cohort_id: string;
  full_name: string;
  headline: string | null;
  linkedin_url: string | null;
  location: string | null;
  current_title: string | null;
  current_company: string | null;
  summary: string | null;
  skills: string[];
  experience: unknown;
  education: unknown;
  years_experience: number | null;
  embedding: number[] | null;
  raw: unknown;
  created_at: string;
};

type CompeteLogRow = {
  id: string;
  company: string | null;
  role: string | null;
  verdict: string | null;
  ip: string | null;
  created_at: string;
};

// --- "Engineers" section (migration 0007) ---------------------------------

type EngineerDirectoryRow = {
  id: string;
  company_id: string | null;
  company_name: string;
  company_norm: string;
  source: "org" | "search";
  github_org: string | null;
  status: "pending" | "ready" | "failed";
  engineer_count: number;
  error: string | null;
  fetched_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type EngineerRow = {
  id: string;
  directory_id: string;
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
  raw: unknown;
  created_at: string;
};

type EngineersLogRow = {
  id: string;
  company: string | null;
  source: string | null;
  ip: string | null;
  created_at: string;
};

// --- Canadian GitHub people pool (migration 0009) -------------------------

type GhPersonRow = {
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  html_url: string | null;
  bio: string | null;
  company: string | null;
  company_norm: string | null;
  mapped_company_id: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  public_repos: number;
  top_languages: string[];
  hireable: boolean | null;
  source_shard: string | null;
  fetched_at: string;
};

type GhPeopleShardRow = {
  shard: string;
  city: string | null;
  language: string | null;
  page: number | null;
  total_count: number | null;
  found: number | null;
  done_at: string;
};

export type Database = {
  public: {
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Tables: {
      funding_programs: Table<FundingProgram>;
      companies:        Table<Company>;
      grants:           Table<Grant>;
      grant_partners:   Table<GrantPartner>;
      grant_chunks:     Table<GrantChunkRow>;
      search_log:       Table<SearchLogRow>;
      talent_cohorts:   Table<TalentCohortRow>;
      talent_profiles:  Table<TalentProfileRow>;
      compete_log:      Table<CompeteLogRow>;
      engineer_directories: Table<EngineerDirectoryRow>;
      engineers:        Table<EngineerRow>;
      engineers_log:    Table<EngineersLogRow>;
      gh_people:        Table<GhPersonRow>;
      gh_people_shards: Table<GhPeopleShardRow>;
    };
    Functions: {
      search_companies: {
        Args: {
          query_embedding: number[];
          query_text: string;
          match_count?: number;
          org_filter?: OrgType | null;
          province_filter?: string | null;
          program_codes?: string[] | null;
          min_start_date?: string | null;
          max_start_date?: string | null;
          min_amount?: number | null;
          max_amount?: number | null;
        };
        Returns: CompanyHit[];
      };
      company_totals: {
        Args: { company_id_in: string };
        Returns: CompanyTotals[];
      };
      browse_grants: {
        Args: {
          province_filter?: string | null;
          program_codes?: string[] | null;
          org_filter?: OrgType | null;
          min_start_date?: string | null;
          max_start_date?: string | null;
          min_amount?: number | null;
          max_amount?: number | null;
          sort_by?: BrowseSort;
          page_limit?: number;
          page_offset?: number;
        };
        Returns: BrowseGrant[];
      };
      list_filter_facets: {
        Args: Record<string, never>;
        Returns: FilterFacet[];
      };
      stats_by_program: {
        Args: { min_start_date?: string | null; max_start_date?: string | null };
        Returns: StatsByProgram[];
      };
      stats_by_province: {
        Args: { min_start_date?: string | null; max_start_date?: string | null };
        Returns: StatsByProvince[];
      };
      stats_by_year: {
        Args: { min_start_date?: string | null; max_start_date?: string | null };
        Returns: StatsByYear[];
      };
      search_companies_by_name: {
        Args: {
          q: string;
          max_results?: number;
          min_similarity?: number;
        };
        Returns: CompanyNameHit[];
      };
      recent_search_count: {
        Args: { ip_in: string; window_hours?: number };
        Returns: number;
      };
      next_engineer_crawl_batch: {
        Args: { max_companies?: number; batch_size?: number };
        Returns: Array<{
          id: string;
          display_name: string;
          province: string | null;
          city: string | null;
          website: string | null;
        }>;
      };
    };
  };
};
