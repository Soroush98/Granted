import "server-only";

/**
 * Cheap promo-spam detector for the search box.
 *
 * Bots paste cold-outreach pitches (Instagram growth, SEO, video ads, domain
 * registration) into any text input they find — /search is a GET form with no
 * Turnstile, so they land here and each one burns a Voyage embed + a Claude
 * rerank. This gate is pure string matching: it runs before the quota gate and
 * before any AI call, so a blocked query costs nothing.
 *
 * Tuned for precision over recall — a false positive blocks a real user, a
 * false negative just costs one search. Two independent signals are required,
 * with one exception: mentioning the site's own domain is decisive on its own,
 * because nobody describes a research topic by naming the site they're typing
 * into (every observed spam message contains "grantedjobs.com").
 *
 * Deliberately NOT signals: URLs, emails, phone numbers, length — pasted
 * resumes (a core legit input) contain all of those.
 */

const SITE_MENTION = /grantedjobs\.com|your (web\s?site|domain|home\s?page|landing page)/i;

// Cold-outreach openers: only meaningful at the very start of the text.
const GREETING_START = /^\s*(hi|hello|hey|dear|greetings)\b/i;

// One point each. Phrases are specific to solicitation prose — a legit query
// like "social media marketing analytics research" matches none of them.
const PITCH_SIGNALS: RegExp[] = [
  /\b(just|recently) (visited|came across|looked at|checked out|noticed)\b/i,
  /\bwould you (like|be interested|be open)\b/i,
  /\b(reply|respond) to this (email|message)\b/i,
  /\bsend (you |over )?(some )?(more )?(info|information|details|pricing|samples)\b/i,
  /\bfree (consultation|audit|trial|quote|demo)\b/i,
  /\bwe help (brands|businesses|companies|clients)\b/i,
  /\bour (agency|team|company) (can|will|helps?|specialis|specializ)/i,
  /\b(grow|scale|boost) your (business|brand|instagram|audience|presence|sales|traffic)\b/i,
  /\binstagram (followers|presence|growth|page|profile)\b/i,
  /\b(targeted|real|organic) followers\b/i,
  /\bseo (services|audit|ranking|package)/i,
  /\b(first|1st) page (of|on) google\b/i,
  /\bgoogle('s)? (first page|ranking|search results|index)\b/i,
  /\b(register|submit) .{0,40}(search index|directory|search engines)\b/i,
  /\bcongrats on your (new )?(domain|website|site|launch)\b/i,
  /\b(promotional|explainer|advertising) video\b/i,
  /\bunsubscribe\b|\bopt.?out\b/i,
  /\bthanks for your time\b/i,
];

/** True when the text reads as a marketing pitch, not a search query. */
export function looksLikePromoSpam(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (SITE_MENTION.test(t)) return true;
  let score = GREETING_START.test(t) ? 1 : 0;
  for (const re of PITCH_SIGNALS) {
    if (re.test(t)) score += 1;
    if (score >= 2) return true;
  }
  return false;
}
