import Link from "next/link";
import type { CompanyNameHit } from "@/lib/db/types";

type Props = {
  matches: CompanyNameHit[];
  interpretedAs: string;
};

/**
 * Renders above semantic results when the user's query looks like an org
 * name. Each card links to the company detail page where the full grant
 * history lives — short-circuiting the rerank pipeline for "show me X"
 * style queries.
 */
export function CompanyMatches({ matches, interpretedAs }: Props) {
  return (
    <section className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <header className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-900">
          Looking for a specific organization?
        </h2>
        <p className="mt-0.5 text-xs text-emerald-800">
          Closest name match to <span className="font-medium">&ldquo;{interpretedAs}&rdquo;</span>
          {matches.length === 1 ? "" : ` (${matches.length} candidates)`}
        </p>
      </header>
      <ul className="grid gap-2">
        {matches.map((m) => (
          <li
            key={m.company_id}
            className="rounded-xl border border-emerald-200 bg-white p-3 text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/companies/${m.company_id}`}
                  className="block truncate font-semibold hover:underline"
                >
                  {m.display_name}
                </Link>
                <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                  {[m.city, m.province].filter(Boolean).join(", ") || "Location unknown"}
                  {" · "}
                  {m.org_type.replace("_", " ")}
                  {" · "}
                  match&nbsp;{Math.round(m.similarity * 100)}%
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm">{formatAmount(m.total_cad)}</p>
                <p className="text-[11px] text-[var(--color-muted)]">
                  {m.grant_count} grant{m.grant_count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}
