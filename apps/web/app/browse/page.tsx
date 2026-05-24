import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { browseGrants, listFacets } from "@/lib/rag/browse";
import { AdvancedFilters } from "@/app/_components/advanced-filters";
import {
  buildFilterParams,
  hasAnyFilter,
  readFilters,
  readPage,
  readSort,
  type Params,
} from "@/lib/filters";
import type { BrowseSort, SearchFilters } from "@/lib/db/types";

type Props = {
  searchParams: Promise<Params>;
};

export default function BrowsePage({ searchParams }: Props) {
  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Browse grants</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          List view of every funded grant in the index. Filter and sort — no query needed.
        </p>
      </header>

      <Suspense fallback={<Skeleton />}>
        <BrowseContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function BrowseContent({ searchParams }: Props) {
  const params = await searchParams;
  const filters = readFilters(params);
  const sort = readSort(params);
  const page = readPage(params);

  // Facets and the actual page of results in parallel — both cached.
  const [facets, { rows, total, pageSize }] = await Promise.all([
    listFacets(),
    browseGrants(filters, sort, page),
  ]);

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <>
      <Form action="/browse" className="mb-8 grid gap-3">
        <AdvancedFilters
          facets={facets}
          current={filters}
          defaultOpen={hasAnyFilter(filters)}
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Sort
            </span>
            <select
              name="sort"
              defaultValue={sort}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            >
              <option value="recent">Most recent</option>
              <option value="amount_desc">Largest amount</option>
              <option value="amount">Smallest amount</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </Form>

      <p className="mb-4 text-sm text-[var(--color-muted)]">
        {total.toLocaleString()} grant{total === 1 ? "" : "s"}
        {hasAnyFilter(filters) ? " match your filters" : " in the index"}.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No grants match those filters. Try widening the date range or removing a program.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((g) => (
            <li
              key={g.grant_id}
              className="rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/companies/${g.company_id}`}
                    className="block truncate font-semibold hover:underline"
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

      {total > pageSize && (
        <Pager page={page} lastPage={lastPage} filters={filters} sort={sort} />
      )}
    </>
  );
}

function Pager({
  page, lastPage, filters, sort,
}: { page: number; lastPage: number; filters: SearchFilters; sort: BrowseSort }) {
  const hrefFor = (p: number) =>
    `/browse?${buildFilterParams(filters, { sort, page: String(p) }).toString()}`;

  return (
    <nav className="mt-6 flex items-center justify-between text-sm">
      <Link
        aria-disabled={page === 0}
        href={page === 0 ? "#" : hrefFor(page - 1)}
        className={`rounded-full border border-black/10 px-3 py-1.5 ${page === 0 ? "pointer-events-none opacity-40" : "hover:bg-black/5"}`}
      >
        ← Previous
      </Link>
      <span className="text-[var(--color-muted)]">
        Page {page + 1} of {lastPage + 1}
      </span>
      <Link
        aria-disabled={page >= lastPage}
        href={page >= lastPage ? "#" : hrefFor(page + 1)}
        className={`rounded-full border border-black/10 px-3 py-1.5 ${page >= lastPage ? "pointer-events-none opacity-40" : "hover:bg-black/5"}`}
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

function Skeleton() {
  return (
    <div className="grid gap-4">
      <div className="h-40 animate-pulse rounded-2xl bg-black/5" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-black/5" />
      ))}
    </div>
  );
}
