import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { supabaseServer, supabaseService } from "@/lib/db/supabase-server";
import { BuyPassButton } from "@/app/_components/buy-pass-button";
import { PASS_CREDITS, PASS_DAYS } from "@/lib/njf/access";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Pricing — Granted" };

const PASS_PERKS = [
  `${PASS_CREDITS} searches — enough to hunt seriously`,
  `Live web search: companies with fresh funding in your niche`,
  `All finders: jobs, supervisors, and PIs`,
  `Valid ${PASS_DAYS} days from purchase`,
];

const FREE_PERKS = [
  `10 searches across all finders`,
  `Browse the full grant database`,
  `Funding stats and sources`,
];

// Page shell is static; the parts that read searchParams / the session are
// isolated in <Suspense> (required under Cache Components).
export default function PassPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  return (
    <section className="mx-auto max-w-3xl">
      <Suspense fallback={null}>
        <StatusBanner searchParams={searchParams} />
      </Suspense>

      <header className="mb-10 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          One job hunt. <span className="text-gradient">One simple price.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
          No subscription, no auto-renew, nothing to cancel. Buy a pass when you&rsquo;re hunting;
          stop paying when you&rsquo;re hired.
        </p>
        <p className="mx-auto mt-3 text-base text-[var(--color-muted)]">
          A thorough hunt runs 30–50 searches — one per strength, per angle, per region.
        </p>
      </header>

      <div className="grid items-start gap-5 sm:grid-cols-2">
        {/* Free tier */}
        <div className="paper p-6">
          <h2 className="font-semibold tracking-tight">Free</h2>
          <p className="mt-2 font-mono text-3xl font-semibold">$0</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">to try it out</p>
          <ul className="mt-5 grid gap-2 text-sm">
            {FREE_PERKS.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span className="mt-0.5 text-[var(--color-accent)]">✓</span> {p}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="btn-ghost focus-ring mt-6 block px-5 py-2.5 text-center text-sm font-semibold"
          >
            Sign up free
          </Link>
        </div>

        {/* Pass — highlighted */}
        <div className="paper relative border-[1.5px] border-[var(--color-accent)] p-6 shadow-[0_8px_30px_-12px_rgba(79,70,229,0.35)]">
          <span className="stamp absolute -top-3 right-6">
            Recommended
          </span>
          <h2 className="font-semibold tracking-tight">30-Day Job Hunt Pass</h2>
          <p className="mt-2 font-mono text-3xl font-semibold">
            {env.NEXT_PUBLIC_PASS_PRICE ?? "One-time"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">one-time payment · no auto-renew</p>
          <ul className="mt-5 grid gap-2 text-sm">
            {PASS_PERKS.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span className="mt-0.5 text-[var(--color-accent)]">✓</span> {p}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Suspense fallback={<div className="h-10 animate-pulse rounded-full bg-[var(--color-border)]/50" />}>
              <PassCta />
            </Suspense>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
        Browsing grants and viewing stats is always free, with or without an account.
      </p>
    </section>
  );
}

async function StatusBanner({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  if (status === "success") {
    return (
      <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        Payment received — your Job Hunt Pass is active. Happy hunting!
      </p>
    );
  }
  if (status === "cancelled") {
    return (
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Checkout cancelled — no charge was made.
      </p>
    );
  }
  return null;
}

async function PassCta() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        <Link href="/login?next=/pass" className="font-semibold text-[var(--color-ink)] underline">
          Log in
        </Link>{" "}
        or{" "}
        <Link href="/signup" className="font-semibold text-[var(--color-ink)] underline">
          create a free account
        </Link>{" "}
        to get the pass.
      </p>
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

  if (active) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        Your pass is active — <span className="font-semibold">{pass!.credits_remaining} credits</span> left,
        expires {new Date(pass!.expires_at).toLocaleDateString()}.
        <div className="mt-3">
          <BuyPassButton label="Buy another pass" />
        </div>
      </div>
    );
  }
  return <BuyPassButton />;
}
