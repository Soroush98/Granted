import "server-only";
import { env } from "@/lib/env";

/**
 * Verify a Cloudflare Turnstile token server-side.
 *
 * Fails OPEN when TURNSTILE_SECRET_KEY is not configured — so local dev and any
 * deploy that hasn't set up Turnstile yet keep working (the widget also renders
 * nothing without a site key). Once the secret IS set, a missing/invalid token
 * is rejected.
 */
export async function verifyTurnstile(token: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // not configured → don't block
  if (!token) return false;
  try {
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    });
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    // Network error reaching Cloudflare — fail closed (a real user can retry).
    console.error("[turnstile] verify error:", e);
    return false;
  }
}

/** True when Turnstile is configured (secret present). */
export function turnstileConfigured(): boolean {
  return !!env.TURNSTILE_SECRET_KEY;
}
