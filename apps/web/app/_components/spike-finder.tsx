"use client";

import { useState } from "react";
import Link from "next/link";
import type { SpikeResult, WebResults } from "@/lib/njf/find";
import { TurnstileWidget } from "@/app/_components/turnstile-widget";

type Kind = "jobs" | "supervisors" | "research-pi";
type Phase = { key: string; label: string; detail?: string };
type OkState = { status: "ok"; background: string; spikes: SpikeResult[]; web?: WebResults };

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
  kind,
  copy,
  countrySelect = false,
  webSearchOption = false,
}: {
  /** Which streaming finder to drive (POSTs to /finders/search). */
  kind: Kind;
  copy: SpikeFinderCopy;
  /** Show a Canada / Australia / Both selector (submitted as the `country` field). */
  countrySelect?: boolean;
  /** Show an "also search the web" checkbox (submitted as the `web` field). */
  webSearchOption?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [phases, setPhases] = useState<Phase[]>([]);
  const [result, setResult] = useState<OkState | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [country, setCountry] = useState<(typeof COUNTRY_OPTIONS)[number][0]>("CA");
  const [webChecked, setWebChecked] = useState(false);
  // Turnstile tokens are single-use — bump after each submission to mint a fresh one.
  const [resetKey, setResetKey] = useState(0);

  const pending = status === "pending";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    setStatus("pending");
    setErrorMsg("");
    setResult(null);
    // Seed the first step locally so feedback is instant; server phases append.
    setPhases([{ key: "read", label: "Reading your background" }]);

    try {
      const res = await fetch("/finders/search", { method: "POST", body: fd });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let settled = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: {
            t: string;
            key?: string;
            label?: string;
            detail?: string;
            message?: string;
            state?: OkState;
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "phase" && ev.key && ev.label) {
            const key = ev.key;
            const label = ev.label;
            const detail = ev.detail;
            setPhases((p) => [...p, { key, label, detail }]);
          } else if (ev.t === "result" && ev.state) {
            setResult(ev.state);
            setStatus("ok");
            settled = true;
          } else if (ev.t === "error") {
            setErrorMsg(ev.message ?? "Something went wrong. Try again.");
            setStatus("error");
            settled = true;
          }
        }
      }
      if (!settled) {
        setErrorMsg("The search ended unexpectedly. Please try again.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setStatus("error");
    } finally {
      setResetKey((k) => k + 1);
    }
  }

  return (
    <div className="grid gap-8">
      <form onSubmit={onSubmit} className="grid gap-3">
        <textarea
          name="bg"
          required
          minLength={10}
          maxLength={6000}
          rows={8}
          autoComplete="off"
          defaultValue={result?.background}
          placeholder={copy.placeholder}
          className="w-full resize-y rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm outline-none focus:border-black/30"
        />
        {/* Bot defense. Auto-injects cf-turnstile-response into this form;
            renders nothing in dev / until a site key is configured. Reset after
            each submission so the next search gets a fresh single-use token. */}
        <TurnstileWidget resetKey={resetKey} />
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
          {webSearchOption && (
            <label
              className={`flex cursor-pointer items-center gap-2 text-sm text-[var(--color-muted)] ${countrySelect ? "" : "mr-auto"}`}
            >
              <input
                type="checkbox"
                name="web"
                value="1"
                checked={webChecked}
                onChange={(e) => setWebChecked(e.target.checked)}
                className="h-4 w-4 rounded border-black/20"
              />
              Also search the web
            </label>
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

      {status === "error" && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{errorMsg}</p>
      )}

      {pending && (
        <div className="grid gap-6">
          <StreamProgress phases={phases} />
          <ResultsSkeleton />
        </div>
      )}

      {status === "ok" && result && (
        <SpikeResults
          spikes={result.spikes}
          searched={copy.searched}
          holderLabel={copy.holderLabel}
          ctaIdle={copy.ctaIdle}
        />
      )}

      {status === "ok" && result?.web && <WebCompanies web={result.web} />}
    </div>
  );
}

// Real-time progress: each step is a phase event from the server, appended as
// the corresponding pipeline stage actually starts. The last step is "active"
// (spinner); earlier ones are done (✓). This is genuine streaming — not the
// scripted timer it replaced.
function StreamProgress({ phases }: { phases: Phase[] }) {
  return (
    <ul className="grid gap-2.5 rounded-2xl border border-black/10 bg-white p-4">
      {phases.map((p, idx) => {
        const active = idx === phases.length - 1;
        return (
          <li key={`${p.key}-${idx}`} className="text-sm">
            <div className="flex items-center gap-2.5">
              {active ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/15 border-t-[var(--color-ink)]" />
              ) : (
                <span className="text-emerald-600">✓</span>
              )}
              <span className={active ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}>
                {p.label}
                {active ? "…" : ""}
              </span>
            </div>
            {active && p.detail && (
              <p className="ml-6 mt-0.5 text-xs text-[var(--color-muted)]">{p.detail}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WebCompanies({ web }: { web: WebResults }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold tracking-tight">From around the web</h2>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
          live web search
        </span>
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Companies found via live web search, prioritizing a recent funding or traction signal in your
        niche — your reason to reach out. Broader reach than the grant database, but these signals
        aren&rsquo;t verified the way grants are; check the source before relying on them.
      </p>

      {web.note ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {web.note}
        </p>
      ) : web.companies.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No web matches found for this search.</p>
      ) : (
        <ul className="grid gap-3">
          {web.companies.map((c) => (
            <li key={c.name} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-[var(--color-ink)]">{c.name}</p>
                {c.location && (
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">{c.location}</span>
                )}
              </div>
              {c.whatTheyDo && <p className="mt-1 text-sm text-[var(--color-ink)]">{c.whatTheyDo}</p>}
              {c.signal ? (
                <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-900">
                  <span className="font-medium">Signal:</span> {c.signal}
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  No funding signal found — topic match only.
                </p>
              )}
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-sky-700 underline hover:text-sky-900"
              >
                {c.sourceTitle || "source"}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
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
