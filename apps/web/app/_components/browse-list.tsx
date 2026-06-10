import Link from "next/link";
import { browseGrants } from "@/lib/rag/browse";
import { buildFilterParams, hasAnyFilter } from "@/lib/filters";
import type { BrowseSort, SearchFilters } from "@/lib/db/types";

// The browsable grant ledger — /search's no-query state (moved from the old
// /browse page). Filter/sort/page params ride the URL; pagination links point
// back at /search without a `q`, so browsing never touches the AI quota.
export async function BrowseList({
  filters,
  sort,
  page,
}: {
  filters: SearchFilters;
  sort: BrowseSort;
  page: number;
}) {
  const { rows, total, pageSize } = await browseGrants(filters, sort, page);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <>
      <p className="mb-4 font-[family-name:var(--font-mono)] text-[13px] text-[var(--color-muted)]">
        {total.toLocaleString()} grant{total === 1 ? "" : "s"}
        {hasAnyFilter(filters) ? " match your filters" : " in the index"}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No grants match those filters. Try widening the date range or removing a program.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((g) => (
            <li key={g.grant_id} className="paper p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/companies/${g.company_id}`}
                    className="block truncate font-bold hover:underline"
                  >
                    {g.company_name}
                  </Link>
                  <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
                    {[g.city, g.province].filter(Boolean).join(", ") || "Location unknown"}
                    {" · "}
                    <span className="font-medium">{g.program_code}</span>
                    {" · "}
                    {g.org_type.replace("_", " ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">{formatAmount(g.amount_cad)}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {g.start_date ?? g.fiscal_year ?? "—"}
                  </p>
                </div>
              </div>
              {g.title && (
                <p className="mt-2 line-clamp-2 text-[13px] text-[var(--color-ink)]">{g.title}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {total > pageSize && <Pager page={page} lastPage={lastPage} filters={filters} sort={sort} />}
    </>
  );
}

function Pager({
  page, lastPage, filters, sort,
}: { page: number; lastPage: number; filters: SearchFilters; sort: BrowseSort }) {
  const hrefFor = (p: number) =>
    `/search?${buildFilterParams(filters, { sort, page: String(p) }).toString()}`;

  return (
    <nav className="mt-6 flex items-center justify-between text-sm">
      <Link
        aria-disabled={page === 0}
        href={page === 0 ? "#" : hrefFor(page - 1)}
        className={`rounded-md border border-[var(--color-ink)]/20 px-3 py-1.5 ${page === 0 ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-highlight)]/40"}`}
      >
        ← Previous
      </Link>
      <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-muted)]">
        page {page + 1} / {lastPage + 1}
      </span>
      <Link
        aria-disabled={page >= lastPage}
        href={page >= lastPage ? "#" : hrefFor(page + 1)}
        className={`rounded-md border border-[var(--color-ink)]/20 px-3 py-1.5 ${page >= lastPage ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-highlight)]/40"}`}
      >
        Next →
      </Link>
    </nav>
  );
}

function formatAmount(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}
