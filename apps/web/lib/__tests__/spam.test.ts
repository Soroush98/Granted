// RQ7 — promo-spam gate ahead of all AI spend (QA-STRATEGY.md, cases SP-*).
// Technique: decision table over the two-signal rule (site mention decisive;
// greeting + pitch signals additive) plus a legit-input corpus that must pass.
import { describe, expect, it } from "vitest";
import { looksLikePromoSpam } from "@/lib/rag/spam";

describe("looksLikePromoSpam — spam corpus (must block)", () => {
  it("SP-01 mentioning the site's own domain is decisive on its own", () => {
    expect(looksLikePromoSpam("I just found grantedjobs.com and love it")).toBe(true);
    expect(looksLikePromoSpam("We can redesign your website for cheap")).toBe(true);
  });

  it("SP-03 greeting + one pitch signal crosses the threshold", () => {
    expect(looksLikePromoSpam("Hi, we help businesses like yours succeed")).toBe(true);
    expect(looksLikePromoSpam("Dear owner, would you be interested in our offer")).toBe(true);
  });

  it("SP-04 two independent pitch signals cross the threshold", () => {
    expect(
      looksLikePromoSpam(
        "We help brands stand out. Our agency can boost your instagram presence today.",
      ),
    ).toBe(true);
    expect(
      looksLikePromoSpam("Get on the first page of google with our seo services"),
    ).toBe(true);
  });
});

describe("looksLikePromoSpam — legit corpus (must pass)", () => {
  it("SP-02 a single signal alone is not enough", () => {
    expect(looksLikePromoSpam("would you like machine learning grant programs")).toBe(false);
  });

  it("SP-05 URLs, emails, and phone numbers are deliberately not signals", () => {
    expect(
      looksLikePromoSpam(
        "researcher jane@ualberta.ca, portfolio at https://janelab.ca, catalysis and CO2 capture, 780-555-0100",
      ),
    ).toBe(false);
  });

  it("SP-06 marketing-adjacent research topics are not spam", () => {
    expect(looksLikePromoSpam("social media marketing analytics research")).toBe(false);
    expect(looksLikePromoSpam("SEO algorithm fairness study")).toBe(false);
    expect(looksLikePromoSpam("instagram influence on teen mental health")).toBe(false);
  });

  it("SP-07 empty / whitespace input is not spam", () => {
    expect(looksLikePromoSpam("")).toBe(false);
    expect(looksLikePromoSpam("   \n  ")).toBe(false);
  });

  it("SP-08 characterization: a pasted cover letter CAN trip the gate (OBS-3)", () => {
    // "Dear …" greeting + "thanks for your time" = 2 signals. Documented in
    // DEFECTS.md as an accepted edge — cover letters aren't search queries —
    // but pinned so a tuning change is a conscious decision.
    expect(
      looksLikePromoSpam(
        "Dear hiring manager, I am a materials scientist. Thanks for your time.",
      ),
    ).toBe(true);
  });
});
