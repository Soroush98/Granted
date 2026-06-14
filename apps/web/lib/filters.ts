// Shared helpers for reading/writing the structured-filter URL params used by
// /search, /browse, and /stats. All filter pages speak the same query-string
// vocabulary so links between them preserve user selections.

import type { OrgType } from "@/lib/db/types";
import type { SearchFilters, BrowseSort } from "@/lib/db/types";
import { isCountryCode } from "@/lib/countries";

const ORG_TYPES: ReadonlySet<OrgType> = new Set([
  "company", "university", "research_institute", "nonprofit", "government", "other",
]);

const SORT_KEYS: ReadonlySet<BrowseSort> = new Set(["recent", "amount", "amount_desc"]);

// Next.js searchParams returns `string | string[] | undefined`. Multi-value
// checkbox inputs (the program facet) arrive as `string[]`.
export type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function all(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v !== "") return v.split(",").filter(Boolean);
  return [];
}

// Read filters from a URLSearchParams-shaped record. Empty strings → null so
// the RPC sees a real NULL and skips the predicate.
export function readFilters(params: Params): SearchFilters {
  const province = first(params.province)?.trim() || null;
  const countryRaw = first(params.country)?.trim();
  const country = isCountryCode(countryRaw) ? countryRaw : null;
  // Accept both ?programs=A&programs=B (multi-value form post) and
  // ?programs=A,B (CSV from link composition).
  const programArr = all(params.programs);
  const programCodes = programArr.length > 0 ? programArr : null;
  const minStartDate = first(params.min_date)?.trim() || null;
  const maxStartDate = first(params.max_date)?.trim() || null;
  const minAmount = numberOrNull(first(params.min_amount));
  const maxAmount = numberOrNull(first(params.max_amount));
  const orgFilter = orgTypeOrNull(first(params.org));

  return {
    orgFilter,
    province,
    programCodes,
    country,
    minStartDate,
    maxStartDate,
    minAmount,
    maxAmount,
  };
}

export function readSort(params: Params): BrowseSort {
  const s = first(params.sort)?.trim() as BrowseSort | undefined;
  return s && SORT_KEYS.has(s) ? s : "recent";
}

export function readPage(params: Params): number {
  const raw = first(params.page);
  const p = Number(raw ?? 0);
  return Number.isFinite(p) && p >= 0 ? Math.floor(p) : 0;
}

// True iff any structured filter is set — useful for the "active filters"
// badge in the UI and for skipping the empty-state hint.
export function hasAnyFilter(f: SearchFilters): boolean {
  return Boolean(
    f.orgFilter ||
    f.province ||
    f.country ||
    (f.programCodes && f.programCodes.length > 0) ||
    f.minStartDate ||
    f.maxStartDate ||
    f.minAmount != null ||
    f.maxAmount != null
  );
}

// Build a URLSearchParams that includes the given filters (skipping nulls).
// Use as ?${buildFilterParams(filters).toString()} when linking between pages.
export function buildFilterParams(
  filters: SearchFilters,
  extra: Record<string, string | undefined> = {},
): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.orgFilter)               sp.set("org", filters.orgFilter);
  if (filters.country)                 sp.set("country", filters.country);
  if (filters.province)                sp.set("province", filters.province);
  if (filters.programCodes?.length)    sp.set("programs", filters.programCodes.join(","));
  if (filters.minStartDate)            sp.set("min_date", filters.minStartDate);
  if (filters.maxStartDate)            sp.set("max_date", filters.maxStartDate);
  if (filters.minAmount != null)       sp.set("min_amount", String(filters.minAmount));
  if (filters.maxAmount != null)       sp.set("max_amount", String(filters.maxAmount));
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  return sp;
}

function numberOrNull(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function orgTypeOrNull(v: string | undefined): OrgType | null {
  if (!v) return null;
  return ORG_TYPES.has(v as OrgType) ? (v as OrgType) : null;
}

// Convert FormData → Params, preserving multiple values per key so a
// checkbox group like `programs` round-trips through readFilters() correctly.
export function formToParams(fd: FormData): Params {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || v === "") continue;
    const existing = out[k];
    if (existing == null) {
      out[k] = v;
    } else if (Array.isArray(existing)) {
      existing.push(v);
    } else {
      out[k] = [existing, v];
    }
  }
  return out as Params;
}
