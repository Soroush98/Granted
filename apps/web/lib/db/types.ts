// Hand-written types matching supabase/migrations/0005_granted_v0.sql.
// Regenerate via `supabase gen types typescript` once the project is linked.

export type OrgType = "company" | "university" | "research_institute" | "nonprofit" | "government" | "other";

export type GrantChunkKind = "grant_title" | "grant_description" | "company_summary";

export type FundingProgram = {
  id: string;
  code: string;
  name: string;
  agency: string;
  description: string | null;
  homepage: string | null;
  created_at: string;
};

export type Company = {
  id: string;
  display_name: string;
  legal_name: string | null;
  normalized_name: string;
  org_type: OrgType;
  province: string | null;
  city: string | null;
  website: string | null;
  description: string | null;
  sectors: string[];
  created_at: string;
  updated_at: string;
};

export type Grant = {
  id: string;
  program_id: string;
  recipient_id: string;
  title: string | null;
  description: string | null;
  amount_cad: number | null;
  start_date: string | null;
  end_date: string | null;
  fiscal_year: string | null;
  award_id: string | null;
  source_url: string | null;
  raw: unknown;
  created_at: string;
};

export type GrantPartner = {
  grant_id: string;
  company_id: string;
  role: string | null;
};

// One row from the search_companies RPC.
export type CompanyHit = {
  company_id: string;
  best_chunk_id: string;
  best_chunk: string;
  best_grant_id: string | null;
  vector_score: number;
  fts_score: number;
  hybrid_score: number;
};

// One row from the company_totals RPC.
export type CompanyTotals = {
  total_cad: number;
  grant_count: number;
  program_count: number;
  first_award: string | null;
  last_award: string | null;
};

// Structured filters that the extended search_companies RPC accepts.
// All fields optional — null/undefined means "no filter on that dimension".
export type SearchFilters = {
  orgFilter?: OrgType | null;
  province?: string | null;
  programCodes?: string[] | null;
  minStartDate?: string | null;
  maxStartDate?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
};

// One row from browse_grants(). total_count is window-aggregated so the
// caller can paginate without a separate count() round-trip.
export type BrowseGrant = {
  grant_id: string;
  title: string | null;
  amount_cad: number | null;
  start_date: string | null;
  fiscal_year: string | null;
  program_code: string;
  program_name: string;
  company_id: string;
  company_name: string;
  org_type: OrgType;
  city: string | null;
  province: string | null;
  total_count: number;
};

export type BrowseSort = "recent" | "amount" | "amount_desc";

export type FilterFacet = {
  facet: "province" | "program";
  value: string;
  label: string;
  n: number;
};

export type StatsByProgram = {
  program_code: string;
  program_name: string;
  agency: string;
  n_grants: number;
  total_cad: number;
};

export type StatsByProvince = {
  province: string;
  n_grants: number;
  total_cad: number;
};

export type StatsByYear = {
  bucket_year: number;
  n_grants: number;
  total_cad: number;
};

// One row from search_companies_by_name() — trigram name lookup against
// companies.display_name. similarity is 0..1 from pg_trgm.
export type CompanyNameHit = {
  company_id: string;
  display_name: string;
  org_type: OrgType;
  city: string | null;
  province: string | null;
  similarity: number;
  grant_count: number;
  total_cad: number;
};
