"use client";

import { useActionState, useEffect, useRef } from "react";
import { loadEngineers, type EngineersState } from "../actions";
import { EngineersResults } from "./engineers-results";

export function EngineersForm({ initialCompany }: { initialCompany: string }) {
  const [state, formAction, isPending] = useActionState<EngineersState, FormData>(
    loadEngineers,
    null,
  );

  // Auto-run once when we arrive with a company in the URL (e.g. a hand-off
  // from a company page), so the lookup lands straight on results.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    if (initialCompany) {
      autoRan.current = true;
      const fd = new FormData();
      fd.set("company", initialCompany);
      formAction(fd);
    }
  }, [initialCompany, formAction]);

  return (
    <div className="grid gap-8">
      <form
        action={formAction}
        className="mx-auto grid w-full max-w-2xl gap-4 rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_8px_32px_-12px_rgba(11,13,16,0.12)] backdrop-blur sm:p-6"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
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
              placeholder="e.g. Shopify"
              className="focus-ring w-full rounded-2xl border border-black/10 bg-white p-3 text-base shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary focus-ring h-12 rounded-full px-6 text-sm font-semibold disabled:opacity-60"
          >
            {isPending ? "Finding…" : "Find engineers  →"}
          </button>
        </div>
      </form>

      {isPending && (
        <p className="text-center text-sm text-[var(--color-muted)]">
          Pulling engineers from GitHub. This can take a moment on the first run
          for a new company.
        </p>
      )}

      {state &&
        !isPending &&
        (state.ok ? (
          <EngineersResults data={state} />
        ) : (
          <p className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            {state.error}
          </p>
        ))}
    </div>
  );
}
