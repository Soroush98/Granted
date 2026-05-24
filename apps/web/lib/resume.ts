import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

/** Pull readable text out of a PDF buffer. */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  // unpdf returns string when mergePages is true, but the type allows string[].
  return Array.isArray(text) ? text.join("\n\n") : text;
}

/** Squash whitespace, drop control chars, cap length so the result fits in a URL.
 * 4,000 chars covers a typical paper's abstract + intro and most of a resume's
 * substantive content. Larger blobs blow out URL length limits in some proxies
 * and add noise to the embedding without much retrieval gain. */
export function normalizeDocumentText(raw: string, maxChars = 4000): string {
  const cleaned = raw
    .replace(/\r/g, "")
    // Strip control chars (C0 except newline/tab, plus DEL).
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

/** Back-compat alias — kept so any importer that hasn't been updated still works. */
export const normalizeResumeText = normalizeDocumentText;

/** Combine an uploaded document (resume, research paper, project brief, etc.)
 * and the user's goal into a single search query string. The "BACKGROUND" label
 * is left source-agnostic so the same shape works for every document type. */
export function buildQuery(documentText: string, goal: string): string {
  const goalTrim = goal.trim();
  const docTrim = normalizeDocumentText(documentText);
  if (!docTrim) return goalTrim;
  if (!goalTrim) return docTrim;
  return `GOAL: ${goalTrim}\n\nBACKGROUND:\n${docTrim}`;
}

// Older builds used "BACKGROUND (from resume):" as the separator. We accept
// both so links/bookmarks made before the rename still split correctly.
const BACKGROUND_SEPARATORS = [
  "\n\nBACKGROUND:\n",
  "\n\nBACKGROUND (from resume):\n",
];
const GOAL_PREFIX = "GOAL: ";

/** Inverse of buildQuery: split a combined query string back into goal +
 * background. Used by:
 *   - The search page's "What we sent the matcher" disclosure block.
 *   - Structured-filter auto-detection (location, org type, name lookup),
 *     which must scan ONLY the user's goal — author affiliations like
 *     "University of Calgary, Calgary, Canada" inside a research-paper
 *     background otherwise produce false-positive province filters.
 *
 * Returns `{ goal: "", background: "" }` for empty input. If no separator is
 * found, the entire string is treated as the goal. */
export function splitQueryParts(query: string): { goal: string; background: string } {
  if (!query) return { goal: "", background: "" };
  let sepIdx = -1;
  let sepLen = 0;
  for (const sep of BACKGROUND_SEPARATORS) {
    const idx = query.indexOf(sep);
    if (idx !== -1 && (sepIdx === -1 || idx < sepIdx)) {
      sepIdx = idx;
      sepLen = sep.length;
    }
  }
  if (sepIdx === -1) {
    const goal = query.startsWith(GOAL_PREFIX) ? query.slice(GOAL_PREFIX.length) : query;
    return { goal, background: "" };
  }
  const goalPart = query.slice(0, sepIdx);
  const goal = goalPart.startsWith(GOAL_PREFIX) ? goalPart.slice(GOAL_PREFIX.length) : goalPart;
  const background = query.slice(sepIdx + sepLen);
  return { goal, background };
}
