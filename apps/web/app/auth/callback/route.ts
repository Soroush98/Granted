import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Exchanges the code from an OAuth (Google), email-confirmation, or
// password-recovery link for a session, then redirects on.
//
// IMPORTANT: the session cookies must be written onto the SAME response we
// return. Using next/headers cookies() + a separate NextResponse.redirect()
// drops the Set-Cookie headers on the new redirect response, so the user lands
// back signed-out. Here we build the redirect first and have the Supabase
// client set cookies directly on it (same pattern as middleware.ts).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` is attacker-controlled. Only allow same-origin relative paths —
  // reject protocol-relative ("//evil.com") and backslash variants that
  // browsers resolve to an external host (open-redirect / phishing vector).
  const rawNext = searchParams.get("next") ?? "/";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/";
  // Provider errors (e.g. the user cancelled Google consent) come back here too.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (providerError) {
    console.error("[auth/callback] provider error:", providerError);
    return fail("auth");
  }
  if (!code) return fail("auth");

  // Build the redirect up front; cookies get attached to THIS response.
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Incoming request cookies include the PKCE code-verifier set at sign-in.
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set({ name, value, ...options }),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
    return fail("auth");
  }
  return response;
}
