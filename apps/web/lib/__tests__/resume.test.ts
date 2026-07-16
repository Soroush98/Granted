// RQ9 — document text normalization + GOAL/BACKGROUND framing (cases RS-*).
// Technique: boundary-value analysis on the 4,000-char cap; round-trip
// property buildQuery → splitQueryParts; legacy-separator back-compat.
import { describe, expect, it } from "vitest";
import { buildQuery, normalizeDocumentText, splitQueryParts } from "@/lib/resume";

describe("normalizeDocumentText", () => {
  it("RS-01 caps at exactly maxChars: 4000 kept, 4001 truncated", () => {
    expect(normalizeDocumentText("a".repeat(4000))).toHaveLength(4000);
    expect(normalizeDocumentText("a".repeat(4001))).toHaveLength(4000);
    expect(normalizeDocumentText("a".repeat(10), 10)).toHaveLength(10);
    expect(normalizeDocumentText("a".repeat(11), 10)).toHaveLength(10);
  });

  it("RS-02 strips control chars and carriage returns, squashes runs of spaces/tabs", () => {
    expect(normalizeDocumentText("a\x00b\x07c\x7Fd")).toBe("a b c d");
    expect(normalizeDocumentText("line1\r\nline2")).toBe("line1\nline2");
    expect(normalizeDocumentText("a \t  b")).toBe("a b");
  });

  it("RS-03 collapses 3+ blank lines to one blank line, trims edges", () => {
    expect(normalizeDocumentText("\n\na\n\n\n\n\nb\n\n")).toBe("a\n\nb");
  });
});

describe("buildQuery", () => {
  it("RS-04 combines goal + document into the GOAL/BACKGROUND shape", () => {
    expect(buildQuery("resume text here", "find ml jobs")).toBe(
      "GOAL: find ml jobs\n\nBACKGROUND:\nresume text here",
    );
    expect(buildQuery("", "just a goal")).toBe("just a goal");
    expect(buildQuery("just a doc", "")).toBe("just a doc");
    expect(buildQuery("", "")).toBe("");
  });
});

describe("splitQueryParts", () => {
  it("RS-05 is the inverse of buildQuery for normalized documents", () => {
    const goal = "find quantum companies";
    const doc = "Physics PhD.\n\nBuilt superconducting qubit readout.";
    const { goal: g, background: b } = splitQueryParts(buildQuery(doc, goal));
    expect(g).toBe(goal);
    expect(b).toBe(doc);
  });

  it("RS-06 still splits on the legacy 'BACKGROUND (from resume):' separator", () => {
    const legacy = "GOAL: g\n\nBACKGROUND (from resume):\nold bookmark body";
    expect(splitQueryParts(legacy)).toEqual({ goal: "g", background: "old bookmark body" });
  });

  it("RS-07 no separator → whole string is the goal, GOAL: prefix stripped", () => {
    expect(splitQueryParts("plain query")).toEqual({ goal: "plain query", background: "" });
    expect(splitQueryParts("GOAL: prefixed query")).toEqual({
      goal: "prefixed query",
      background: "",
    });
  });

  it("RS-08 empty input → empty parts", () => {
    expect(splitQueryParts("")).toEqual({ goal: "", background: "" });
  });
});
