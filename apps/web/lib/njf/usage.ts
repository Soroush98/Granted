import "server-only";
import { after } from "next/server";
import { supabaseService } from "@/lib/db/supabase-server";
import {
  getClientIp,
  UNKNOWN_IP,
  SEARCH_BURST_MAX,
  SEARCH_BURST_WINDOW_SECS,
  SEARCH_DAILY_MAX,
  SEARCH_GLOBAL_DAILY_MAX,
  SEARCH_WEB_DAILY_MAX,
  DAY_SECS,
} from "@/lib/ip";

// Rate-limiting + query logging for the AI search surfaces (/search, /jobs,
// /supervisors, /research-pi). All call Voyage (embed) + Claude (rerank / spike
// extraction) per run, so they share ONE atomic, windowed quota enforced by the
// consume_quota() Postgres function. See migration 0010 and lib/ip.ts.

export type QuotaResult =
  | { ok: true; ip: string; dailyUsed: number; dailyRemaining: number }
  | { ok: false; ip: string; reason: "burst" | "ip" | "global"; retryAt: string | null };

type QuotaRow = { allowed: boolean; used: number; reset_at: string };

/**
 * Atomically CONSUME one search slot for the caller across three windows
 * (burst → per-IP daily → global daily). Call this BEFORE the expensive
 * embed/LLM work — each layer increments only when under its cap, so there's
 * no read-then-write race.
 *
 * Fails OPEN: if the RPC errors (DB hiccup), we allow the search rather than
 * hard-blocking users on infrastructure trouble. The error is logged.
 */
export async function consumeSearchQuota(): Promise<QuotaResult> {
  const ip = (await getClientIp()) ?? UNKNOWN_IP;
  const supabase = supabaseService();

  const consume = async (
    bucket: string,
    max: number,
    windowSecs: number,
  ): Promise<QuotaRow | null> => {
    const { data, error } = await supabase.rpc("consume_quota", {
      bucket_in: bucket,
      max_in: max,
      window_secs: windowSecs,
    });
    if (error) {
      console.error("[rate_limit] consume_quota failed:", error);
      return null; // fail open
    }
    // consume_quota RETURNS TABLE → supabase-js yields an array of one row.
    return Array.isArray(data) ? (data[0] as QuotaRow) : (data as QuotaRow | null);
  };

  // Order matters: the most restrictive short window first, so a throttled IP
  // doesn't burn its daily/global allowance on a request that's already denied.
  const burst = await consume(`burst:${ip}`, SEARCH_BURST_MAX, SEARCH_BURST_WINDOW_SECS);
  if (burst && !burst.allowed) return { ok: false, ip, reason: "burst", retryAt: burst.reset_at };

  const daily = await consume(`day:${ip}`, SEARCH_DAILY_MAX, DAY_SECS);
  if (daily && !daily.allowed) return { ok: false, ip, reason: "ip", retryAt: daily.reset_at };

  const global = await consume("global", SEARCH_GLOBAL_DAILY_MAX, DAY_SECS);
  if (global && !global.allowed) return { ok: false, ip, reason: "global", retryAt: global.reset_at };

  const used = daily?.used ?? 0;
  return { ok: true, ip, dailyUsed: used, dailyRemaining: Math.max(0, SEARCH_DAILY_MAX - used) };
}

/** Consume one slot from the per-IP WEB-search daily bucket (separate from and
 * on top of the normal search quota, because web search is far costlier). Call
 * this only after consumeSearchQuota() has already allowed the request, passing
 * its `ip`. Returns false when the daily web cap is hit — callers should skip
 * the web pass but still return grant results. Fails OPEN on RPC error. */
export async function consumeWebQuota(ip: string): Promise<boolean> {
  const supabase = supabaseService();
  const { data, error } = await supabase.rpc("consume_quota", {
    bucket_in: `web:${ip}`,
    max_in: SEARCH_WEB_DAILY_MAX,
    window_secs: DAY_SECS,
  });
  if (error) {
    console.error("[rate_limit] web consume_quota failed:", error);
    return true; // fail open
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean } | null;
  return row?.allowed ?? true;
}

/** User-facing refusal copy for a denied quota result. */
export function quotaMessage(r: Extract<QuotaResult, { ok: false }>): string {
  switch (r.reason) {
    case "burst":
      return (
        `You're searching very quickly — please wait a few minutes ` +
        `(limit ${SEARCH_BURST_MAX} searches per 10 minutes), then try again. ` +
        `You can still browse grants and view stats meanwhile.`
      );
    case "ip":
      return (
        `Daily search limit reached — ${SEARCH_DAILY_MAX} AI searches per day from ` +
        `your network, shared across all finders and Search. It resets within 24 ` +
        `hours. You can still browse grants and view stats without a search.`
      );
    case "global":
      return (
        `Search is paused briefly — we've hit today's overall capacity for AI ` +
        `searches. Please try again later. Browsing grants and stats still work.`
      );
  }
}

/** Fire-and-forget search-log write, post-response. Analytics only — it no
 * longer governs access. Best-effort, but errors are surfaced (not swallowed)
 * so a silently-failing insert is visible in the server logs. */
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
      if (error) console.error("[search_log] insert failed:", error);
    } catch (e) {
      console.error("[search_log] insert threw:", e);
    }
  });
}
