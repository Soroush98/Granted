"use server";

import { supabaseService } from "@/lib/db/supabase-server";
import { getClientIp, RATE_LIMIT_MAX_ENGINEERS, UNKNOWN_IP } from "@/lib/ip";
import { resolveCompany } from "@/lib/engineers/company";
import { getOrFetchDirectory } from "@/lib/engineers/directory";
import { mergeByLogin, poolForCompany } from "@/lib/people/pool";
import type { EngineersOutcome } from "@/lib/engineers/types";

const MAX_FIELD = 120;

export type EngineersState = EngineersOutcome | null;

/** Server action behind the /explore (Engineers) lookup. Resolves the typed
 * name to a Canadian company in the `companies` table, then resolves that
 * company's engineers from the GitHub API (cache-first). Gated by a per-IP rate
 * limit so a cache MISS can't hammer the shared GitHub token. Never throws. */
export async function loadEngineers(
  _prev: EngineersState,
  formData: FormData,
): Promise<EngineersState> {
  const company = String(formData.get("company") ?? "").trim().slice(0, MAX_FIELD);
  if (!company) {
    return { ok: false, error: "Enter a Canadian company name." };
  }

  // Rate-limit gate — a directory cache miss hits the GitHub API.
  const ip = (await getClientIp()) ?? UNKNOWN_IP;
  const supabase = supabaseService();
  const { count } = await supabase
    .from("engineers_log")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip);
  if ((count ?? 0) >= RATE_LIMIT_MAX_ENGINEERS) {
    return {
      ok: false,
      error: `Limit reached (${RATE_LIMIT_MAX_ENGINEERS} lookups per IP, total).`,
    };
  }

  try {
    const resolved = await resolveCompany(company);
    if (!resolved) {
      return {
        ok: false,
        error: `"${company}" isn't in our Canadian companies index. Try a company that has received funded R&D.`,
      };
    }

    const [{ source, github_org, engineers: orgEngineers, cached }, pool] =
      await Promise.all([getOrFetchDirectory(resolved), poolForCompany(resolved.id)]);
    // Augment the org/search result with Canadian-pool people who name this
    // employer (deduped) — broadens coverage, especially when there's no org.
    const engineers = mergeByLogin(orgEngineers, pool);

    // Log the lookup (best-effort; ignore if the table isn't there yet).
    if (!cached) {
      await supabase
        .from("engineers_log")
        .insert({ company: resolved.display_name, source, ip })
        .then(undefined, () => {});
    }

    return {
      ok: true,
      company: resolved,
      source: orgEngineers.length === 0 && pool.length > 0 ? "search" : source,
      github_org,
      count: engineers.length,
      cached,
      engineers,
    };
  } catch (e) {
    console.error("[engineers] failed:", e);
    return {
      ok: false,
      error:
        "We couldn't gather engineers for that company right now. Try another Canadian company.",
    };
  }
}
