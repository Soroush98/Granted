import "server-only";
import { after } from "next/server";
import { supabaseService } from "@/lib/db/supabase-server";
import { getClientIp, RATE_LIMIT_MAX_SEARCHES, UNKNOWN_IP } from "@/lib/ip";

// Rate-limiting + query logging for the NJF spike finders (/jobs,
// /supervisors, /research-pi). These call Voyage (embed) + Claude (spike
// extraction) on every run just like /search, so they draw from the SAME
// per-IP lifetime bucket: recent_search_count() counts every search_log row
// for an IP, so one cap of RATE_LIMIT_MAX_SEARCHES spans all four entry points.

type LimitResult =
  | { ok: true; ip: string }
  | { ok: false; ip: string; used: number };

/** Per-IP lifetime gate, mirroring app/search/results.tsx. Call BEFORE the
 * expensive embed/LLM work so a capped IP is refused for free. */
export async function checkSearchLimit(): Promise<LimitResult> {
  const ip = (await getClientIp()) ?? UNKNOWN_IP;
  const supabase = supabaseService();
  const { data } = await supabase.rpc("recent_search_count", { ip_in: ip });
  const used = typeof data === "number" ? data : Number(data ?? 0);
  if (used >= RATE_LIMIT_MAX_SEARCHES) return { ok: false, ip, used };
  return { ok: true, ip };
}

/** Refusal copy shown in the finder forms when an IP is over the cap. */
export function searchLimitMessage(used: number): string {
  return (
    `Search limit reached — you've used all ${used} AI searches allowed from ` +
    `this IP (cap of ${RATE_LIMIT_MAX_SEARCHES}, shared across all finders and ` +
    `Search). You can still browse grants and view stats without a search.`
  );
}

/** Fire-and-forget search-log write, post-response. Best-effort: a failure
 * here must never break the user's result. Mirrors app/search/results.tsx. */
export function logSearch(entry: {
  query: string;
  orgFilter: string | null;
  resultCount: number;
  ip: string;
}): void {
  after(async () => {
    try {
      const supabase = supabaseService();
      const { error } = await supabase.from("search_log").insert({
        query: entry.query,
        org_filter: entry.orgFilter,
        result_count: entry.resultCount,
        ip: entry.ip,
      });
      // Supabase returns errors in the response, not as throws — surface them
      // so a silently-failing insert is visible in the server logs.
      if (error) console.error("[search_log] insert failed:", error);
    } catch (e) {
      // logging is best-effort, but log the failure so it isn't invisible.
      console.error("[search_log] insert threw:", e);
    }
  });
}
