import "server-only";

/** Legal-entity suffixes to strip when matching a company to a GitHub org. */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "llp", "lp", "ulc", "corp",
  "corporation", "co", "company", "gmbh", "sa", "sas", "ltee", "ltée", "plc",
  "senc", "gp", "ag", "nv", "bv", "pte", "holdings", "group", "technologies",
  "technology", "labs", "laboratories", "systems", "solutions", "international",
]);

/** Reduce a raw company name to a cleaner core for GitHub matching:
 * drop a bilingual / alternate-name duplicate after a separator
 * ("IBM Canada Limited - IBM Canada Ltée" → "IBM Canada Limited"), then strip
 * trailing legal-entity words and punctuation. Geographic words (Canada, …) are
 * kept — they help org search relevance. */
export function cleanCompanyName(raw: string): string {
  // Take the part before a separator that usually introduces a duplicate name.
  let s = raw.split(/\s+[-|/]\s+|\s*\|\s*/)[0] ?? raw;
  // Tokenize on whitespace, drop trailing legal suffixes (possibly several).
  let words = s
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(norm(words[words.length - 1]!))) {
    words = words.slice(0, -1);
  }
  s = words.join(" ").trim();
  return s || raw.trim();
}

/** Lower-cased, alphanumeric-only form. */
export function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Significant normalized tokens of a cleaned company name (drops 1-char bits). */
export function companyTokens(cleaned: string): string[] {
  return cleaned
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 2);
}

/** Loose pre-filter: could this org login relate to the company at all? Used
 * only to decide which search hits are worth fetching org details for — NOT to
 * accept a match. Deliberately permissive (prefix / shared distinctive word);
 * orgConfirmed() then corroborates against the org's real name before accepting.
 * Guards against substring noise like "Umamii"⊅"amii". */
export function loginRelatesToCompany(login: string, cleaned: string): boolean {
  const nl = norm(login);
  const nc = norm(cleaned);
  if (nl.length < 2 || nc.length < 2) return false;
  if (nl === nc || nl.startsWith(nc)) return true;
  if (nc.startsWith(nl) && nl.length >= 3) return true;

  const words = companyTokens(cleaned);
  const loginTokens = login.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const first = words[0];
  if (first && first.length >= 3 && (nl === first || loginTokens.includes(first))) {
    return true;
  }
  return words.some((w) => w.length >= 4 && loginTokens.includes(w));
}

/** Confirm a candidate org actually belongs to the company by corroborating
 * against its real display name: every significant company word must appear as a
 * WHOLE word in the org's name. This rejects coincidental prefix/substring hits
 * — "Qube" vs "Qubes OS", "ICES" vs "ICESat-2 HackWeek", "University of
 * Waterloo" vs "Waterloo Rocketry" — while keeping true matches whose org name
 * echoes the company ("Amii"→"Amii Institute…", "Cohere"→"Cohere Labs").
 *
 * Exact login matches (Shopify→shopify, Coveo→coveo) are accepted outright.
 * Note: single generic words ("Carbon", "Titanium") can still collide with an
 * unrelated org legitimately bearing that word — domain data would be needed to
 * separate those, and we have none. */
export function orgConfirmed(cleaned: string, login: string, orgName: string | null): boolean {
  if (norm(login) === norm(cleaned)) return true;
  const cWords = companyTokens(cleaned);
  if (cWords.length === 0) return false;
  const nameWords = new Set(companyTokens(orgName ?? ""));
  return cWords.every((w) => nameWords.has(w));
}

/** Second, data-driven precision gate: do the org's own members corroborate the
 * company? Real org members list it in their GitHub `company` field — Cohere's
 * members say "Cohere", whereas `carbon-design-system`'s members say "IBM", not
 * "Carbon". So for a non-trivial org we require a fraction of members to name a
 * distinctive (≥4-char) company word. Small orgs (<5) and companies with no
 * distinctive word are accepted unchecked — too little signal to judge. This is
 * what separates the IBM-design-system / Titanium-Knights coincidences from a
 * company's real org, using data we already fetched (no extra API calls). */
export function corroboratedByMembers(
  cleaned: string,
  members: Array<{ company: string | null }>,
): boolean {
  const n = members.length;
  if (n < 5) return true;
  const distinct = companyTokens(cleaned).filter((w) => w.length >= 4);
  if (distinct.length === 0) return true;
  const need = Math.max(1, Math.ceil(0.2 * n));
  let hits = 0;
  for (const m of members) {
    const cf = norm(m.company);
    if (cf && distinct.some((w) => cf.includes(w)) && ++hits >= need) return true;
  }
  return false;
}
