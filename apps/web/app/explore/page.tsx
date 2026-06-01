import type { Metadata } from "next";
import { Suspense } from "react";
import { EngineersForm } from "./_components/engineers-form";

export const metadata: Metadata = {
  title: "Engineers — Granted",
  description:
    "Find the engineers behind a Canadian company. Pick a funded-R&D company and we pull its engineers from the GitHub API — public org members where we can resolve the org, otherwise people who list it as their employer.",
};

// A cache miss falls through to live GitHub API calls.
export const maxDuration = 300;

export default function EngineersPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  return (
    <section className="mx-auto max-w-5xl py-8 sm:py-12">
      <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[var(--color-muted)] shadow-sm backdrop-blur">
        Engineers · the people building at a Canadian company
      </div>

      <h1 className="mt-6 text-center text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Who&rsquo;s <span className="text-gradient">engineering it</span>?
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-center text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
        Pick a Canadian company doing funded R&amp;D and we&rsquo;ll surface its
        engineers from GitHub — skim each one&rsquo;s work, languages, and links.
      </p>

      <div className="mt-10">
        <Suspense fallback={null}>
          <EngineersFormLoader searchParams={searchParams} />
        </Suspense>
      </div>

      <p className="mt-8 text-center text-xs text-[var(--color-muted)]">
        Public GitHub profile data only. We list public org members when a
        company&rsquo;s GitHub org is resolvable, otherwise people who name the
        company as their employer — so coverage and accuracy vary by company.
      </p>
    </section>
  );
}

/** Reads searchParams inside Suspense so the static header streams immediately
 * (a hand-off from a company page can arrive with ?company=). */
async function EngineersFormLoader({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const sp = await searchParams;
  return <EngineersForm initialCompany={(sp.company ?? "").slice(0, 120)} />;
}
