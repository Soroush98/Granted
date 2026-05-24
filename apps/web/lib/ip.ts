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

/** Rate-limit policy: each IP gets `RATE_LIMIT_MAX_SEARCHES` searches and is
 * then blocked permanently. To reset a specific IP for testing:
 *   delete from search_log where ip = '<the IP>';
 *
 * The cap is intentionally low because each search calls the Claude API for
 * the rerank step, and there is no signed-in account model to attribute
 * usage to. Raise this when there's a way to identify users. */
export const RATE_LIMIT_MAX_SEARCHES = 10;
