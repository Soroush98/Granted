import type { Metadata } from "next";
import { CompeteForm } from "./_components/compete-form";

export const metadata: Metadata = {
  title: "Am I Competitive? — Granted",
  description:
    "Pick a company and a role, and see how your resume stacks up against ~20 people who already hold that role — plus the person most similar to you.",
};

// First-run cohort fetches (cache miss → paid provider) can take 30–120s with a
// real scraper. Give the server action room; mock runs return instantly.
export const maxDuration = 300;

export default function ComparePage() {
  return (
    <section className="mx-auto max-w-2xl py-8 sm:py-12">
      <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[var(--color-muted)] shadow-sm backdrop-blur">
        New · benchmark yourself against a real cohort
      </div>

      <h1 className="mt-6 text-center text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Are you <span className="text-gradient">competitive</span> for that role?
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-center text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
        Name a company and a role — say{" "}
        <span className="font-medium text-[var(--color-ink)]">Data Engineer at Amii</span>. We
        gather ~20 recent profiles of people already in that role, compare them against your
        resume, and tell you honestly where you stand — then introduce you to the person whose
        background most resembles yours.
      </p>

      <div className="mt-10">
        <CompeteForm />
      </div>

      <p className="mt-8 text-center text-xs text-[var(--color-muted)]">
        Public profile data only, via a third-party source. This is guidance, not a hiring
        decision — always verify before reaching out.
      </p>
    </section>
  );
}
