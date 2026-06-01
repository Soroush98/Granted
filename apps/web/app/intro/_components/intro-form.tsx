"use client";

import { useActionState } from "react";
import { buildIntroKit, type IntroState } from "../actions";
import { IntroResult } from "./intro-result";

export function IntroForm({ initialCompany }: { initialCompany: string }) {
  const [state, formAction, isPending] = useActionState<IntroState, FormData>(
    buildIntroKit,
    null,
  );

  return (
    <div className="grid gap-8">
      <form
        action={formAction}
        className="mx-auto grid w-full max-w-2xl gap-4 rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_8px_32px_-12px_rgba(11,13,16,0.12)] backdrop-blur sm:p-6"
      >
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Canadian company
          </span>
          <input
            name="company"
            required
            maxLength={120}
            autoComplete="off"
            defaultValue={initialCompany}
            placeholder="e.g. Cohere, Shopify, Coveo, Amii"
            className="focus-ring w-full rounded-2xl border border-black/10 bg-white p-3 text-base shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Your background
          </span>
          <textarea
            name="background"
            required
            minLength={40}
            rows={5}
            placeholder="Paste a few lines of your resume — your stack, domains, and what you've shipped. The more specific, the better the match and the message."
            className="focus-ring w-full resize-y rounded-2xl border border-black/10 bg-white p-3 text-sm leading-relaxed shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="btn-primary focus-ring h-12 rounded-full px-6 text-sm font-semibold disabled:opacity-60"
        >
          {isPending ? "Building your intro…" : "Get my intro kit  →"}
        </button>
      </form>

      {isPending && (
        <p className="text-center text-sm text-[var(--color-muted)]">
          Finding the right person and drafting your message. First run for a new company can
          take a moment.
        </p>
      )}

      {state &&
        !isPending &&
        (state.ok ? (
          <IntroResult kit={state} />
        ) : (
          <p className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            {state.error}
          </p>
        ))}
    </div>
  );
}
