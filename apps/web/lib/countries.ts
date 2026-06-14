// Single source of truth for the country ↔ funding-source mapping. The corpus
// has no `country` column, so a grant's country is inferred from its funding
// program code: each non-Canadian country owns a fixed set of program codes,
// and everything else is Canadian. Used by the browse/search country filter,
// the finder country scoping, and result-card country labels.

export type CountryCode = "CA" | "US" | "UK" | "AU";

export const COUNTRY_LABELS: Record<CountryCode, string> = {
  CA: "Canada",
  US: "United States",
  UK: "United Kingdom",
  AU: "Australia",
};

// Order for selectors (Canada first — it's the densest corpus).
export const COUNTRY_ORDER: CountryCode[] = ["CA", "US", "UK", "AU"];

// Program codes that identify a non-Canadian source. Canada is "everything
// else", so it is deliberately NOT enumerated here — see countryToProgramCodes.
export const FOREIGN_PROGRAM_CODES: Record<Exclude<CountryCode, "CA">, string[]> = {
  US: ["NSF", "NIH"],
  UK: ["UKRI"],
  AU: ["ARC", "NHMRC", "GRANTCONNECT"],
};

export const FOREIGN_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(FOREIGN_PROGRAM_CODES).flat(),
);

const FUNDER_COUNTRY = new Map<string, CountryCode>(
  (Object.entries(FOREIGN_PROGRAM_CODES) as [Exclude<CountryCode, "CA">, string[]][]).flatMap(
    ([country, codes]) => codes.map((code): [string, CountryCode] => [code, country]),
  ),
);

/** The country a funding source belongs to; unknown/Canadian funders → "CA". */
export function countryOfFunder(code: string | null | undefined): CountryCode {
  return (code && FUNDER_COUNTRY.get(code)) || "CA";
}

/** Human-readable country name for a funding source code. */
export function countryName(code: string | null | undefined): string {
  return COUNTRY_LABELS[countryOfFunder(code)];
}

export function isCountryCode(v: string | null | undefined): v is CountryCode {
  return v === "CA" || v === "US" || v === "UK" || v === "AU";
}

/**
 * Resolve a country filter to a program-code include-list for the browse/search
 * RPCs (which accept an include-list, not a country). Foreign countries map to
 * their fixed codes; Canada = all known program codes minus the foreign ones,
 * derived from the live facet list passed in so new Canadian sources are
 * included automatically. Returns null when no country is selected.
 */
export function countryToProgramCodes(
  country: CountryCode | null | undefined,
  allProgramCodes: string[],
): string[] | null {
  if (!country) return null;
  if (country === "CA") return allProgramCodes.filter((c) => !FOREIGN_CODE_SET.has(c));
  return FOREIGN_PROGRAM_CODES[country];
}
