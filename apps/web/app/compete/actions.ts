"use server";

import { after } from "next/server";
import { extractPdfText, normalizeDocumentText } from "@/lib/resume";
import { supabaseService } from "@/lib/db/supabase-server";
import { getClientIp, RATE_LIMIT_MAX_COMPETE, UNKNOWN_IP } from "@/lib/ip";
import { getOrFetchCohort } from "@/lib/talent/cohort";
import { analyzeCompetitiveness } from "@/lib/talent/analyze";
import type { CompeteOutcome } from "@/lib/talent/types";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_FIELD = 120; // company / role inputs

export type CompeteState = CompeteOutcome | null;

/** Server action behind the /compete form. Parses the resume, gates by IP,
 * resolves the (company, role) cohort, runs the competitiveness analysis, and
 * logs the result. Returns a tagged outcome — never throws to the client. */
export async function runCompete(
  _prev: CompeteState,
  formData: FormData,
): Promise<CompeteState> {
  const company = String(formData.get("company") ?? "").trim().slice(0, MAX_FIELD);
  const role = String(formData.get("role") ?? "").trim().slice(0, MAX_FIELD);
  if (!company || !role) {
    return { ok: false, error: "Enter both a company and a target role." };
  }

  // Resume from PDF upload, falling back to pasted text.
  let resumeText = "";
  const file = formData.get("resume");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PDF_BYTES) return { ok: false, error: "Resume PDF is too large (20 MB max)." };
    if (file.type && file.type !== "application/pdf") {
      return { ok: false, error: "Resume must be a PDF." };
    }
    try {
      resumeText = normalizeDocumentText(await extractPdfText(await file.arrayBuffer()));
    } catch {
      return { ok: false, error: "Couldn't read that PDF. Try pasting your resume text instead." };
    }
  }
  if (!resumeText) {
    resumeText = normalizeDocumentText(String(formData.get("resumeText") ?? ""));
  }
  if (resumeText.length < 80) {
    return { ok: false, error: "Add your resume (PDF or pasted text) so we can compare it." };
  }

  // Rate-limit gate — a cohort cache miss triggers paid provider spend.
  const ip = (await getClientIp()) ?? UNKNOWN_IP;
  const supabase = supabaseService();
  const { count } = await supabase
    .from("compete_log")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip);
  if ((count ?? 0) >= RATE_LIMIT_MAX_COMPETE) {
    return {
      ok: false,
      error: `Limit reached (${RATE_LIMIT_MAX_COMPETE} checks per IP, total).`,
    };
  }

  try {
    const { profiles, cached } = await getOrFetchCohort(company, role);
    const result = await analyzeCompetitiveness({
      resumeText,
      company,
      role,
      profiles,
      cached,
    });

    after(async () => {
      try {
        await supabaseService().from("compete_log").insert({
          company,
          role,
          verdict: result.verdict.verdict,
          ip,
        });
      } catch {
        // best-effort
      }
    });

    return result;
  } catch (e) {
    console.error("[compete] failed:", e);
    return {
      ok: false,
      error:
        "We couldn't gather profiles for that role right now. Try a more common role or company.",
    };
  }
}
