import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// The AI-cost surfaces (paid Voyage embed + Claude rerank/spike per request).
// Their per-IP rate limiting trusts `cf-connecting-ip`, which is only honest
// when the request actually traversed Cloudflare. We hard-gate these paths on a
// secret header that Cloudflare stamps on every proxied request (see
// infra/cloudflare/origin-lock.tf) so a request hitting the Vercel origin
// DIRECTLY — bypassing the WAF and forging cf-connecting-ip — is rejected.
const COST_PATHS = new Set([
  "/search",
  "/jobs",
  "/supervisors",
  "/research-pi",
  "/finders/search",
]);

// Constant-time string compare (Web-Crypto's timingSafeEqual isn't in the edge
// runtime). Length is not secret, so an early length check is fine.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Refreshes the Supabase auth session cookie on each request so Server
// Components and route handlers see a current session. Reads NEXT_PUBLIC_* env
// directly (middleware must stay lean — no server-only imports).
export async function middleware(request: NextRequest) {
  // Origin lock. OPT-IN: only enforced once ORIGIN_VERIFY_SECRET is set (after
  // the Cloudflare header rule is live and verified). Until then this is a
  // no-op, so it can't lock you out during rollout.
  const originSecret = process.env.ORIGIN_VERIFY_SECRET;
  if (originSecret && COST_PATHS.has(request.nextUrl.pathname)) {
    const presented = request.headers.get("x-origin-verify");
    if (!presented || !safeEqual(presented, originSecret)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // OAuth/PKCE safety net: a `?code=` that lands anywhere other than the
  // callback means Supabase fell back to the Site URL (the redirect URL wasn't
  // allow-listed). Route it through /auth/callback so the code is exchanged for
  // a session instead of being silently dropped on the page it landed on.
  const oauthCode = request.nextUrl.searchParams.get("code");
  if (oauthCode && request.nextUrl.pathname !== "/auth/callback") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback"; // keeps the ?code= query; `next` defaults to "/"
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set({ name, value, ...options }),
          );
        },
      },
    },
  );

  // IMPORTANT: nothing between createServerClient and getUser(), or the session
  // can fail to refresh and log users out at random.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Run on everything except static assets and the Stripe webhook (which needs
  // its untouched raw body for signature verification).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
