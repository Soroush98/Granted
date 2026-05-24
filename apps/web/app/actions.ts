"use server";

import { redirect } from "next/navigation";
import { extractPdfText, buildQuery } from "@/lib/resume";
import { buildFilterParams, formToParams, readFilters } from "@/lib/filters";

// 20 MB ceiling — generous for resumes and for typical research papers
// (most fit under 5 MB; image-heavy reviews can push past 10 MB).
const MAX_PDF_BYTES = 20 * 1024 * 1024;

// Filter form fields the search form may include. We pass them through to the
// /search URL so the page can apply them without a round-trip.
function forwardedFilterParams(formData: FormData): URLSearchParams {
  const filters = readFilters(formToParams(formData));
  return buildFilterParams(filters);
}

/** Form action: parse an uploaded resume PDF, combine with the user's goal,
 * and redirect to /search with the synthesized query in the URL. */
export async function searchWithResume(formData: FormData): Promise<void> {
  const goal = String(formData.get("q") ?? "").trim();
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
