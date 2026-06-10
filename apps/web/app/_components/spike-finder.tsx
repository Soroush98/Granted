"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { FindState, SpikeResult } from "@/lib/njf/find";
import { TurnstileWidget } from "@/app/_components/turnstile-widget";

const INITIAL: FindState = { status: "idle" };

export type SpikeFinderCopy = {
  placeholder: string;
  ctaIdle: string;
  ctaBusy: string;
  /** plural noun for what we searched, e.g. "Canadian companies" / "universities & labs" */
  searched: string;
  /** when set, show the grant holder on each card with this label (e.g. "Supervisor"). */
  holderLabel?: string;
};

const COUNTRY_OPTIONS = [
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["both", "Both"],
] as const;

// "Pike, Gilbert" -> "Gilbert Pike"
function displayName(name: string): string {
  const i = name.indexOf(",");
  return i === -1 ? name : `${name.slice(i + 1).trim()} ${name.slice(0, i).trim()}`.trim();
}

// The corpus has no country column, so infer it from the funder: ARC/NHMRC are
// Australian, everything else (NSERC/CIHR/FRQS/…) is Canadian.
const AU_FUNDERS = new Set(["ARC", "NHMRC"]);
function countryOf(source?: string | null): string {
  return source && AU_FUNDERS.has(source) ? "Australia" : "Canada";
}

export function SpikeFinder({
  action,
  copy,
  countrySelect = false,
}: {
  action: (prev: FindState, formData: FormData) => Promise<FindState>;
  copy: SpikeFinderCopy;
  /** Show a Canada / Australia / Both selector (submitted as the `country` field). */
  countrySelect?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [country, setCountry] = useState<(typeof COUNTRY_OPTIONS)[number][0]>("CA");

  return (
    <div className="grid gap-8">
      <form action={formAction} className="grid gap-3">
        <textarea
          name="bg"
          required
          minLength={10}
          maxLength={6000}
          rows={8}
          autoComplete="off"
          defaultValue={state.status === "ok" ? state.background : undefined}
          placeholder={copy.placeholder}
          className="w-full resize-y rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm outline-none focus:border-black/30"
        />
        {/* Bot defense. Auto-injects cf-turnstile-response into this form;
            renders nothing until a site key is configured. */}
        <TurnstileWidget />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {countrySelect && (
            <fieldset className="mr-auto flex items-center gap-1.5 text-sm">
              <span className="mr-1 text-[var(--color-muted)]">Where:</span>
              {COUNTRY_OPTIONS.map(([value, label]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-full border px-3 py-1 transition-colors ${
                    country === value
                      ? "border-black/30 bg-black/5 font-medium text-[var(--color-ink)]"
                      : "border-black/10 text-[var(--color-muted)] hover:bg-black/5"
                  }`}
                >
                  <input
                    type="radio"
                    name="country"
                    value={value}
                    checked={country === value}
                    onChange={() => setCountry(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="submit"
            disabled={pending}
            className="btn-primary focus-ring rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {pending ? copy.ctaBusy : copy.ctaIdle}
          </button>
        </div>
      </form>

      {state.status === "error" && !pending && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{state.message}</p>
      )}

      {pending && <ResultsSkeleton />}

      {state.status === "ok" && !pending && (
        <SpikeResults
          spikes={state.spikes}
          searched={copy.searched}
          holderLabel={copy.holderLabel}
          ctaIdle={copy.ctaIdle}
        />
      )}
    </div>
  );
}

function SpikeResults({
  spikes,
  searched,
  holderLabel,
  ctaIdle,
}: {
  spikes: SpikeResult[];
  searched: string;
  holderLabel?: string;
  ctaIdle: string;
}) {
  return (
    <div className="grid gap-10">
      <p className="text-sm text-[var(--color-muted)]">
        We split your background into{" "}
        <span className="font-semibold text-[var(--color-ink)]">{spikes.length}</span>{" "}
        distinctive {spikes.length === 1 ? "strength" : "strengths"} and searched {searched} funded to do
        that work. Each card shows the actual grant — your reason to reach out.
      </p>

      {spikes.map((s) => (
        <section key={s.label}>
          <h2 className="text-lg font-semibold tracking-tight">{s.label}</h2>
          <p className="mb-4 mt-1 text-xs text-[var(--color-muted)]">
            matched on <span className="font-mono">{s.query}</span>
          </p>

          {s.failed ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Search timed out for this strength. Hit{" "}
              <span className="font-medium">{ctaIdle}</span> again to retry — results are usually
              instant on the second pass.
            </p>
          ) : s.matches.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No funded work matched this strength.</p>
          ) : (
            <ul className="grid gap-3">
              {s.matches.map((m) => (
                <li key={m.company.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/companies/${m.company.id}`} className="font-semibold hover:underline">
                        {m.company.display_name}
                      </Link>
                      <p className="text-xs text-[var(--color-muted)]">
                        {[m.company.city, m.company.province].filter(Boolean).join(", ") || countryOf(m.holder?.source)}
                        {m.company.website && (
                          <>
                            {" · "}
                            <a
                              href={m.company.website}
                              target="_blank"
                              rel="noreferrer"
                              className="underline hover:text-[var(--color-ink)]"
                            >
                              website
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    {typeof m.rerank_score === "number" && (
                      <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-[var(--color-ink)]">
                        {Math.round(m.rerank_score * 100)}% fit
                      </span>
                    )}
                  </div>

                  {m.rationale && <p className="mt-2 text-sm text-[var(--color-ink)]">{m.rationale}</p>}

                  {holderLabel && m.holder && (
                    m.holder.isPI ? (
                      <p className="mt-2 text-sm">
                        <span className="font-semibold text-[var(--color-ink)]">{holderLabel}: {displayName(m.holder.name)}</span>
                        {m.holder.source && (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            {m.holder.source}-funded
                          </span>
                        )}
                        {m.holder.program && (
                          <span className="text-[var(--color-muted)]"> · {m.holder.program}</span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--color-muted)]">
                        Grant held by {displayName(m.holder.name)} ({m.holder.program}) — a trainee, not the
                        supervisor. Use it to spot the lab, then look up the PI.
                      </p>
                    )
                  )}

                  <p className="mt-2 rounded-xl bg-black/5 p-2 text-xs leading-relaxed text-[var(--color-ink)]">
                    “{m.best_chunk.slice(0, 240).replace(/\s+/g, " ").trim()}”
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid gap-6">
      {[0, 1].map((g) => (
        <div key={g} className="grid gap-3">
          <div className="h-5 w-48 animate-pulse rounded bg-black/5" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-black/5" />
          ))}
        </div>
      ))}
    </div>
  );
}
