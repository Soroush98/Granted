import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { Results } from "./results";
import { CompanyMatches } from "./company-matches";
import { PdfPreview } from "./_components/pdf-preview";
import { AdvancedFilters } from "@/app/_components/advanced-filters";
import { extractNameQuery, listFacets, lookupCompaniesByName } from "@/lib/rag/browse";
import { hasAnyFilter, readFilters, type Params } from "@/lib/filters";
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

async function SearchPageContent({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "").trim();
  const errorParam = typeof params.error === "string" ? params.error : undefined;
  const errorMsg = errorParam ? ERROR_MESSAGES[errorParam] : null;
  const { goal, background } = splitQueryParts(query);

  const filters = readFilters(params);

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

  return (
    <>
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

      <Form action="/search" className="mb-8 grid gap-3">
        <textarea
          name="q"
          required
          rows={4}
          defaultValue={query}
          // autoComplete=off stops Chrome / Firefox from restoring a stale
          // value when the user navigates back to this page. The bfcache
          // (Safari especially) can still revive form state — combine with
          // the "Start over" link below so the user always has an obvious
          // reset.
          autoComplete="off"
          className="w-full resize-y rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm outline-none focus:border-black/30"
        />

        <Suspense fallback={<FilterSkeleton />}>
          <AdvancedFiltersAsync facetsPromise={facetsPromise} filters={filters} />
        </Suspense>

        <div className="flex items-center justify-end gap-3">
          {query && (
            <Link
              href="/"
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:underline"
            >
              Start over
            </Link>
          )}
          <button
            type="submit"
            className="btn-primary focus-ring rounded-full px-5 py-2 text-sm font-semibold"
          >
            Search
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

      {query.length < 20 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          For semantic matching, add a bit more detail about your background (at least 20 characters).
          {" "}<Link href="/" className="underline">Back to start</Link>.
        </p>
      ) : (
        <Suspense fallback={<ResultsSkeleton />}>
          <Results query={query} filters={filters} />
        </Suspense>
      )}
    </>
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

