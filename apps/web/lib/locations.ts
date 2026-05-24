// Detect structured-filter intent (Canadian province, org type) from a
// free-text query so the search page can auto-apply the corresponding filter.
// Without this, the reranker is left to enforce these constraints in prose
// ("biotech in Toronto", "companies doing quantum"), which it doesn't reliably
// honor — and worse, when the candidate pool is dominated by the *wrong*
// org type (e.g. quantum computing in Canada is ~95% universities), the
// reranker has nothing else to surface.
//
// Province auto-filter and org-type auto-filter are both single-valued and
// first-mention-wins. The user can override either via the Advanced Filters
// panel; an indicator at the top of /search shows what was applied.
//
// We only auto-apply a *single* province filter. Multi-province phrases
// ("Atlantic Canada", "the Prairies") would need RPC changes to support a
// province[] arg; for now they're recognized but not applied.
//
// Detection is word-boundary, case-insensitive, ASCII-folded for the accented
// Quebec/Montreal/Québec/Montréal variants. First match wins — query-order
// determines precedence so a leading "Toronto biotech" beats a trailing "BC".

const PROVINCE_NAMES: Record<string, string> = {
  // Full names → province code
  "ontario":                   "ON",
  "quebec":                    "QC",
  "alberta":                   "AB",
  "british columbia":          "BC",
  "nova scotia":               "NS",
  "new brunswick":             "NB",
  "newfoundland":              "NL",
  "newfoundland and labrador": "NL",
  "manitoba":                  "MB",
  "saskatchewan":              "SK",
  "prince edward island":      "PE",
  "yukon":                     "YT",
  "northwest territories":     "NT",
  "nunavut":                   "NU",
};

// 2-letter codes — only match as standalone tokens so "BC" doesn't fire on
// "back-of-card" or "abc". The split-by-whitespace below handles boundaries.
const PROVINCE_CODES = new Set([
  "ON", "QC", "AB", "BC", "NS", "NB", "NL", "MB", "SK", "PE", "YT", "NT", "NU",
]);

// Major cities → home province. Kept short — these are the unambiguous ones
// where mentioning the city strongly implies wanting that province's results.
const CITY_TO_PROVINCE: Record<string, string> = {
  "toronto":     "ON",
  "ottawa":      "ON",
  "mississauga": "ON",
  "hamilton":    "ON",
  "kitchener":   "ON",
  "waterloo":    "ON",
  "london":      "ON",
  "montreal":    "QC",
  "quebec city": "QC",
  "laval":       "QC",
  "sherbrooke":  "QC",
  "vancouver":   "BC",
  "victoria":    "BC",
  "burnaby":     "BC",
  "kelowna":     "BC",
  "calgary":     "AB",
  "edmonton":    "AB",
  "halifax":     "NS",
  "winnipeg":    "MB",
  "saskatoon":   "SK",
  "regina":      "SK",
  "fredericton": "NB",
  "moncton":     "NB",
  "st. john's":  "NL",
  "st johns":    "NL",
  "charlottetown": "PE",
};

export type LocationHint = {
  province: string;          // 2-letter code, e.g. "ON"
  source: string;            // the phrase that triggered the match ("Toronto", "Quebec", ...)
  kind: "province" | "city" | "code";
};

/**
 * Find the first province hint in a query, if any. Returns `null` when the
 * query has no recognizable Canadian-place reference. ASCII-folds accents
 * before matching so "Québec" and "quebec" behave identically.
 */
export function detectLocationFilter(query: string): LocationHint | null {
  if (!query) return null;
  const ascii = stripAccents(query.toLowerCase());

  // Iterate phrases in order of appearance so a leading mention wins. The
  // simplest correct way: walk every known phrase, record (offset, hint),
  // then return the lowest-offset hit.
  const hits: Array<{ offset: number; hint: LocationHint }> = [];

  for (const [name, code] of Object.entries(PROVINCE_NAMES)) {
    const offset = wordBoundaryIndex(ascii, name);
    if (offset !== -1) hits.push({ offset, hint: { province: code, source: name, kind: "province" } });
  }
  for (const [city, code] of Object.entries(CITY_TO_PROVINCE)) {
    const offset = wordBoundaryIndex(ascii, city);
    if (offset !== -1) hits.push({ offset, hint: { province: code, source: city, kind: "city" } });
  }
  // 2-letter codes — only as standalone uppercase tokens in the original
  // (un-lowercased) query, to avoid false positives like "AB testing".
  for (const tok of query.split(/[^A-Za-z]+/)) {
    if (tok.length === 2 && PROVINCE_CODES.has(tok)) {
      const offset = query.indexOf(tok);
      hits.push({ offset, hint: { province: tok, source: tok, kind: "code" } });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.offset - b.offset);
  return hits[0]?.hint ?? null;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Org-type auto-filter

import type { OrgType } from "@/lib/db/types";

export type OrgHint = {
  org: OrgType;
  source: string;  // the phrase that triggered the match, shown to the user
};

// Each entry: a pattern that strongly implies the user wants results of that
// org_type. Ordered by tightest-meaning first. "lab/labs" intentionally NOT
// in research_institute — it's too ambiguous in a Canadian context
// (university labs are the default mental model), so we only match the
// unambiguous "research institute(s)" phrase.
const ORG_PATTERNS: Array<{ pattern: RegExp; org: OrgType; source: string }> = [
  {
    pattern: /\b(companies?|startups?|industry|industries|private[\s-]sector|corporates?|corporations?|firms?|businesses)\b/i,
    org: "company",
    source: "companies",
  },
  {
    pattern: /\b(universit(?:y|ies)|academic(?:s)?|academia)\b/i,
    org: "university",
    source: "universities",
  },
  {
    pattern: /\bresearch[\s-]institutes?\b/i,
    org: "research_institute",
    source: "research institutes",
  },
  {
    pattern: /\b(nonprofits?|non[\s-]profits?|charit(?:y|ies))\b/i,
    org: "nonprofit",
    source: "nonprofits",
  },
  {
    pattern: /\bgovernments?\b/i,
    org: "government",
    source: "government",
  },
];

/**
 * Find the first org-type hint in the query, if any. Returns `null` when no
 * matching phrase is present. If the query mentions multiple types ("companies
 * and universities"), the earliest mention wins — same precedence rule as
 * the location detector.
 */
export function detectOrgTypeFilter(query: string): OrgHint | null {
  if (!query) return null;
  let earliest: { idx: number; hint: OrgHint } | null = null;
  for (const k of ORG_PATTERNS) {
    const m = query.match(k.pattern);
    if (!m || m.index == null) continue;
    if (!earliest || m.index < earliest.idx) {
      earliest = { idx: m.index, hint: { org: k.org, source: k.source } };
    }
  }
  return earliest?.hint ?? null;
}

// Match `needle` in `haystack` at a word boundary. Avoids "ontario" matching
// inside a longer word (none plausible, but principle of least surprise).
function wordBoundaryIndex(haystack: string, needle: string): number {
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    const before = idx === 0 ? " " : haystack[idx - 1] ?? " ";
    const after = haystack[idx + needle.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return idx;
    from = idx + 1;
  }
  return -1;
}
