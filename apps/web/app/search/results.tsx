import Link from "next/link";
import { after } from "next/server";
import { searchCompanies } from "@/lib/rag/search";
import { supabaseAnon, supabaseService } from "@/lib/db/supabase-server";
import type { SearchFilters } from "@/lib/db/types";
import {
  getClientIp,
  RATE_LIMIT_MAX_SEARCHES,
  UNKNOWN_IP,
} from "@/lib/ip";

type Props = { query: string; filters: SearchFilters };

export async function Results({ query, filters }: Props) {
  // Resolve the client IP up front. Falls back to a shared "unknown" bucket
  // when no forwarding header is present (local dev, direct connections).
  const ip = (await getClientIp()) ?? UNKNOWN_IP;

  // Rate-limit gate: count this IP's lifetime searches (no window — the
  // RPC's window_hours default is NULL, meaning "everything ever logged").
  // Refuse before doing any of the expensive work (Voyage embed + RPC +
  // Claude rerank) if they're already at the cap.
  const supabaseRead = supabaseAnon();
  const { data: usedRaw } = await supabaseRead.rpc("recent_search_count", {
    ip_in: ip,
  });
  const used = typeof usedRaw === "number" ? usedRaw : Number(usedRaw ?? 0);

  if (used >= RATE_LIMIT_MAX_SEARCHES) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">
          Search limit reached ({RATE_LIMIT_MAX_SEARCHES} searches per IP, total).
        </p>
        <p className="mt-2 text-amber-800">
          You&rsquo;ve used all {used} of your searches from this IP. The limit is
          per-lifetime, not per day &mdash; further searches from this address are blocked.
        </p>
        <p className="mt-3 text-amber-800">
          You can still <Link href="/browse" className="underline">browse grants</Link> and{" "}
          <Link href="/stats" className="underline">view stats</Link> without a search.
        </p>
      </div>
    );
  }

  const matches = await searchCompanies(query, { ...filters, topK: 5 });

  // Fire-and-forget search logging. `after()` runs post-response so it doesn't
  // block streaming. We persist the IP here so the next request's count
  // reflects this one.
  after(async () => {
    try {
      const supabase = supabaseService();
      await supabase.from("search_log").insert({
        query,
        org_filter: filters.orgFilter ?? null,
        result_count: matches.length,
        ip,
      });
    } catch {
      // logging is best-effort
    }
  });

  if (matches.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 bg-white p-6 text-sm text-[var(--color-muted)]">
        No matches yet. The ingestion pipeline may still be populating data, or try broadening
        your description.
      </p>
    );
  }

  // Surface remaining quota inline so users learn the limit exists before
  // they hit it. Hidden when there's plenty of headroom.
  const remaining = RATE_LIMIT_MAX_SEARCHES - used - 1;
  const showQuotaHint = remaining <= 3;

  return (
    <>
      {showQuotaHint && (
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {remaining === 0
            ? `This was your last search from this IP — further searches will be blocked.`
            : `${remaining} search${remaining === 1 ? "" : "es"} left from this IP (lifetime limit).`}
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
    </>
  );
}
