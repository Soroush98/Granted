import type { Metadata } from "next";
import { Suspense } from "react";
import { IntroForm } from "./_components/intro-form";

export const metadata: Metadata = {
  title: "Intro Kit — Granted",
  description:
    "Pick a Canadian company that just won public R&D funding. We find the engineer there most like you and draft a warm intro asking for a referral — grounded in the company's actual funded work.",
};

export const maxDuration = 300;

export default function IntroPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  return (
    <section className="mx-auto max-w-3xl py-8 sm:py-12">
      <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[var(--color-muted)] shadow-sm backdrop-blur">
        Intro Kit · get referred before the job is posted
      </div>

      <h1 className="mt-6 text-center text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Get a <span className="text-gradient">warm intro</span> into a funded company
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-center text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
        Name a Canadian company that just won R&amp;D funding and paste your background.
        We&rsquo;ll find the engineer there most like you and draft the message to send —
        grounded in their <span className="font-medium text-[var(--color-ink)]">actual funded work</span>.
      </p>

      <div className="mt-10">
        <Suspense fallback={null}>
          <IntroFormLoader searchParams={searchParams} />
        </Suspense>
      </div>

      <p className="mt-8 text-center text-xs text-[var(--color-muted)]">
        A referral converts far better than a cold application. We surface a real person and a
        first draft — you make it yours before you hit send.
      </p>
    </section>
  );
}

async function IntroFormLoader({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const sp = await searchParams;
  return <IntroForm initialCompany={(sp.company ?? "").slice(0, 120)} />;
}
