import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";

export const metadata: Metadata = {
  title: "Find companies doing your exact work — Granted",
  description:
    "Paste your background. Granted breaks it into your distinctive strengths and finds Canadian companies funded to do that work — including ones not advertising jobs.",
};

export default function JobsPage() {
  return (
    <section>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Find companies doing your exact work</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Paste your background. We break it into your most distinctive strengths — not generic field
          labels — and find Canadian companies <span className="font-medium text-[var(--color-ink)]">funded</span> to
          do that exact work, including ones that aren&rsquo;t posting jobs. Every match shows the real
          grant, so you have a concrete reason to reach out.
        </p>
      </header>
      <SpikeFinder
        kind="jobs"
        webSearchOption
        copy={{
          placeholder: "Paste your resume text, or a few sentences about your background, projects, and tools…",
          ctaIdle: "Find companies",
          ctaBusy: "Finding companies…",
          searched: "Canadian companies",
        }}
      />
    </section>
  );
}
