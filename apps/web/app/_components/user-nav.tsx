import Link from "next/link";
import { supabaseServer, supabaseService } from "@/lib/db/supabase-server";
import { LogoutButton } from "./logout-button";

// Header auth area. Reads the session (dynamic — mount inside <Suspense> in the
// layout so the rest of the page can stay static under Cache Components).
export async function UserNav() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Link href="/login" className="text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:underline">
          Log in
        </Link>
        <Link
          href="/signup"
          className="btn-primary focus-ring rounded-full px-3 py-1 text-xs font-semibold"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const { data: pass } = await supabaseService()
    .from("passes")
    .select("status, expires_at, credits_remaining")
    .eq("user_id", user.id)
    .maybeSingle();
  const active =
    !!pass &&
    pass.status === "active" &&
    new Date(pass.expires_at) > new Date() &&
    pass.credits_remaining > 0;

  return (
    <div className="flex items-center gap-3 text-sm">
      <Link
        href="/notes"
        className="font-[family-name:var(--font-mono)] text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:underline"
      >
        my notes
      </Link>
      {active ? (
        <Link
          href="/pass"
          className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          title="Job Hunt Pass credits remaining"
        >
          {pass!.credits_remaining} credits
        </Link>
      ) : (
        <Link href="/pass" className="btn-primary focus-ring rounded-full px-3 py-1 text-xs font-semibold">
          Get Pass
        </Link>
      )}
      <span className="hidden max-w-[14ch] truncate text-[var(--color-muted)] sm:inline" title={user.email}>
        {user.email}
      </span>
      <LogoutButton />
    </div>
  );
}
