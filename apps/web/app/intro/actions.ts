"use server";

import { supabaseService } from "@/lib/db/supabase-server";
import { resolveCompany } from "@/lib/engineers/company";
import { getOrFetchDirectory } from "@/lib/engineers/directory";
import { mergeByLogin, poolForCompany } from "@/lib/people/pool";
import { generateIntroKit } from "@/lib/intro/kit";
import type { GroundingGrant, IntroOutcome } from "@/lib/intro/types";

const MAX_FIELD = 120;

export type IntroState = IntroOutcome | null;

/** Server action behind the Intro Kit. Resolves the Canadian company, pulls its
 * engineers (cache-first) and the grant best suited to ground an outreach, then
 * has Claude pick the most-similar engineer and draft the message. Never throws. */
export async function buildIntroKit(
  _prev: IntroState,
  formData: FormData,
): Promise<IntroState> {
  const company = String(formData.get("company") ?? "").trim().slice(0, MAX_FIELD);
  const background = String(formData.get("background") ?? "").trim();
  if (!company) return { ok: false, error: "Enter a Canadian company name." };
  if (background.length < 40) {
    return { ok: false, error: "Add a few lines about your background (40+ characters)." };
  }

  try {
    const resolved = await resolveCompany(company);
    if (!resolved) {
      return {
        ok: false,
        error: `"${company}" isn't in our Canadian funded-R&D index. Try a company that has received public funding.`,
      };
    }

    // Candidate referral targets = the company's GitHub org/search engineers
    // PLUS Canadian-pool people who self-report this employer (covers companies
    // with no public org). Deduped, most-followed first.
    const [{ engineers: orgEngineers }, pool, grant] = await Promise.all([
      getOrFetchDirectory(resolved),
      poolForCompany(resolved.id),
      topGrant(resolved.id),
    ]);
    const engineers = mergeByLogin(orgEngineers, pool);

    if (engineers.length === 0) {
      return {
        ok: false,
        error: `We couldn't find public engineers at ${resolved.display_name} on GitHub yet, so there's no one to introduce you to. Try another funded company.`,
      };
    }

    const kit = await generateIntroKit({
      companyName: resolved.display_name,
      grant,
      engineers,
      background,
    });

    return {
      ok: true,
      company: {
        display_name: resolved.display_name,
        province: resolved.province,
        city: resolved.city,
      },
      grant,
      engineer: kit.engineer,
      why_match: kit.why_match,
      subject: kit.subject,
      message: kit.message,
    };
  } catch (e) {
    console.error("[intro] failed:", e);
    return { ok: false, error: "We couldn't build an intro kit right now. Try again in a moment." };
  }
}

/** The grant best suited to ground an outreach: a sizeable award that has a
 * description (so the message can reference real work), else the largest. */
async function topGrant(companyId: string): Promise<GroundingGrant | null> {
  const supabase = supabaseService();
  const [{ data: grants }, { data: programs }] = await Promise.all([
    supabase
      .from("grants")
      .select("title, program_id, amount_cad, fiscal_year, start_date, description")
      .eq("recipient_id", companyId)
      .order("amount_cad", { ascending: false, nullsFirst: false })
      .limit(8),
    supabase.from("funding_programs").select("id, name"),
  ]);
  if (!grants || grants.length === 0) return null;

  const programName = new Map((programs ?? []).map((p) => [p.id, p.name] as const));
  const chosen = grants.find((g) => g.description && g.description.trim()) ?? grants[0]!;
  return {
    title: chosen.title,
    program: programName.get(chosen.program_id) ?? null,
    amount_cad: chosen.amount_cad,
    fiscal_year: chosen.fiscal_year,
    start_date: chosen.start_date,
    description: chosen.description,
  };
}
