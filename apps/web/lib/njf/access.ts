import "server-only";
import { supabaseServer, supabaseService } from "@/lib/db/supabase-server";
import {
  getClientIp,
  UNKNOWN_IP,
  SEARCH_BURST_MAX,
  SEARCH_BURST_WINDOW_SECS,
  SEARCH_GLOBAL_DAILY_MAX,
  DAY_SECS,
  ANON_FREE_MAX,
  FREE_ACCOUNT_MAX,
  FREE_WINDOW_SECS,
  GRANT_COST,
  WEB_COST,
} from "@/lib/ip";

// Per-identity search gating. Replaces the old per-IP-only quota. Tiers:
//   anon  → consume_quota('anon:<ip>', 3, 30d)          (taste, then sign up)
//   free  → consume_quota('free:<userId>', 10, 30d)     (then buy the pass)
//   pass  → consume_pass_credit(userId, cost)            (500-credit ledger)
// Web search is PASS-ONLY (free/anon get an upsell). A web search spends
// WEB_COST credits, a grant search GRANT_COST. The global breaker caps total
// daily spend across everyone. All checks fail OPEN on DB error.

// 30-day Job Hunt Pass terms (used by the Stripe webhook to mint a pass).
export const PASS_CREDITS = 500;
export const PASS_DAYS = 30;

export type Tier = "anon" | "free" | "pass";
export type GateCode = "verify_email" | "signup" | "upgrade" | "pass_expired" | "rate" | "global";
export type Identity = { tier: Tier; ip: string; userId: string | null };
export type GateResult =
  | { ok: true; identity: Identity; creditsRemaining: number | null }
  | { ok: false; code: GateCode; message: string };

const RATE_MSG =
  `You're searching very quickly — please wait a few minutes (limit ${SEARCH_BURST_MAX} ` +
  `per 10 minutes), then try again.`;
const GLOBAL_MSG =
  `Search is paused briefly — we've hit today's overall capacity. Please try again later. ` +
  `Browsing grants and stats still work.`;

/** Atomically consume one unit from a fixed-window bucket. Fails open. */
async function consumeBucket(bucket: string, max: number, windowSecs: number): Promise<boolean> {
  const sb = supabaseService();
  const { data, error } = await sb.rpc("consume_quota", {
    bucket_in: bucket,
    max_in: max,
    window_secs: windowSecs,
  });
  if (error) {
    console.error("[access] consume_quota failed:", error);
    return true;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean } | null;
  return row?.allowed ?? true;
}

const globalOk = () => consumeBucket("global", SEARCH_GLOBAL_DAILY_MAX, DAY_SECS);

/**
 * Decide whether this search is allowed for the current identity and consume
 * the appropriate allowance/credits. Call ONCE per search, before the expensive
 * work. `wantWeb` true means the user toggled the live-web pass (pass-only).
 */
export async function gateSearch(opts: { wantWeb: boolean }): Promise<GateResult> {
  const ip = (await getClientIp()) ?? UNKNOWN_IP;
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  // ---- Signed-in ----
  if (user) {
    if (!user.email_confirmed_at) {
      return {
        ok: false,
        code: "verify_email",
        message: "Please verify your email — check your inbox for the confirmation link — then search.",
      };
    }

    const service = supabaseService();
    const { data: pass } = await service
      .from("passes")
      .select("status, expires_at, credits_remaining")
      .eq("user_id", user.id)
      .maybeSingle();
    const hasActivePass =
      !!pass &&
      pass.status === "active" &&
      new Date(pass.expires_at) > new Date() &&
      pass.credits_remaining > 0;

    // Web is pass-only.
    if (opts.wantWeb && !hasActivePass) {
      return {
        ok: false,
        code: pass ? "pass_expired" : "upgrade",
        message: "Web search is part of the Job Hunt Pass. Upgrade to search the live web.",
      };
    }

    if (hasActivePass) {
      // NOTE: we charge the full cost up front (web = WEB_COST). A rare web API
      // failure means the credit was spent for grant-only results — acceptable.
      const cost = opts.wantWeb ? WEB_COST : GRANT_COST;
      const { data, error } = await service.rpc("consume_pass_credit", {
        user_id_in: user.id,
        cost_in: cost,
      });
      if (error) {
        console.error("[access] consume_pass_credit failed:", error);
        return { ok: true, identity: { tier: "pass", ip, userId: user.id }, creditsRemaining: null };
      }
      const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; remaining: number } | null;
      if (!row?.allowed) {
        return {
          ok: false,
          code: "pass_expired",
          message: "Your Job Hunt Pass is out of credits. Grab a new pass to keep searching.",
        };
      }
      if (!(await globalOk())) return { ok: false, code: "global", message: GLOBAL_MSG };
      return { ok: true, identity: { tier: "pass", ip, userId: user.id }, creditsRemaining: row.remaining };
    }

    // Free account, grant search only (web handled above).
    if (!(await consumeBucket(`burst:${user.id}`, SEARCH_BURST_MAX, SEARCH_BURST_WINDOW_SECS)))
      return { ok: false, code: "rate", message: RATE_MSG };
    if (!(await consumeBucket(`free:${user.id}`, FREE_ACCOUNT_MAX, FREE_WINDOW_SECS))) {
      return {
        ok: false,
        code: "upgrade",
        message: `You've used your ${FREE_ACCOUNT_MAX} free searches. Get the 30-Day Job Hunt Pass for 500 searches.`,
      };
    }
    if (!(await globalOk())) return { ok: false, code: "global", message: GLOBAL_MSG };
    return { ok: true, identity: { tier: "free", ip, userId: user.id }, creditsRemaining: null };
  }

  // ---- Anonymous ----
  if (opts.wantWeb) {
    return {
      ok: false,
      code: "signup",
      message: "Sign up free to keep searching — web search is part of the Job Hunt Pass.",
    };
  }
  if (!(await consumeBucket(`burst:${ip}`, SEARCH_BURST_MAX, SEARCH_BURST_WINDOW_SECS)))
    return { ok: false, code: "rate", message: RATE_MSG };
  if (!(await consumeBucket(`anon:${ip}`, ANON_FREE_MAX, FREE_WINDOW_SECS))) {
    return {
      ok: false,
      code: "signup",
      message: `You've used your ${ANON_FREE_MAX} free searches. Sign up free for ${FREE_ACCOUNT_MAX} more.`,
    };
  }
  if (!(await globalOk())) return { ok: false, code: "global", message: GLOBAL_MSG };
  return { ok: true, identity: { tier: "anon", ip, userId: null }, creditsRemaining: null };
}

/**
 * READ (without consuming) how many of the FREE_ACCOUNT_MAX monthly free
 * searches a signed-in free-tier user has left. Mirrors the `free:<userId>`
 * fixed-window bucket that gateSearch() spends — windows are aligned and
 * non-overlapping, so the one whose start is within the last window is the
 * current one. Returns FREE_ACCOUNT_MAX when no row exists yet (none used).
 */
export async function freeSearchesRemaining(userId: string): Promise<number> {
  const since = new Date(Date.now() - FREE_WINDOW_SECS * 1000).toISOString();
  const { data, error } = await supabaseService()
    .from("rate_limit")
    .select("count")
    .eq("bucket", `free:${userId}`)
    .gt("window_start", since)
    .order("window_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[access] freeSearchesRemaining read failed:", error);
    return FREE_ACCOUNT_MAX; // fail open — don't show a scary 0
  }
  return Math.max(0, FREE_ACCOUNT_MAX - (data?.count ?? 0));
}
