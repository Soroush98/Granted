// RQ5/RQ6 — auto-filter detection from free text (QA-STRATEGY.md, cases LC-*).
// Techniques: equivalence partitioning over trigger classes (province name,
// city, 2-letter code, none) plus negative cases for the word-boundary rules.
import { describe, expect, it } from "vitest";
import { detectLocationFilter, detectOrgTypeFilter } from "@/lib/locations";

describe("detectLocationFilter — province names", () => {
  it("LC-01 detects a full province name anywhere in the query", () => {
    expect(detectLocationFilter("biotech in ontario")).toMatchObject({
      province: "ON",
      kind: "province",
    });
  });

  it("LC-02 ASCII-folds accents: Québec / Montréal behave like quebec / montreal", () => {
    expect(detectLocationFilter("startups au Québec")?.province).toBe("QC");
    expect(detectLocationFilter("aérospatiale à Montréal")?.province).toBe("QC");
  });

  it("LC-09 handles the punctuation variants of St. John's", () => {
    expect(detectLocationFilter("marine robotics st. john's")?.province).toBe("NL");
    expect(detectLocationFilter("marine robotics st johns")?.province).toBe("NL");
  });
});

describe("detectLocationFilter — cities", () => {
  it("LC-03 maps major cities to their province", () => {
    expect(detectLocationFilter("toronto ai companies")).toMatchObject({
      province: "ON",
      kind: "city",
    });
    expect(detectLocationFilter("clean energy vancouver")?.province).toBe("BC");
    expect(detectLocationFilter("agritech in saskatoon")?.province).toBe("SK");
  });
});

describe("detectLocationFilter — 2-letter codes", () => {
  it("LC-05 matches standalone uppercase codes", () => {
    expect(detectLocationFilter("quantum computing in BC")).toMatchObject({
      province: "BC",
      kind: "code",
    });
  });

  it("LC-06 does not fire inside longer words", () => {
    expect(detectLocationFilter("abc consulting")).toBeNull();
    expect(detectLocationFilter("back-of-card printing")).toBeNull();
  });

  it("LC-07 lowercase codes do not fire (case is the signal)", () => {
    expect(detectLocationFilter("gene editing in bc")).toBeNull();
    expect(detectLocationFilter("on prem infrastructure")).toBeNull();
  });

  // DEF-2: the code comment promises "AB testing" won't trigger the Alberta
  // filter, but the token scan matches any standalone uppercase code. Marked
  // .fails so the suite flips loudly when the defect is fixed.
  it.fails("LC-08 'AB testing' must not auto-filter to Alberta (DEF-2)", () => {
    expect(detectLocationFilter("AB testing platforms")).toBeNull();
  });
});

describe("detectLocationFilter — precedence & empty", () => {
  it("LC-04 first mention wins when several places appear", () => {
    expect(detectLocationFilter("Toronto biotech or maybe BC")?.province).toBe("ON");
    expect(detectLocationFilter("BC biotech or maybe Toronto")?.province).toBe("BC");
  });

  it("LC-10 no recognizable place → null; empty input → null", () => {
    expect(detectLocationFilter("mRNA vaccine delivery platforms")).toBeNull();
    expect(detectLocationFilter("")).toBeNull();
  });
});

describe("detectOrgTypeFilter", () => {
  it("LC-11 company vocabulary → company", () => {
    expect(detectOrgTypeFilter("companies doing quantum")?.org).toBe("company");
    expect(detectOrgTypeFilter("private-sector photonics")?.org).toBe("company");
    expect(detectOrgTypeFilter("hardware startups")?.org).toBe("company");
  });

  it("LC-12 university vocabulary → university", () => {
    expect(detectOrgTypeFilter("universities in toronto")?.org).toBe("university");
    expect(detectOrgTypeFilter("academia working on fusion")?.org).toBe("university");
  });

  it("LC-13 lab / research-institute vocabulary → research_institute", () => {
    expect(detectOrgTypeFilter("AI labs in Edmonton")?.org).toBe("research_institute");
    expect(detectOrgTypeFilter("research institutes for genomics")?.org).toBe(
      "research_institute",
    );
  });

  it("LC-14 earliest mention wins on multi-type queries", () => {
    expect(detectOrgTypeFilter("companies and universities")?.org).toBe("company");
    expect(detectOrgTypeFilter("universities partnering with companies")?.org).toBe(
      "university",
    );
  });

  it("LC-15 remaining types and the null partition", () => {
    expect(detectOrgTypeFilter("nonprofits in health")?.org).toBe("nonprofit");
    expect(detectOrgTypeFilter("government research programs")?.org).toBe("government");
    expect(detectOrgTypeFilter("mRNA vaccine delivery")).toBeNull();
    expect(detectOrgTypeFilter("")).toBeNull();
  });
});
