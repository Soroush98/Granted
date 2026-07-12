import Link from "next/link";
import { searchCompanies } from "@/lib/rag/search";
import type { SearchFilters } from "@/lib/db/types";
import { logSearch } from "@/lib/njf/usage";
import { gateSearch } from "@/lib/njf/access";
import { looksLikePromoSpam } from "@/lib/rag/spam";

type Props = { query: string; filters: SearchFilters };

export async function Results({ query, filters }: Props) {
  // Bots paste cold-outreach pitches into the search box (no Turnstile on this
  // GET form). Bounce them before the quota gate and the embed/rerank spend —
  // and skip the analytics log so they don't pollute search_log either.
  if (looksLikePromoSpam(query)) {
    return (
      <p className="rounded-xl border border-black/10 bg-white p-6 text-sm text-[var(--color-muted)]">
        That looks like a promotional message rather than a search. Describe a
        research topic, technology, or role instead — e.g.{" "}
        <Link href="/search?q=computer%20vision%20for%20industrial%20inspection" className="underline">
          computer vision for industrial inspection
        </Link>
        . Or <Link href="/search" className="underline">browse grants</Link>.
      </p>
    );
  }

  // Per-identity gate (anon taste → free account → pass), consumed before any
  // expensive work. /search never uses web, so wantWeb is false. No Turnstile
  // here — /search is a GET form producing shareable URLs.
  const gate = await gateSearch({ wantWeb: false });
  if (!gate.ok) {
    // The CTA depends on WHY they were blocked.
    const cta =
      gate.code === "signup"
        ? { href: "/signup", label: "Sign up free" }
        : gate.code === "upgrade" || gate.code === "pass_expired"
          ? { href: "/pass", label: "Get the Job Hunt Pass" }
          : gate.code === "verify_email"
            ? { href: "/login", label: "Log in" }
            : null;
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">Search limit reached.</p>
        <p className="mt-2 text-amber-800">{gate.message}</p>
        <p className="mt-3 text-amber-800">
          {cta && (
            <>
              <Link href={cta.href} className="font-semibold underline">{cta.label}</Link>
              {" · "}
            </>
          )}
          or <Link href="/search" className="underline">browse grants</Link> and{" "}
          <Link href="/stats" className="underline">view stats</Link> for free.
        </p>
      </div>
    );
  }
  const ip = gate.identity.ip;
  const userId = gate.identity.userId;

  const outcome = await searchCompanies(query, { ...filters, topK: 5 });

  if (!outcome.ok) {
    // Search backend failed (RPC, embed, or DB). Render a friendly message
    // instead of throwing so the Server Component doesn't bubble an error
    // boundary into the edge cache. The real error is logged server-side.
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        Search is temporarily unavailable. Try again in a moment, or{" "}
        <Link href="/search" className="underline">browse grants</Link> instead.
      </p>
    );
  }

  const matches = outcome.matches;
  const more = outcome.more;

  // Fire-and-forget analytics log (post-response).
  logSearch({
    query,
    orgFilter: filters.orgFilter ?? null,
    resultCount: matches.length,
    ip,
    userId,
  });

  if (matches.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 bg-white p-6 text-sm text-[var(--color-muted)]">
        No matches yet. The ingestion pipeline may still be populating data, or try broadening
        your description.
      </p>
    );
  }

  // Pass holders see their remaining credits; free/anon get no per-search hint
  // here (their allowance + paywall live in the header / on the wall).
  const credits = gate.identity.tier === "pass" ? gate.creditsRemaining : null;

  return (
    <>
      {credits !== null && credits <= 20 && (
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {credits} pass credit{credits === 1 ? "" : "s"} left.
        </p>
      )}
      <ol className="grid gap-4">
        {matches.map((m, i) => {
          const c = m.company;
          const location = [c.city, c.province].filter(Boolean).join(", ");
          return (
            <li key={c.id} className="card-lift relative overflow-hidden rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
              {/* Subtle accent stripe on the left edge — anchors the rank visually. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[var(--color-ink)] to-[var(--color-accent)] opacity-90"
              />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-gradient-to-br from-[var(--color-ink)] to-[#2a2d33] px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
                      #{i + 1}
                    </span>
                    <h2 className="text-lg font-semibold">
                      <Link href={`/companies/${c.id}`} className="hover:underline">
                        {c.display_name}
                      </Link>
                    </h2>
                    {c.org_type !== "company" && (
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">
                        {c.org_type.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  {location && (
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{location}</p>
                  )}
                </div>
                {typeof m.rerank_score === "number" && (
                  <div className="text-right text-xs text-[var(--color-muted)]">
                    fit&nbsp;{Math.round(m.rerank_score * 100)}%
                  </div>
                )}
              </div>

              {m.rationale && (
                <p className="mt-3 text-sm">
                  <span className="font-medium">Why this match:</span> {m.rationale}
                </p>
              )}

              {c.sectors.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {c.sectors.slice(0, 6).map((s) => (
                    <li key={s} className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{s}</li>
                  ))}
                </ul>
              )}

              <blockquote className="mt-4 border-l-2 border-black/10 pl-3 text-sm text-[var(--color-muted)]">
                &ldquo;{m.best_chunk.slice(0, 320)}{m.best_chunk.length > 320 ? "…" : ""}&rdquo;
              </blockquote>
            </li>
          );
        })}
      </ol>

      {more.length > 0 && (
        <section className="mt-10">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            More potentially relevant ({more.length})
          </h3>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Ranked by hybrid score, without per-match rationale. Useful for casting a wider net.
          </p>
          <ol className="mt-4 grid gap-2" start={matches.length + 1}>
            {more.map((m, i) => {
              const c = m.company;
              const location = [c.city, c.province].filter(Boolean).join(", ");
              return (
                <li
                  key={c.id}
                  className="card-lift flex items-start gap-3 rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-sm"
                >
                  <span className="mt-0.5 w-6 shrink-0 text-right text-xs text-[var(--color-muted)]">
                    #{matches.length + i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                        {c.display_name}
                      </Link>
                      {c.org_type !== "company" && (
                        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px]">
                          {c.org_type.replace("_", " ")}
                        </span>
                      )}
                      {location && (
                        <span className="text-xs text-[var(--color-muted)]">{location}</span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--color-muted)]">
                      {m.best_chunk.slice(0, 200)}
                      {m.best_chunk.length > 200 ? "…" : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}
