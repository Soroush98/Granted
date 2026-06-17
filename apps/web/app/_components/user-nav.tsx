import Link from "next/link";
import { supabaseServer, supabaseService } from "@/lib/db/supabase-server";
import { freeSearchesRemaining, PASS_CREDITS } from "@/lib/njf/access";
import { FREE_ACCOUNT_MAX } from "@/lib/ip";
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

  // Free-tier users see their remaining monthly allowance; pass users see credits.
  const freeLeft = active ? 0 : await freeSearchesRemaining(user.id);

  return (
    <div className="flex items-center gap-3 text-sm">
      <Link
        href="/notes"
        className="hidden text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)] sm:inline"
      >
        Notes
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
        <>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              freeLeft > 0 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"
            }`}
            title={`Free searches left this 30-day window (${FREE_ACCOUNT_MAX} total). The Job Hunt Pass adds ${PASS_CREDITS}.`}
          >
            {freeLeft} free left
          </span>
          <Link href="/pass" className="btn-primary focus-ring rounded-full px-3 py-1 text-xs font-semibold">
            Get Pass
          </Link>
        </>
      )}
      <span className="hidden max-w-[14ch] truncate text-[var(--color-muted)] sm:inline" title={user.email}>
        {user.email}
      </span>
      <LogoutButton />
    </div>
  );
}
