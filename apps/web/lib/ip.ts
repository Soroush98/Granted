import "server-only";
import { headers } from "next/headers";

/**
 * Best-effort client IP for rate-limiting. Reads the trusted forwarding
 * headers a proxy / CDN would set, in precedence order, and falls back to
 * the literal NextRequest IP when running locally (no proxy, no header).
 *
 * Returns null when no IP can be determined — callers should treat that as
 * "unknown" and decide their own policy (we treat it as "share one bucket"
 * by using a constant marker).
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const candidates = [
    h.get("cf-connecting-ip"),               // Cloudflare
    h.get("x-vercel-forwarded-for"),         // Vercel edge
    firstAddress(h.get("x-forwarded-for")),  // standard proxy chain (client, hop1, hop2, ...)
    h.get("x-real-ip"),                      // nginx-style
  ];
  for (const c of candidates) {
    if (c && c.length > 0) return c;
  }
  return null;
}

/** "client, proxy1, proxy2" → "client". */
function firstAddress(value: string | null): string | null {
  if (!value) return null;
  const comma = value.indexOf(",");
  return (comma === -1 ? value : value.slice(0, comma)).trim() || null;
}

/** Marker used when getClientIp() can't determine a real IP — keeps the
 * unknown-IP bucket separate from any specific address. */
export const UNKNOWN_IP = "_unknown";

/** Rate-limit policy for the AI search surfaces. Enforced atomically via the
 * `consume_quota` Postgres function (see migration 0010 and lib/njf/usage.ts),
 * NOT by counting search_log rows. Three layered windows:
 *
 *   - burst:  a short-window throttle so one IP can't loop the expensive
 *             embed+Claude path. 3 per 10 minutes.
 *   - daily:  the per-IP allowance. 10 per rolling day (was a permanent
 *             lifetime cap; now it self-heals).
 *   - global: a circuit breaker on TOTAL daily spend across all IPs — the one
 *             thing per-IP limits can't do (defends against IP rotation /
 *             distributed abuse). Tune to your acceptable daily API bill.
 *
 * To reset a specific IP for testing:
 *   delete from rate_limit where bucket like '%<the IP>';
 */
export const SEARCH_BURST_MAX = 3;
export const SEARCH_BURST_WINDOW_SECS = 600; // 10 minutes
export const SEARCH_DAILY_MAX = 10;
export const SEARCH_GLOBAL_DAILY_MAX = 2000;
export const DAY_SECS = 86_400;
