// RQ3/RQ4 — URL params ↔ SearchFilters (QA-STRATEGY.md, cases FL-*).
// Techniques: equivalence partitioning (valid / empty / invalid-type /
// out-of-domain per param), boundary-value analysis on page & amounts,
// and a round-trip property through buildFilterParams → readFilters.
import { describe, expect, it } from "vitest";
import {
  buildFilterParams,
  formToParams,
  hasAnyFilter,
  readFilters,
  readPage,
  readSort,
  type Params,
} from "@/lib/filters";
import type { SearchFilters } from "@/lib/db/types";

const EMPTY: SearchFilters = {
  orgFilter: null,
  province: null,
  programCodes: null,
  country: null,
  minStartDate: null,
  maxStartDate: null,
  minAmount: null,
  maxAmount: null,
};

describe("readFilters", () => {
  it("FL-01 empty params → all-null filters", () => {
    expect(readFilters({})).toEqual(EMPTY);
  });

  it("FL-02 empty strings are treated as unset (real NULL for the RPC)", () => {
    expect(
      readFilters({ province: "", country: "", min_amount: "", org: "", programs: "" }),
    ).toEqual(EMPTY);
  });

  it("FL-03 a fully-populated param set parses field-for-field", () => {
    expect(
      readFilters({
        org: "university",
        province: "ON",
        country: "US",
        programs: "NSF,NIH",
        min_date: "2024-01-01",
        max_date: "2025-01-01",
        min_amount: "50000",
        max_amount: "1000000",
      }),
    ).toEqual({
      orgFilter: "university",
      province: "ON",
      country: "US",
      programCodes: ["NSF", "NIH"],
      minStartDate: "2024-01-01",
      maxStartDate: "2025-01-01",
      minAmount: 50000,
      maxAmount: 1000000,
    });
  });

  it("FL-04 out-of-domain country values are dropped (case-sensitive)", () => {
    expect(readFilters({ country: "XX" }).country).toBeNull();
    expect(readFilters({ country: "ca" }).country).toBeNull();
    expect(readFilters({ country: "CA" }).country).toBe("CA");
  });

  it("FL-05 out-of-domain org types are dropped; every declared type passes", () => {
    expect(readFilters({ org: "school" }).orgFilter).toBeNull();
    for (const org of [
      "company", "university", "research_institute", "nonprofit", "government", "other",
    ]) {
      expect(readFilters({ org }).orgFilter).toBe(org);
    }
  });

  it("FL-06 programs accepts both CSV and repeated-param forms", () => {
    expect(readFilters({ programs: "NSF,NIH" }).programCodes).toEqual(["NSF", "NIH"]);
    expect(readFilters({ programs: ["NSF", "NIH"] }).programCodes).toEqual(["NSF", "NIH"]);
    expect(readFilters({ programs: ["NSF", ""] }).programCodes).toEqual(["NSF"]);
  });

  it("FL-07 non-numeric amounts → null; numeric strings (incl. exponent) parse", () => {
    expect(readFilters({ min_amount: "abc" }).minAmount).toBeNull();
    expect(readFilters({ min_amount: "1e5" }).minAmount).toBe(100000);
    expect(readFilters({ min_amount: "0" }).minAmount).toBe(0);
    expect(readFilters({ max_amount: "Infinity" }).maxAmount).toBeNull();
  });

  it("FL-15 dates pass through unvalidated (documented current behavior)", () => {
    // The RPC receives whatever string arrives. Garbage dates are the DB's
    // problem today — see DEFECTS.md OBS-2.
    expect(readFilters({ min_date: "not-a-date" }).minStartDate).toBe("not-a-date");
  });
});

describe("buildFilterParams ↔ readFilters round-trip", () => {
  it("FL-08 empty filters serialize to zero params", () => {
    expect(buildFilterParams(EMPTY).toString()).toBe("");
  });

  it("FL-09 a populated filter set survives the URL round-trip losslessly", () => {
    const filters: SearchFilters = {
      orgFilter: "company",
      province: "QC",
      programCodes: ["IRAP", "SIF"],
      country: "CA",
      minStartDate: "2024-06-01",
      maxStartDate: "2026-01-01",
      minAmount: 0,
      maxAmount: 250000,
    };
    const sp = buildFilterParams(filters);
    const roundTripped = readFilters(Object.fromEntries(sp.entries()) as Params);
    expect(roundTripped).toEqual(filters);
  });

  it("FL-12 extra params are appended and empty extras skipped", () => {
    const sp = buildFilterParams(EMPTY, { q: "quantum", empty: "", missing: undefined });
    expect(sp.get("q")).toBe("quantum");
    expect(sp.has("empty")).toBe(false);
    expect(sp.has("missing")).toBe(false);
  });
});

describe("hasAnyFilter", () => {
  it("FL-10 false on empty; true for each individually-set field (incl. 0 amounts)", () => {
    expect(hasAnyFilter(EMPTY)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY, orgFilter: "company" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, province: "ON" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, country: "UK" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, programCodes: ["NSF"] })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, programCodes: [] })).toBe(false);
    expect(hasAnyFilter({ ...EMPTY, minStartDate: "2024-01-01" })).toBe(true);
    // Boundary: 0 is a legitimate amount filter and must count as "set".
    expect(hasAnyFilter({ ...EMPTY, minAmount: 0 })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, maxAmount: 0 })).toBe(true);
  });
});

describe("readPage", () => {
  it("FL-13 boundary values: missing→0, 0→0, valid→n, floats floor", () => {
    expect(readPage({})).toBe(0);
    expect(readPage({ page: "0" })).toBe(0);
    expect(readPage({ page: "3" })).toBe(3);
    expect(readPage({ page: "2.7" })).toBe(2);
  });

  it("FL-14 invalid pages clamp to 0: negative, NaN, non-numeric", () => {
    expect(readPage({ page: "-1" })).toBe(0);
    expect(readPage({ page: "abc" })).toBe(0);
    expect(readPage({ page: "NaN" })).toBe(0);
  });

  it("FL-16 has no upper bound (documented current behavior — OBS-1)", () => {
    // A crafted ?page=1e9 reaches the RPC as a giant OFFSET. Pinned here so a
    // future clamp flips this test intentionally.
    expect(readPage({ page: "1000000000" })).toBe(1000000000);
  });
});

describe("readSort", () => {
  it("FL-17 accepts declared sort keys, defaults everything else to 'recent'", () => {
    expect(readSort({ sort: "amount" })).toBe("amount");
    expect(readSort({ sort: "amount_desc" })).toBe("amount_desc");
    expect(readSort({ sort: "recent" })).toBe("recent");
    expect(readSort({ sort: "sideways" })).toBe("recent");
    expect(readSort({})).toBe("recent");
  });
});

describe("formToParams", () => {
  it("FL-11 preserves repeated keys as arrays and drops empty values", () => {
    const fd = new FormData();
    fd.append("programs", "NSF");
    fd.append("programs", "NIH");
    fd.append("province", "ON");
    fd.append("blank", "");
    const params = formToParams(fd);
    expect(params.programs).toEqual(["NSF", "NIH"]);
    expect(params.province).toBe("ON");
    expect(params.blank).toBeUndefined();
  });
});
