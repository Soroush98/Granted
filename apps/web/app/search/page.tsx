import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { Results } from "./results";
import { CompanyMatches } from "./company-matches";
import { PdfPreview } from "./_components/pdf-preview";
import { AdvancedFilters } from "@/app/_components/advanced-filters";
import { BrowseList } from "@/app/_components/browse-list";
import { corpusTotals, extractNameQuery, listFacets, lookupCompaniesByName } from "@/lib/rag/browse";
import { hasAnyFilter, readFilters, readPage, readSort, type Params } from "@/lib/filters";
import { countryToProgramCodes } from "@/lib/countries";
import { detectLocationFilter, detectOrgTypeFilter } from "@/lib/locations";
import { splitQueryParts } from "@/lib/resume";

// Next.js 16: searchParams is async — must be awaited.
type SearchPageProps = {
  searchParams: Promise<Params>;
};

const ERROR_MESSAGES: Record<string, string> = {
  resume_too_large: "That PDF is over 20 MB — try a smaller file.",
  resume_not_pdf: "Upload must be a PDF.",
  resume_parse_failed: "We couldn't read text from that PDF. Is it scanned/image-only?",
  query_too_short: "Tell us a bit more about what you're looking for (at least 20 characters).",
};

export default function SearchPage({ searchParams }: SearchPageProps) {
  return (
    <section>
      <Suspense fallback={<PageSkeleton />}>
        <SearchPageContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

// Hard ceiling on the full query (goal + optional BACKGROUND from a paper).
// Goal alone is capped at 2,000 chars in actions.ts; resume/paper text is
// trimmed to 4,000 in normalizeDocumentText. Total ≈ 6,100 in the worst
// case (GOAL + BACKGROUND separators + label). Anything above that is
// either a paste-bomb or an attempt to abuse Anthropic credits — truncate.
const MAX_QUERY_CHARS = 8000;

async function SearchPageContent({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  let query = (typeof params.q === "string" ? params.q : "").trim();
  if (query.length > MAX_QUERY_CHARS) query = query.slice(0, MAX_QUERY_CHARS);
  const errorParam = typeof params.error === "string" ? params.error : undefined;
  const errorMsg = errorParam ? ERROR_MESSAGES[errorParam] : null;
  const { goal, background } = splitQueryParts(query);
  const totals = await corpusTotals();

  const filters = readFilters(params);
  const sort = readSort(params);
  const page = readPage(params);

  // Auto-apply structured filters when the user's GOAL (not the whole query)
  // mentions a Canadian province or an org-type word. Scanning the full query
  // would false-positive on document content — e.g. a research paper's
  // "University of Calgary, Calgary, Canada" affiliation would force an AB
  // filter the user never asked for. The user can still override via the
  // Advanced Filters panel.
  const { goal: goalText } = splitQueryParts(query);
  let autoLocationHint: ReturnType<typeof detectLocationFilter> = null;
  let autoOrgHint: ReturnType<typeof detectOrgTypeFilter> = null;
  if (!filters.province) {
    autoLocationHint = detectLocationFilter(goalText);
    if (autoLocationHint) filters.province = autoLocationHint.province;
  }
  if (!filters.orgFilter) {
    autoOrgHint = detectOrgTypeFilter(goalText);
    if (autoOrgHint) filters.orgFilter = autoOrgHint.org;
  }

  // Load facets in parallel with the page render; cached for hours.
  const facetsPromise = listFacets();

  // `filters` drives the filter panel UI (shows the chosen country as a country,
  // not as 50 checked programs). `effectiveFilters` is what actually hits the
  // RPCs: a country selection is resolved to its program codes here (Canada =
  // all program codes minus the foreign ones, from the live facet list), unless
  // the user checked specific programs, which take precedence.
  let effectiveFilters = filters;
  if (filters.country && !(filters.programCodes && filters.programCodes.length > 0)) {
    const facets = await facetsPromise;
    effectiveFilters = {
      ...filters,
      programCodes: countryToProgramCodes(filters.country, facets.programs.map((p) => p.value)),
    };
  }

  return (
    <div className="mx-auto max-w-3xl">
      {!query && (
        <header className="mb-8 text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Search &amp; <span className="text-gradient">browse</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
            Describe what you&rsquo;re looking for in plain language — or just filter and browse
            the full ledger of {totals.grants.toLocaleString()} grants below. Browsing is always free.
          </p>
        </header>
      )}

      {errorMsg && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {errorMsg}
        </p>
      )}

      {background && <PdfPreview />}

      {query.length >= 20 && (
        <details className="mb-6 rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm">
          <summary className="cursor-pointer select-none font-medium">
            What we sent the matcher
            {background && (
              <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">
                (goal + {background.length.toLocaleString()} chars from your document)
              </span>
            )}
          </summary>
          <div className="mt-3 grid gap-4">
            {goal && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Your goal
                </p>
                <pre className="whitespace-pre-wrap break-words rounded-xl bg-black/5 p-3 font-sans text-sm">{goal}</pre>
              </div>
            )}
            {background && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Text extracted from your document
                </p>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/5 p-3 font-sans text-xs leading-relaxed text-[var(--color-ink)]">{background}</pre>
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  This is exactly what the matcher sees — capped at 4,000 characters. If something
                  important is missing, your PDF may be image-only or have unusual encoding.
                </p>
              </div>
            )}
          </div>
        </details>
      )}

      <Form action="/search" className="paper tape-card mb-8 grid gap-3 p-5 sm:p-6">
        {/* Textarea is intentionally EMPTY on every render. We previously
            pre-filled with the URL's goal, but that made "search A → refine
            → accidentally submit AB" trivial (cursor at the end, type new
            text, BAM — old query gets appended). The previous goal lives
            in the placeholder and the chip below so the user can see what
            they searched but never accidentally edits it. */}
        {/* Not `required`: an empty query + filters = browse mode. */}
        <textarea
          name="q"
          maxLength={2000}
          rows={4}
          autoComplete="off"
          placeholder={
            goal
              ? `Type a new query. (Previous: ${goal.length > 80 ? goal.slice(0, 77) + "…" : goal})`
              : "e.g. companies doing computer-vision quality inspection in Ontario, or labs researching battery recycling…"
          }
          className="ruled focus-ring w-full resize-y rounded-md border border-[var(--color-ink)]/15 bg-white px-4 py-1 text-base outline-none transition-colors focus:border-[var(--color-accent)]/50"
        />

        {goal && (
          <p className="text-xs text-[var(--color-muted)]">
            Currently showing results for{" "}
            <span className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[var(--color-ink)]">
              {goal.length > 100 ? goal.slice(0, 97) + "…" : goal}
            </span>
            . Type above to run a new search.
          </p>
        )}

        {background && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            📄 A PDF was attached on the previous step (
            <span className="font-medium">{background.length.toLocaleString()} chars</span>).
            Submitting from here uses your goal text only &mdash; the document is dropped.{" "}
            <Link href="/" className="underline">Re-upload</Link> if you want it kept.
          </p>
        )}

        <Suspense fallback={<FilterSkeleton />}>
          <AdvancedFiltersAsync facetsPromise={facetsPromise} filters={filters} />
        </Suspense>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {!query && (
            <label className="mr-auto flex items-center gap-2 text-sm">
              <span className="kicker">sort</span>
              <select
                name="sort"
                defaultValue={sort}
                className="rounded-md border border-[var(--color-ink)]/15 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="recent">Most recent</option>
                <option value="amount_desc">Largest amount</option>
                <option value="amount">Smallest amount</option>
              </select>
            </label>
          )}
          {query && (
            <Link
              href="/search"
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:underline"
            >
              Back to browse
            </Link>
          )}
          <button
            type="submit"
            className="btn-primary focus-ring px-5 py-2 text-sm font-semibold"
          >
            {/* One button, two modes: with a query it searches, without it
                applies filters/sort to the ledger below. */}
            Search / Apply
          </button>
        </div>
      </Form>

      {(autoLocationHint || autoOrgHint) && (
        <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-900">
          Auto-filtered to{" "}
          {autoOrgHint && (
            <>
              <span className="font-semibold">{autoOrgHint.source}</span>
              {autoLocationHint ? " " : ""}
            </>
          )}
          {autoLocationHint && (
            <>
              in <span className="font-semibold">{autoLocationHint.province}</span>
            </>
          )}
          {" "}(you mentioned{" "}
          {[autoOrgHint?.source, autoLocationHint?.source].filter(Boolean).map((s, i, arr) => (
            <span key={s}>
              <span className="font-medium">&ldquo;{s}&rdquo;</span>
              {i < arr.length - 1 ? " and " : ""}
            </span>
          ))}
          ). Clear in the Filters panel to widen results.
        </p>
      )}

      {/* Name lookup runs for any non-trivial query (even short ones below
          the semantic-search minimum) — surfacing the right company is more
          useful than nagging the user to type more. */}
      {query.length >= 3 && (
        <Suspense fallback={null}>
          <CompanyMatchesAsync query={query} />
        </Suspense>
      )}

      {/* No nagging before the user has typed anything — the warning only
          appears for a real-but-too-short query. */}
      {query.length > 0 && query.length < 20 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          For semantic matching, add a bit more detail about what you&rsquo;re looking for (at
          least 20 characters).
        </p>
      )}
      {query.length >= 20 && (
        <Suspense fallback={<ResultsSkeleton />}>
          <Results query={query} filters={effectiveFilters} />
        </Suspense>
      )}

      {/* No query → the browsable grant ledger (the old /browse page). Free,
          unlimited, never touches the AI quota. */}
      {!query && (
        <Suspense fallback={<BrowseSkeleton />}>
          <BrowseList filters={effectiveFilters} sort={sort} page={page} />
        </Suspense>
      )}
    </div>
  );
}

function BrowseSkeleton() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-md bg-black/5" />
      ))}
    </div>
  );
}

async function AdvancedFiltersAsync({
  facetsPromise,
  filters,
}: {
  facetsPromise: ReturnType<typeof listFacets>;
  filters: ReturnType<typeof readFilters>;
}) {
  const facets = await facetsPromise;
  return (
    <AdvancedFilters
      facets={facets}
      current={filters}
      defaultOpen={hasAnyFilter(filters)}
    />
  );
}

async function CompanyMatchesAsync({ query }: { query: string }) {
  const nameQuery = extractNameQuery(query);
  // Avoid running the trigram lookup on long, prose-y queries (resume-only
  // submissions, multi-sentence goals). Trigram against a long string returns
  // low-score noise that's not worth showing.
  if (nameQuery.length < 3 || nameQuery.length > 60) return null;
  const matches = await lookupCompaniesByName(nameQuery, {
    maxResults: 3,
    minSimilarity: 0.4,
  });
  if (matches.length === 0) return null;
  return <CompanyMatches matches={matches} interpretedAs={nameQuery} />;
}

function PageSkeleton() {
  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <div className="h-28 animate-pulse rounded-2xl bg-black/5" />
        <div className="h-9 w-40 animate-pulse self-end rounded-full bg-black/5" />
      </div>
      <ResultsSkeleton />
    </div>
  );
}

function FilterSkeleton() {
  return <div className="h-12 animate-pulse rounded-2xl bg-black/5" />;
}

function ResultsSkeleton() {
  return (
    <div className="grid gap-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl bg-black/5" />
      ))}
    </div>
  );
}

