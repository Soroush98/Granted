import { Suspense } from "react";
import {
  statsByProgram,
  statsByProvince,
  statsByYear,
} from "@/lib/rag/browse";
import type { Params } from "@/lib/filters";

type Props = { searchParams: Promise<Params> };

export default function StatsPage({ searchParams }: Props) {
  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Totals across the indexed funding sources. Defaults to the full 2-year window;
          override with <code>?min_date=YYYY-MM-DD&amp;max_date=YYYY-MM-DD</code> in the URL.
        </p>
      </header>

      <Suspense fallback={<Skeleton />}>
        <StatsContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function StatsContent({ searchParams }: Props) {
  const params = await searchParams;
  const minDate = typeof params.min_date === "string" ? params.min_date : null;
  const maxDate = typeof params.max_date === "string" ? params.max_date : null;

  const [byProgram, byProvince, byYear] = await Promise.all([
    statsByProgram(minDate, maxDate),
    statsByProvince(minDate, maxDate),
    statsByYear(minDate, maxDate),
  ]);

  const totalGrants = byProgram.reduce((s, r) => s + Number(r.n_grants), 0);
  const totalCad   = byProgram.reduce((s, r) => s + Number(r.total_cad ?? 0), 0);

  return (
    <div className="grid gap-8">
      <header className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Grants in window" value={totalGrants.toLocaleString()} />
        <Stat label="Total $" value={formatCad(totalCad)} />
        <Stat label="Programs" value={byProgram.filter((p) => Number(p.n_grants) > 0).length.toLocaleString()} />
      </header>

      <Card title="Top funding programs by total $">
        <BarChart
          rows={byProgram.slice(0, 12).map((r) => ({
            label: r.program_code,
            value: Number(r.total_cad ?? 0),
            sublabel: `${Number(r.n_grants).toLocaleString()} grants`,
          }))}
          valueFormatter={formatCad}
        />
      </Card>

      <Card title="Top 12 provinces by grant count">
        <BarChart
          rows={byProvince.slice(0, 12).map((r) => ({
            label: r.province,
            value: Number(r.n_grants),
            sublabel: formatCad(Number(r.total_cad ?? 0)),
          }))}
          valueFormatter={(n) => n.toLocaleString()}
        />
      </Card>

      <Card title="Grants per year">
        <BarChart
          rows={byYear.map((r) => ({
            label: String(r.bucket_year),
            value: Number(r.n_grants),
            sublabel: formatCad(Number(r.total_cad ?? 0)),
          }))}
          valueFormatter={(n) => n.toLocaleString()}
        />
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

// Pure-server SVG bar chart. Horizontal bars with label + numeric value.
// No client JS, no chart lib — keeps the bundle tiny.
type BarRow = { label: string; value: number; sublabel?: string };
function BarChart({
  rows, valueFormatter,
}: { rows: BarRow[]; valueFormatter: (n: number) => string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-muted)]">No data in this window.</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="grid gap-2">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <li key={r.label} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate font-medium" title={r.label}>{r.label}</span>
            <div className="relative h-5 w-full overflow-hidden rounded-full bg-black/5">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-ink)]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-right font-mono text-xs tabular-nums">
              <span className="block">{valueFormatter(r.value)}</span>
              {r.sublabel && (
                <span className="block text-[10px] text-[var(--color-muted)]">{r.sublabel}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function formatCad(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function Skeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-black/5" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-2xl bg-black/5" />
      ))}
    </div>
  );
}
