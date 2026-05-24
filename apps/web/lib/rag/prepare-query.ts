import "server-only";
import type { SearchFilters } from "@/lib/db/types";

/**
 * Clean a user query *for the embedding step only*. The Voyage embedding is
 * the dominant signal in our hybrid retrieval (70% weight), so noise in the
 * query — filter words we've already applied as hard predicates, generic
 * filler, abbreviations the model doesn't expand — drowns out the actual
 * topic.
 *
 * Example: "labs in alberta doing ml" embeds poorly because "alberta" and
 * "labs" eat most of the signal and "ml" is only two letters. After this
 * helper it becomes "machine learning", which embeds cleanly against the
 * actual ML grant chunks.
 *
 * IMPORTANT — only the goal is cleaned. The BACKGROUND (resume / paper) is
 * preserved verbatim because it's rich prose where stopword removal hurts.
 */
import { splitQueryParts } from "@/lib/resume";

// Generic filler that contributes nothing to a topic match. Intentionally
// short — over-stripping is worse than under-stripping because it can erase
// the user's actual intent.
const FILLER_WORDS = new Set([
  "a", "an", "the", "any", "some", "all",
  "in", "of", "from", "for", "to", "at", "with", "by", "on",
  "and", "or", "but",
  "i", "me", "my", "we", "our", "you", "your",
  "doing", "do", "looking", "look", "find", "show", "see", "give",
  "labs", "lab",        // ambiguous in Canadian context; not a hard filter
  "place", "places",
  "that", "which", "who",
  "is", "are", "was", "were", "be", "been",
]);

// Common abbreviations the embedding model handles poorly when they appear
// alone in a short query. Expansion happens token-wise after stopword strip.
const ABBREVIATIONS: Record<string, string> = {
  "ml":      "machine learning",
  "ai":      "artificial intelligence",
  "nlp":     "natural language processing",
  "cv":      "computer vision",
  "llm":     "large language model",
  "llms":    "large language models",
  "iot":     "internet of things",
  "vr":      "virtual reality",
  "ar":      "augmented reality",
  "ev":      "electric vehicle",
  "evs":     "electric vehicles",
  "ccs":     "carbon capture and storage",
  "sdn":     "software defined networking",
  "5g":      "5g cellular networking",
  "6g":      "6g cellular networking",
  "saas":    "software as a service",
  "iaas":    "infrastructure as a service",
  "paas":    "platform as a service",
};

/**
 * Returns two query variants:
 *   - `embedText`: cleaned goal + raw background. Background prose helps
 *     semantic match (a resume's "PyTorch CUDA quantization" finds ML chunks
 *     even if the user's goal was terse). Cleaning the goal sharpens the
 *     topic signal so the embedding isn't drowned in filter words.
 *   - `ftsText`: cleaned goal *only*. websearch_to_tsquery ANDs all tokens
 *     by default, so a 4,000-char paper body forces every word to match in
 *     a grant chunk — guaranteed zero FTS hits. Stripping it lets the
 *     keyword side actually contribute.
 */
export function prepareEmbedQuery(
  query: string,
  applied: SearchFilters,
): { embedText: string; ftsText: string } {
  const { goal, background } = splitQueryParts(query);
  const cleanedGoal = cleanGoal(goal, applied);
  const ftsText = cleanedGoal || goal;

  let embedText: string;
  if (!background) {
    embedText = cleanedGoal || goal;
  } else if (!cleanedGoal) {
    embedText = background;
  } else {
    embedText = `GOAL: ${cleanedGoal}\n\nBACKGROUND:\n${background}`;
  }
  return { embedText, ftsText };
}

function cleanGoal(goal: string, applied: SearchFilters): string {
  if (!goal) return goal;

  // Words that became hard filters. The embed shouldn't waste capacity
  // matching against them again. Province-name list mirrors the location
  // detector's coverage.
  const filterWords = new Set<string>();
  if (applied.province) {
    for (const w of provinceWordsFor(applied.province)) filterWords.add(w);
  }
  if (applied.orgFilter) {
    // Mirror the org-type detector's source phrases.
    for (const w of orgTypeWords(applied.orgFilter)) filterWords.add(w);
  }

  const tokens = goal.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (const tok of tokens) {
    if (FILLER_WORDS.has(tok)) continue;
    if (filterWords.has(tok)) continue;
    const expanded = ABBREVIATIONS[tok];
    out.push(expanded ?? tok);
  }
  // Fallback: if cleaning erased everything, fall back to the original goal
  // so we never embed an empty string.
  return out.length > 0 ? out.join(" ") : goal;
}

function provinceWordsFor(code: string): string[] {
  const longNames: Record<string, string[]> = {
    ON: ["ontario", "on", "toronto", "ottawa", "mississauga", "hamilton", "kitchener", "waterloo", "london"],
    QC: ["quebec", "québec", "qc", "montreal", "montréal", "laval", "sherbrooke"],
    AB: ["alberta", "ab", "calgary", "edmonton"],
    BC: ["british", "columbia", "bc", "vancouver", "victoria", "burnaby", "kelowna"],
    NS: ["nova", "scotia", "ns", "halifax"],
    NB: ["new", "brunswick", "nb", "fredericton", "moncton"],
    NL: ["newfoundland", "labrador", "nl"],
    MB: ["manitoba", "mb", "winnipeg"],
    SK: ["saskatchewan", "sk", "saskatoon", "regina"],
    PE: ["prince", "edward", "island", "pe", "charlottetown"],
    YT: ["yukon", "yt"],
    NT: ["northwest", "territories", "nt"],
    NU: ["nunavut", "nu"],
  };
  return longNames[code] ?? [code.toLowerCase()];
}

function orgTypeWords(org: string): string[] {
  switch (org) {
    case "company":
      return ["companies", "company", "startup", "startups", "industry", "industries", "firm", "firms", "business", "businesses", "corporate", "corporates", "corporation", "corporations", "private", "sector"];
    case "university":
      return ["university", "universities", "academic", "academics", "academia"];
    case "research_institute":
      return ["research", "institute", "institutes"];
    case "nonprofit":
      return ["nonprofit", "nonprofits", "non", "profit", "charity", "charities"];
    case "government":
      return ["government", "governments"];
    default:
      return [];
  }
}
