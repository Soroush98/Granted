"use client";

import { useActionState } from "react";
import { ResumeInput } from "@/app/_components/resume-input";
import { runCompete, type CompeteState } from "../actions";
import { VerdictCard } from "./verdict-card";
import { MostSimilarCard } from "./most-similar-card";

export function CompeteForm() {
  const [state, formAction, isPending] = useActionState<CompeteState, FormData>(
    runCompete,
    null,
  );

  return (
    <div className="grid gap-8">
      <form
        action={formAction}
        className="grid gap-4 rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_8px_32px_-12px_rgba(11,13,16,0.12)] backdrop-blur sm:p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Company
            </span>
            <input
              name="company"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="e.g. Amii"
              className="focus-ring w-full rounded-2xl border border-black/10 bg-white p-3 text-base shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Target role
            </span>
            <input
              name="role"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="e.g. Data Engineer"
              className="focus-ring w-full rounded-2xl border border-black/10 bg-white p-3 text-base shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
            />
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Your resume (PDF)
          </span>
          <ResumeInput />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            …or paste your resume / background
          </span>
          <textarea
            name="resumeText"
            rows={5}
            maxLength={8000}
            autoComplete="off"
            placeholder="Paste your experience, skills, and education if you don't have a PDF handy."
            className="focus-ring w-full resize-y rounded-2xl border border-black/10 bg-white p-4 text-base shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="btn-primary focus-ring mx-auto mt-1 rounded-full px-7 py-3 text-sm font-semibold disabled:opacity-60"
        >
          {isPending ? "Gathering profiles…" : "Check my competitiveness  →"}
        </button>
      </form>

      {isPending && (
        <p className="text-center text-sm text-[var(--color-muted)]">
          Gathering ~20 recent profiles and comparing them with your resume. This can take a
          moment on the first run for a new company/role.
        </p>
      )}

      {state && !isPending && (
        <Results state={state} />
      )}
    </div>
  );
}

function Results({ state }: { state: NonNullable<CompeteState> }) {
  if (!state.ok) {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        {state.error}
      </p>
    );
  }

  const exploreHref = `/explore?company=${encodeURIComponent(state.company)}`;

  return (
    <div className="grid gap-6">
      <VerdictCard result={state} />
      {state.most_similar ? (
        <MostSimilarCard person={state.most_similar} />
      ) : (
        <div className="rounded-2xl border border-black/10 bg-white/60 p-5 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-[var(--color-ink)]">
            🔒 Your closest-match intro unlocks once you&rsquo;re in range.
          </p>
          <p className="mt-1">
            Work through the roadmap above first — once your background lines up with this role,
            we&rsquo;ll introduce you to the person most like you so you can learn from their path.
          </p>
        </div>
      )}

      <a
        href={exploreHref}
        className="card-lift focus-ring flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/70 p-5 text-left backdrop-blur"
      >
        <span>
          <span className="block text-[15px] font-semibold text-[var(--color-ink)]">
            See the engineers at {state.company}  →
          </span>
          <span className="block text-sm text-[var(--color-muted)]">
            Browse who&rsquo;s building there, sourced from GitHub.
          </span>
        </span>
        <span aria-hidden className="text-xl text-[var(--color-accent)]">↗</span>
      </a>

      <p className="text-center text-xs text-[var(--color-muted)]">
        Compared against {state.cohort_size} real, public profiles
        {state.cached ? " (reused from a recent lookup)" : ""}. This is guidance, not a hiring
        decision — always double-check details before reaching out.
      </p>
    </div>
  );
}
