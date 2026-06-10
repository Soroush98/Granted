import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/db/supabase-server";

// Exchanges the code from an email-confirmation or password-recovery link for a
// session (cookies set via the SSR server client), then redirects on.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
