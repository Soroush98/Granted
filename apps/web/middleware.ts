import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session cookie on each request so Server
// Components and route handlers see a current session. Reads NEXT_PUBLIC_* env
// directly (middleware must stay lean — no server-only imports).
export async function middleware(request: NextRequest) {
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
