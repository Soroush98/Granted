import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { supabaseAnon } from "@/lib/db/supabase-server";
import { splitQueryParts } from "@/lib/resume";
import type {
  BrowseGrant,
  BrowseSort,
  CompanyNameHit,
  FilterFacet,
  SearchFilters,
  StatsByProgram,
  StatsByProvince,
  StatsByYear,
} from "@/lib/db/types";

const PAGE_SIZE = 25;

export async function browseGrants(
  filters: SearchFilters,
  sort: BrowseSort,
  page: number,
): Promise<{ rows: BrowseGrant[]; total: number; pageSize: number }> {
  "use cache";
  cacheLife("minutes");
  cacheTag("search");

  const supabase = supabaseAnon();
  const { data, error } = await supabase.rpc("browse_grants", {
    province_filter: filters.province ?? null,
    program_codes: filters.programCodes ?? null,
    org_filter: filters.orgFilter ?? null,
    min_start_date: filters.minStartDate ?? null,
    max_start_date: filters.maxStartDate ?? null,
    min_amount: filters.minAmount ?? null,
    max_amount: filters.maxAmount ?? null,
    sort_by: sort,
    page_limit: PAGE_SIZE,
    page_offset: page * PAGE_SIZE,
  });
  if (error) throw new Error(`browse_grants RPC failed: ${error.message}`);
  const rows = (data ?? []) as BrowseGrant[];
  // total_count is the same on every row (window aggregate); 0 if empty
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return { rows, total, pageSize: PAGE_SIZE };
}

export async function listFacets(): Promise<{
  provinces: FilterFacet[];
  programs: FilterFacet[];
}> {
  "use cache";
  cacheLife("hours");
  cacheTag("search");

  const supabase = supabaseAnon();
  const { data, error } = await supabase.rpc("list_filter_facets");
  if (error) throw new Error(`list_filter_facets RPC failed: ${error.message}`);
  const all = (data ?? []) as FilterFacet[];
  return {
    provinces: all.filter((f) => f.facet === "province"),
    programs: all.filter((f) => f.facet === "program"),
  };
}

export async function statsByProgram(
  minDate: string | null,
  maxDate: string | null,
): Promise<StatsByProgram[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("search");

  const supabase = supabaseAnon();
  const { data, error } = await supabase.rpc("stats_by_program", {
    min_start_date: minDate,
    max_start_date: maxDate,
  });
  if (error) throw new Error(`stats_by_program RPC failed: ${error.message}`);
  return (data ?? []) as StatsByProgram[];
}

export async function statsByProvince(
  minDate: string | null,
  maxDate: string | null,
): Promise<StatsByProvince[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("search");

  const supabase = supabaseAnon();
  const { data, error } = await supabase.rpc("stats_by_province", {
    min_start_date: minDate,
    max_start_date: maxDate,
  });
  if (error) throw new Error(`stats_by_province RPC failed: ${error.message}`);
  return (data ?? []) as StatsByProvince[];
}

export async function statsByYear(
  minDate: string | null,
  maxDate: string | null,
): Promise<StatsByYear[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("search");

  const supabase = supabaseAnon();
  const { data, error } = await supabase.rpc("stats_by_year", {
    min_start_date: minDate,
    max_start_date: maxDate,
  });
  if (error) throw new Error(`stats_by_year RPC failed: ${error.message}`);
  return (data ?? []) as StatsByYear[];
}

/**
 * Trigram lookup for company names. Use it to surface a "did you mean?" panel
 * when the user's free-text query contains what looks like an organization
 * name (e.g. "wedge networks", "cohere"). Independent of the semantic search
 * pipeline; runs sub-millisecond against a GIN trigram index on 15K rows.
 *
 * `minSimilarity` is forwarded to the RPC; trigram scores below ~0.20 are
 * usually noise. The UI then chooses how prominently to display them.
 */
export async function lookupCompaniesByName(
  query: string,
  opts: { maxResults?: number; minSimilarity?: number } = {},
): Promise<CompanyNameHit[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("search");

  const trimmed = query.trim();
  // Bail out on empty / extremely short queries (one or two characters are
  // mostly noise from a trigram standpoint).
  if (trimmed.length < 3) return [];

  const supabase = supabaseAnon();
  const { data, error } = await supabase.rpc("search_companies_by_name", {
    q: trimmed,
    max_results: opts.maxResults ?? 5,
    min_similarity: opts.minSimilarity ?? 0.2,
  });
  if (error) throw new Error(`search_companies_by_name RPC failed: ${error.message}`);
  return (data ?? []) as CompanyNameHit[];
}

/**
 * Strip a search query down to the name-like portion before passing it to
 * lookupCompaniesByName(). Drops the resume / paper background, the GOAL:
 * prefix, anything after the first comma (so "wedge networks, see all
 * fundings" becomes "wedge networks"), and trailing imperative phrases like
 * "show me all grants". The result is what we try to trigram-match against
 * companies.display_name.
 */
export function extractNameQuery(query: string): string {
  let s = splitQueryParts(query).goal.trim();
  // Take only the first comma-delimited fragment.
  const commaIdx = s.indexOf(",");
  if (commaIdx !== -1) s = s.slice(0, commaIdx);
  // Drop common trailing instruction phrases.
  s = s.replace(
    /\s+(see|show|list|view|get|find|tell\s+me|give\s+me)\s+(all\s+)?(the\s+)?(fundings?|grants?|info|details).*$/i,
    "",
  );
  return s.trim();
}
