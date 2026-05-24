"use server";

import { redirect } from "next/navigation";
import { extractPdfText, buildQuery } from "@/lib/resume";
import { buildFilterParams, formToParams, readFilters } from "@/lib/filters";

// 20 MB ceiling — generous for resumes and for typical research papers
// (most fit under 5 MB; image-heavy reviews can push past 10 MB).
const MAX_PDF_BYTES = 20 * 1024 * 1024;

// Hard cap on the free-text goal. Long enough for a few descriptive sentences
// or a paragraph from a job-spec, short enough to prevent token-cost abuse
// (a malicious user otherwise pastes War and Peace and we ship it to Claude).
// Resume / paper body is capped separately at 4,000 chars in normalizeDocumentText.
const MAX_GOAL_CHARS = 2000;

// Filter form fields the search form may include. We pass them through to the
// /search URL so the page can apply them without a round-trip.
function forwardedFilterParams(formData: FormData): URLSearchParams {
  const filters = readFilters(formToParams(formData));
  return buildFilterParams(filters);
}

/** Form action: parse an uploaded resume PDF, combine with the user's goal,
 * and redirect to /search with the synthesized query in the URL. */
export async function searchWithResume(formData: FormData): Promise<void> {
  let goal = String(formData.get("q") ?? "").trim();
  // Truncate rather than reject — the user shouldn't have to retry. They get
  // 2,000 chars of semantic signal which is plenty for ranking purposes.
  if (goal.length > MAX_GOAL_CHARS) goal = goal.slice(0, MAX_GOAL_CHARS);
  const file = formData.get("resume");

  let resumeText = "";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PDF_BYTES) {
      redirect("/search?error=resume_too_large");
    }
    if (file.type && file.type !== "application/pdf") {
      redirect("/search?error=resume_not_pdf");
    }
    try {
      const buffer = await file.arrayBuffer();
      resumeText = await extractPdfText(buffer);
    } catch {
      redirect("/search?error=resume_parse_failed");
    }
  }

  const query = buildQuery(resumeText, goal);
  if (query.length < 20) {
    redirect("/search?error=query_too_short");
  }

  const params = forwardedFilterParams(formData);
  params.set("q", query);
  redirect(`/search?${params.toString()}`);
}
