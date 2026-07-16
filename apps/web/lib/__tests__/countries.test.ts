// RQ1/RQ2 — country ↔ funding-source mapping (QA-STRATEGY.md, cases CT-*).
// Technique: equivalence partitioning over program codes (each foreign
// country's set, unknown Canadian codes, null/empty).
import { describe, expect, it } from "vitest";
import {
  countryName,
  countryOfFunder,
  countryToProgramCodes,
  FOREIGN_PROGRAM_CODES,
  isCountryCode,
} from "@/lib/countries";

describe("countryOfFunder", () => {
  it("CT-01 maps US program codes to US", () => {
    expect(countryOfFunder("NSF")).toBe("US");
    expect(countryOfFunder("NIH")).toBe("US");
  });

  it("CT-02 maps UKRI to UK", () => {
    expect(countryOfFunder("UKRI")).toBe("UK");
  });

  it("CT-03 maps Australian codes to AU", () => {
    expect(countryOfFunder("ARC")).toBe("AU");
    expect(countryOfFunder("NHMRC")).toBe("AU");
    expect(countryOfFunder("GRANTCONNECT")).toBe("AU");
  });

  it("CT-04 treats unknown / Canadian codes as CA", () => {
    expect(countryOfFunder("NSERC_DISCOVERY")).toBe("CA");
    expect(countryOfFunder("MITACS")).toBe("CA");
    expect(countryOfFunder("SOME_FUTURE_PROGRAM")).toBe("CA");
  });

  it("CT-05 treats null/undefined/empty as CA", () => {
    expect(countryOfFunder(null)).toBe("CA");
    expect(countryOfFunder(undefined)).toBe("CA");
    expect(countryOfFunder("")).toBe("CA");
  });

  it("CT-06 countryName resolves human-readable labels", () => {
    expect(countryName("NSF")).toBe("United States");
    expect(countryName(null)).toBe("Canada");
  });
});

describe("countryToProgramCodes", () => {
  const facets = ["IRAP", "CIHR", "NSF", "NIH", "UKRI", "ARC", "GRANTCONNECT", "MITACS"];

  it("CT-07 returns null when no country is selected", () => {
    expect(countryToProgramCodes(null, facets)).toBeNull();
    expect(countryToProgramCodes(undefined, facets)).toBeNull();
  });

  it("CT-08 foreign countries resolve to their fixed code lists", () => {
    expect(countryToProgramCodes("US", facets)).toEqual(FOREIGN_PROGRAM_CODES.US);
    expect(countryToProgramCodes("UK", facets)).toEqual(FOREIGN_PROGRAM_CODES.UK);
    expect(countryToProgramCodes("AU", facets)).toEqual(FOREIGN_PROGRAM_CODES.AU);
  });

  it("CT-09 Canada = live facet list minus every foreign code", () => {
    expect(countryToProgramCodes("CA", facets)).toEqual(["IRAP", "CIHR", "MITACS"]);
  });

  it("CT-10 Canada with an empty facet list yields an empty include-list", () => {
    // Boundary: facets not loaded → [] (RPC would match nothing). Callers must
    // pass the real facet list; this pins the contract.
    expect(countryToProgramCodes("CA", [])).toEqual([]);
  });
});

describe("isCountryCode", () => {
  it("CT-11 accepts exactly the four codes", () => {
    for (const c of ["CA", "US", "UK", "AU"]) expect(isCountryCode(c)).toBe(true);
  });

  it("CT-12 rejects lowercase, unknown, and empty values", () => {
    expect(isCountryCode("ca")).toBe(false);
    expect(isCountryCode("USA")).toBe(false);
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(isCountryCode(undefined)).toBe(false);
  });
});
