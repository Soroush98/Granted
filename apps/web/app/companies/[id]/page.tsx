import { notFound } from "next/navigation";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { supabaseAnon } from "@/lib/db/supabase-server";
import type { Company, CompanyTotals, FundingProgram, Grant } from "@/lib/db/types";

type SortKey = "recent" | "amount_desc" | "amount";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; sort?: string; q?: string }>;
};

const PAGE_SIZE = 25;

// Escape PostgREST .or() value: comma + parens are reserved (build the
// filter chain), and `%` is the ilike wildcard. We collapse runs of % so a
// query like "ab%cd" doesn't degenerate into a substring of any string.
function buildIlikePattern(q: string): string {
  const cleaned = q.trim().replace(/%/g, "");
  return `%${cleaned}%`;
}

// Cached per-company. Ingestion invalidates `company:<id>` after refresh.
async function getCompanyHead(id: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(`company:${id}`);

  const supabase = supabaseAnon();
  const [{ data: company }, { data: totals }, { data: programs }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("company_totals", { company_id_in: id }),
    supabase.from("funding_programs").select("*"),
  ]);

  return {
    company: company as Company | null,
    totals: ((totals ?? [])[0] as CompanyTotals | undefined) ?? null,
    programs: (programs ?? []) as FundingProgram[],
  };
}

// Grants page is cached separately so the head (totals, program list) stays
// hot even as the user paginates or refines the search. The cache key
// implicitly includes (id, sort, page, search) via the function args.
async function getCompanyGrantsPage(id: string, sort: SortKey, page: number, search: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(`company:${id}`);

  const supabase = supabaseAnon();
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from("grants")
    .select("*", { count: "exact" })
    .eq("recipient_id", id)
    .range(from, to);

  if (search) {
    const pat = buildIlikePattern(search);
    // PostgREST OR syntax: .or("col.op.value,col.op.value"). Commas inside
    // values would break the parser, but ilike patterns can't contain commas
    // here (we trim and wrap with %).
    q = q.or(`title.ilike.${pat},description.ilike.${pat}`);
  }

  switch (sort) {
    case "amount_desc":
      q = q.order("amount_cad", { ascending: false, nullsFirst: false });
      break;
    case "amount":
      q = q.order("amount_cad", { ascending: true, nullsFirst: false });
      break;
    case "recent":
    default:
      q = q.order("start_date", { ascending: false, nullsFirst: false });
      break;
  }

  const { data, count } = await q;
  return {
    grants: (data ?? []) as Grant[],
    total: count ?? 0,
  };
}

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function parseSort(raw: string | undefined): SortKey {
  if (raw === "amount_desc" || raw === "amount") return raw;
  return "recent";
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export default async function CompanyPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const page = parsePage(sp.page);
  const search = (sp.q ?? "").trim();

  // Head and grants page in parallel — independent queries.
  const [head, page1] = await Promise.all([
    getCompanyHead(id),
    getCompanyGrantsPage(id, sort, page, search),
  ]);
  const { company, totals, programs } = head;
  if (!company) notFound();

  const { grants, total } = page1;
  const programById = new Map(programs.map((p) => [p.id, p]));
  const location = [company.city, company.province].filter(Boolean).join(", ");
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (sort !== "recent") sp.set("sort", sort);
    if (search) sp.set("q", search);
    if (p > 0) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/companies/${id}?${qs}` : `/companies/${id}`;
  };

  return (
    <article className="grid gap-8">
      <header>
        <Link href="/search" className="text-sm text-[var(--color-muted)] hover:underline">
          ← back to results
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{company.display_name}</h1>
          {company.org_type !== "company" && (
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">
              {company.org_type.replace("_", " ")}
            </span>
          )}
        </div>
        {location && <p className="mt-1 text-[var(--color-muted)]">{location}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {company.website && (
            <a
              className="rounded-full border border-black/10 px-3 py-1 hover:bg-black/5"
              href={company.website}
              target="_blank"
              rel="noreferrer"
            >
              Website ↗
            </a>
          )}
        </div>
      </header>

      {totals && totals.grant_count > 0 && (
        <section className="grid grid-cols-2 gap-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:grid-cols-4">
          <Stat label="Total disclosed" value={CAD.format(Number(totals.total_cad ?? 0))} />
          <Stat label="Award count" value={String(totals.grant_count)} />
          <Stat label="Distinct programs" value={String(totals.program_count)} />
          <Stat
            label="First → last award"
            value={`${totals.first_award?.slice(0, 4) ?? "—"} → ${totals.last_award?.slice(0, 4) ?? "—"}`}
          />
        </section>
      )}

      {company.description && (
        <section>
          <h2 className="text-lg font-semibold">About</h2>
          <p className="mt-2 text-sm leading-relaxed">{company.description}</p>
          {company.sectors.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {company.sectors.map((s) => (
                <li key={s} className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{s}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(totals?.grant_count ?? 0) > 0 && (
        <section>
          <div className="mb-4 grid gap-3">
            <h2 className="text-lg font-semibold">Disclosed awards</h2>
            {/* Submit-on-change is intentional: the sort dropdown reposts the
                form, and the search input commits on Enter / Apply. Form GETs
                so all state lands in the URL (back-button friendly). */}
            <form
              className="flex flex-wrap items-end gap-2 text-sm"
              action={`/companies/${id}`}
            >
              <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Search this organization&rsquo;s grants
                </span>
                <input
                  type="search"
                  name="q"
                  defaultValue={search}
                  placeholder={`e.g. quantum, machine learning, ${company.org_type === "university" ? "graduate training" : "AI platform"}`}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Sort
                </span>
                <select
                  name="sort"
                  defaultValue={sort}
                  className="rounded-xl border border-black/10 bg-white px-3 py-2"
                >
                  <option value="recent">Most recent</option>
                  <option value="amount_desc">Largest amount</option>
                  <option value="amount">Smallest amount</option>
                </select>
              </label>
              <button
                type="submit"
                className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Apply
              </button>
              {(search || sort !== "recent") && (
                <Link
                  href={`/companies/${id}`}
                  className="self-center text-xs text-[var(--color-muted)] hover:underline"
                >
                  Clear
                </Link>
              )}
            </form>

            <p className="text-xs text-[var(--color-muted)]">
              {total === 0 ? (
                <>
                  No awards match <span className="font-medium">&ldquo;{search}&rdquo;</span>.
                  {" "}<Link href={`/companies/${id}`} className="underline">Clear search</Link> to see all{" "}
                  {totals?.grant_count.toLocaleString()} disclosed awards.
                </>
              ) : (
                <>
                  Showing <span className="font-medium">{rangeStart.toLocaleString()}&ndash;{rangeEnd.toLocaleString()}</span>
                  {" "}of <span className="font-medium">{total.toLocaleString()}</span>
                  {search
                    ? <> matching <span className="font-medium">&ldquo;{search}&rdquo;</span> (of {totals?.grant_count.toLocaleString()} total).</>
                    : <>. Public data only &mdash; SR&amp;ED tax credits are confidential and not shown.</>}
                </>
              )}
            </p>
          </div>

          {total > 0 && (
            <ul className="grid gap-3">
              {grants.map((g) => {
                const program = programById.get(g.program_id);
                return (
                  <li key={g.id} className="rounded-xl border border-black/10 bg-white p-4 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <a
                        className="font-medium hover:underline"
                        href={g.source_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {g.title ?? "(untitled award)"}
                      </a>
                      {typeof g.amount_cad === "number" && (
                        <span className="whitespace-nowrap text-xs text-[var(--color-muted)]">
                          {CAD.format(Number(g.amount_cad))}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-muted)]">
                      {program?.name ?? "Unknown program"}
                      {g.fiscal_year ? ` · FY ${g.fiscal_year}` : ""}
                      {g.start_date ? ` · ${g.start_date.slice(0, 7)}` : ""}
                    </p>
                    {g.description && (
                      <p className="mt-2 line-clamp-3 text-[var(--color-muted)]">{g.description}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {total > PAGE_SIZE && (
            <nav className="mt-6 flex items-center justify-between text-sm">
              <Link
                aria-disabled={page === 0}
                href={page === 0 ? "#" : pageHref(page - 1)}
                className={`rounded-full border border-black/10 px-3 py-1.5 ${page === 0 ? "pointer-events-none opacity-40" : "hover:bg-black/5"}`}
              >
                ← Previous
              </Link>
              <span className="text-[var(--color-muted)]">
                Page {page + 1} of {lastPage + 1}
              </span>
              <Link
                aria-disabled={page >= lastPage}
                href={page >= lastPage ? "#" : pageHref(page + 1)}
                className={`rounded-full border border-black/10 px-3 py-1.5 ${page >= lastPage ? "pointer-events-none opacity-40" : "hover:bg-black/5"}`}
              >
                Next →
              </Link>
            </nav>
          )}
        </section>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
