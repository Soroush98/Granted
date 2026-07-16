// RQ8 — embedding/FTS query preparation (QA-STRATEGY.md, cases PQ-*).
// Technique: equivalence partitioning over (goal × background × applied
// filters) plus the never-empty fallback boundary.
import { describe, expect, it } from "vitest";
import { prepareEmbedQuery } from "@/lib/rag/prepare-query";
import type { SearchFilters } from "@/lib/db/types";

const NO_FILTERS: SearchFilters = {
  orgFilter: null,
  province: null,
  programCodes: null,
  country: null,
  minStartDate: null,
  maxStartDate: null,
  minAmount: null,
  maxAmount: null,
};

const withFilters = (f: Partial<SearchFilters>): SearchFilters => ({ ...NO_FILTERS, ...f });

describe("prepareEmbedQuery — goal cleaning", () => {
  it("PQ-01 the README example: 'labs in alberta doing ml' → 'machine learning'", () => {
    const { embedText, ftsText } = prepareEmbedQuery(
      "labs in alberta doing ml",
      withFilters({ province: "AB", orgFilter: "research_institute" }),
    );
    expect(embedText).toBe("machine learning");
    expect(ftsText).toBe("machine learning");
  });

  it("PQ-02 expands abbreviations token-wise", () => {
    expect(prepareEmbedQuery("ai for drug discovery", NO_FILTERS).embedText).toBe(
      "artificial intelligence drug discovery",
    );
    expect(prepareEmbedQuery("5g networks", NO_FILTERS).embedText).toBe(
      "5g cellular networking networks",
    );
  });

  it("PQ-03 filter words are only stripped when the filter is actually applied", () => {
    // No org filter applied → "companies" stays (it's signal).
    expect(prepareEmbedQuery("quantum companies", NO_FILTERS).embedText).toBe(
      "quantum companies",
    );
    // Org filter applied → the word is redundant with the hard predicate.
    expect(
      prepareEmbedQuery("quantum companies", withFilters({ orgFilter: "company" })).embedText,
    ).toBe("quantum");
  });

  it("PQ-08 province filter strips that province's cities too", () => {
    expect(
      prepareEmbedQuery("robotics in toronto", withFilters({ province: "ON" })).embedText,
    ).toBe("robotics");
  });

  it("PQ-04 falls back to the raw goal when cleaning would erase everything", () => {
    const { embedText } = prepareEmbedQuery(
      "looking for a place",
      NO_FILTERS,
    );
    expect(embedText).toBe("looking for a place");
    expect(embedText.length).toBeGreaterThan(0);
  });
});

describe("prepareEmbedQuery — background handling", () => {
  const combined = "GOAL: find ml companies\n\nBACKGROUND:\nPyTorch CUDA quantization work.";

  it("PQ-05 background is preserved verbatim inside embedText", () => {
    const { embedText } = prepareEmbedQuery(combined, NO_FILTERS);
    expect(embedText).toBe(
      "GOAL: machine learning companies\n\nBACKGROUND:\nPyTorch CUDA quantization work.",
    );
  });

  it("PQ-07 ftsText excludes the background (AND-semantics would zero FTS hits)", () => {
    const { ftsText } = prepareEmbedQuery(combined, NO_FILTERS);
    expect(ftsText).toBe("machine learning companies");
    expect(ftsText).not.toContain("PyTorch");
  });

  it("PQ-06 empty goal with a background embeds the background alone", () => {
    const q = "GOAL: \n\nBACKGROUND:\nDeep learning for genomics.";
    const { embedText } = prepareEmbedQuery(q, NO_FILTERS);
    expect(embedText).toBe("Deep learning for genomics.");
  });
});
