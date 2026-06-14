"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SpikeResult, WebResults } from "@/lib/njf/find";
import { TurnstileWidget } from "@/app/_components/turnstile-widget";
import { PaywallModal } from "@/app/_components/paywall-modal";

type Kind = "jobs" | "supervisors" | "research-pi";

/** sessionStorage key used to hand a background text to a finder across
 * navigation (cross-finder links, /notes re-runs). */
export const PREFILL_KEY = "granted:prefill";

// Cross-finder suggestions: from each finder, where else the same background
// is worth running.
const CROSS_FINDERS: Record<Kind, { href: string; label: string }[]> = {
  jobs: [
    { href: "/supervisors", label: "funded university labs" },
    { href: "/research-pi", label: "funded research PIs" },
  ],
  supervisors: [
    { href: "/jobs", label: "funded companies" },
    { href: "/research-pi", label: "funded research PIs" },
  ],
  "research-pi": [
    { href: "/supervisors", label: "funded university labs" },
    { href: "/jobs", label: "funded companies" },
  ],
};
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
  /** clickable example prompts shown under the textarea (fill it on click). */
  examples?: string[];
};

const COUNTRY_OPTIONS = [
  ["CA", "Canada"],
  ["US", "United States"],
  ["UK", "United Kingdom"],
  ["AU", "Australia"],
  ["all", "Anywhere"],
] as const;

// "Pike, Gilbert" -> "Gilbert Pike"
function displayName(name: string): string {
  const i = name.indexOf(",");
  return i === -1 ? name : `${name.slice(i + 1).trim()} ${name.slice(0, i).trim()}`.trim();
}

// The corpus has no country column, so infer it from the funder: each foreign
// funder maps to its country, everything else (NSERC/CIHR/FRQS/…) is Canadian.
const FUNDER_COUNTRY: Record<string, string> = {
  ARC: "Australia",
  NHMRC: "Australia",
  GRANTCONNECT: "Australia",
  NSF: "United States",
  NIH: "United States",
  UKRI: "United Kingdom",
};
function countryOf(source?: string | null): string {
  return (source && FUNDER_COUNTRY[source]) || "Canada";
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
  /** Show a country selector (CA/US/UK/AU/Anywhere, submitted as `country`). */
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
  const [paywall, setPaywall] = useState<{ code: string; message: string } | null>(null);
  // Controlled so the example chips can fill it.
  const [bgText, setBgText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Prefill handoff: "re-run" from /notes and the cross-finder links stash the
  // background in sessionStorage before navigating here.
  useEffect(() => {
    const t = sessionStorage.getItem(PREFILL_KEY);
    if (t) {
      setBgText(t);
      sessionStorage.removeItem(PREFILL_KEY);
    }
  }, []);

  // Fill the composer from a suggestion chip and bring it into view, ready to
  // submit. Deliberately NOT auto-submitting: the user confirms with the button
  // (and in production that also lets Turnstile mint a fresh token first).
  function fillAndFocus(text: string) {
    setBgText(text);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
            text?: string;
            message?: string;
            code?: string;
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
          } else if (ev.t === "detail" && ev.text) {
            // Live update the active step's detail (e.g. the current web query).
            const text = ev.text;
            setPhases((p) => {
              if (p.length === 0) return p;
              const next = p.slice();
              const last = next[next.length - 1]!;
              next[next.length - 1] = { ...last, detail: text };
              return next;
            });
          } else if (ev.t === "result" && ev.state) {
            setResult(ev.state);
            setStatus("ok");
            settled = true;
          } else if (ev.t === "error") {
            const msg = ev.message ?? "Something went wrong. Try again.";
            // Access-related blocks open the right modal (sign up / upgrade /
            // verify) instead of a dead-end red box.
            if (ev.code && ["signup", "upgrade", "pass_expired", "verify_email"].includes(ev.code)) {
              setPaywall({ code: ev.code, message: msg });
              setStatus("idle");
            } else {
              setErrorMsg(msg);
              setStatus("error");
            }
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
      <form ref={formRef} onSubmit={onSubmit} className="paper tape-card grid gap-3 p-5 sm:p-6">
        <textarea
          name="bg"
          required
          minLength={10}
          maxLength={6000}
          rows={6}
          autoComplete="off"
          value={bgText}
          onChange={(e) => setBgText(e.target.value)}
          placeholder={copy.placeholder}
          className="ruled focus-ring w-full resize-y rounded-md border border-[var(--color-ink)]/15 bg-white px-4 py-1 text-base outline-none transition-colors focus:border-[var(--color-accent)]/50"
        />
        {copy.examples && copy.examples.length > 0 && !bgText && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="hand text-xl text-[var(--color-muted)]">try one of these →</span>
            {copy.examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setBgText(ex)}
                className="rounded border border-dashed border-[var(--color-ink)]/30 bg-white px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/60 hover:text-[var(--color-ink)]"
              >
                {ex.length > 64 ? ex.slice(0, 61) + "…" : ex}
              </button>
            ))}
          </div>
        )}
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

      {status === "ok" && result?.web &&
        (result.web.kind === "labs" ? (
          <WebLabs web={result.web} />
        ) : (
          <WebCompanies web={result.web} />
        ))}

      {status === "ok" && result && (
        <DigDeeper
          spikes={result.spikes}
          kind={kind}
          background={result.background}
          onFill={fillAndFocus}
        />
      )}

      <PaywallModal
        open={!!paywall}
        code={paywall?.code ?? null}
        message={paywall?.message ?? ""}
        onClose={() => setPaywall(null)}
      />
    </div>
  );
}

// Real-time progress: each step is a phase event from the server, appended as
// the corresponding pipeline stage actually starts. The last step is "active"
// (spinner); earlier ones are done (✓). This is genuine streaming — not the
// scripted timer it replaced.
function StreamProgress({ phases }: { phases: Phase[] }) {
  return (
    <ul className="paper grid gap-2.5 p-4">
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
              <p className="hand ml-6 mt-0.5 text-lg leading-tight text-[var(--color-muted)]">{p.detail}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WebCompanies({ web }: { web: Extract<WebResults, { kind: "companies" }> }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline gap-2.5">
        <h2 className="text-lg font-bold tracking-tight">From around the web</h2>
        <span className="hand text-xl text-[var(--color-muted)]">← live web search</span>
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
            <li key={c.name} className="paper card-lift p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-[var(--color-ink)]">{c.name}</p>
                  {c.signal && <span className="stamp">signal</span>}
                </span>
                {c.location && (
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">{c.location}</span>
                )}
              </div>
              {c.whatTheyDo && <p className="mt-1 text-sm text-[var(--color-ink)]">{c.whatTheyDo}</p>}
              {c.signal ? (
                <p className="mt-2 text-sm">
                  <span className="highlight">{c.signal}</span>
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

// Research-lab / PI variant of the web panel (used by /research-pi). Same shape
// as WebCompanies but surfaces the institution and a recruiting/recency signal
// instead of a company traction signal.
function WebLabs({ web }: { web: Extract<WebResults, { kind: "labs" }> }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline gap-2.5">
        <h2 className="text-lg font-bold tracking-tight">From around the web</h2>
        <span className="hand text-xl text-[var(--color-muted)]">← live web search</span>
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Labs and principal investigators found via live web search, prioritizing ones that look like
        they&rsquo;re recruiting or were recently funded in your area — your reason to reach out.
        Broader reach than the grant database, but these signals aren&rsquo;t verified the way grants
        are; check the source before relying on them.
      </p>

      {web.note ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {web.note}
        </p>
      ) : web.labs.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No web matches found for this search.</p>
      ) : (
        <ul className="grid gap-3">
          {web.labs.map((l) => (
            <li key={l.name} className="paper card-lift p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-[var(--color-ink)]">{l.name}</p>
                  {l.signal && <span className="stamp">recruiting?</span>}
                </span>
                {l.institution && (
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">{l.institution}</span>
                )}
              </div>
              {l.focus && <p className="mt-1 text-sm text-[var(--color-ink)]">{l.focus}</p>}
              {l.signal ? (
                <p className="mt-2 text-sm">
                  <span className="highlight">{l.signal}</span>
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  No recruiting or funding signal found — topic match only.
                </p>
              )}
              <a
                href={l.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-sky-700 underline hover:text-sky-900"
              >
                {l.sourceTitle || "source"}
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

      {spikes.map((s, si) => (
        <section key={s.label}>
          <div className="flex items-baseline gap-2.5">
            <span className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.14em] text-[var(--color-muted)]">
              № {String(si + 1).padStart(2, "0")}
            </span>
            <h2 className="text-lg font-bold tracking-tight">
              <span className="highlight">{s.label}</span>
            </h2>
          </div>
          <p className="mb-4 mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--color-muted)]">
            matched on: {s.query}
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
            <ul className="grid gap-3.5">
              {s.matches.map((m) => (
                <li key={m.company.id} className="paper card-lift p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/companies/${m.company.id}`} className="font-bold hover:underline">
                          {m.company.display_name}
                        </Link>
                        <span className="stamp">funded</span>
                      </span>
                      <p className="text-xs text-[var(--color-muted)]">
                        {[m.company.city, m.company.province].filter(Boolean).join(", ") || countryOf(m.funder ?? m.holder?.source)}
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
                      <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs text-[var(--color-muted)]">
                        fit {Math.round(m.rerank_score * 100)}%
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

                  <p className="mt-2.5 border-l-2 border-[var(--color-accent)]/40 pl-3 text-xs leading-relaxed text-[var(--color-muted)]">
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

// Post-results nudges: one search should naturally become three or four.
//  - per-spike "dig into" chips re-search a single strength, narrow and sharp;
//  - zero-match spikes get a "broaden" rescue (the label is wider than the query);
//  - cross-finder links run the same background through the other products.
function DigDeeper({
  spikes,
  kind,
  background,
  onFill,
}: {
  spikes: SpikeResult[];
  kind: Kind;
  background: string;
  onFill: (text: string) => void;
}) {
  const hits = spikes.filter((s) => !s.failed && s.matches.length > 0);
  const misses = spikes.filter((s) => !s.failed && s.matches.length === 0);

  return (
    <aside className="paper tape-card tape-left p-5">
      <p className="hand text-2xl leading-none text-[var(--color-ink)]">
        keep digging — one search is never the whole picture
      </p>

      {hits.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="kicker">narrow in on one strength</span>
          {hits.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onFill(s.query)}
              className="rounded border border-dashed border-[var(--color-ink)]/30 bg-white px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/60 hover:text-[var(--color-ink)]"
            >
              dig into: {s.label}
            </button>
          ))}
        </div>
      )}

      {misses.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="kicker">no matches? go broader</span>
          {misses.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onFill(s.label)}
              className="rounded border border-dashed border-[var(--color-accent)]/40 bg-white px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
            >
              broaden: {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="kicker">same background, different doors</span>
        {CROSS_FINDERS[kind].map((cf) => (
          <Link
            key={cf.href}
            href={cf.href}
            onClick={() => sessionStorage.setItem(PREFILL_KEY, background)}
            className="rounded border border-dashed border-[var(--color-ink)]/30 bg-white px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/60 hover:text-[var(--color-ink)]"
          >
            try it on {cf.label} →
          </Link>
        ))}
      </div>
    </aside>
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
