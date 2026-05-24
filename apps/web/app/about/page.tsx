import Link from "next/link";

export default function About() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">About Granted</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
        Granted indexes Canadian federally-funded R&amp;D and matches your goal (or your resume,
        or a research paper) against organizations whose disclosed work overlaps with what you
        care about. It is read-only, public-data-only, and built to be honest about what it
        cannot tell you.
      </p>

      <h2 className="mt-8 text-lg font-semibold">How it works</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        <li>
          Python ingesters pull each source into Postgres: each grant gets a recipient
          organization, an amount, a date (when published), and one or two text chunks (title
          + description) that are searchable.
        </li>
        <li>
          Each chunk is embedded with{" "}
          <span className="font-medium">Voyage AI voyage-3.5</span> (1024-dim) and stored in
          pgvector with an HNSW index. A Postgres tsvector handles full-text search on the
          same chunks.
        </li>
        <li>
          When you search, the query is embedded with the same model, then a hybrid SQL
          function returns the top-10 candidate organizations (70% vector similarity, 30%
          full-text rank).
        </li>
        <li>
          <span className="font-medium">Claude Haiku 4.5</span> reranks those 10 against your
          query and writes a one-sentence rationale for each surviving match, with structured
          JSON output for stable parsing.
        </li>
        <li>
          If your query mentions a Canadian place (&ldquo;Toronto&rdquo;, &ldquo;Quebec&rdquo;)
          or an org type (&ldquo;companies&rdquo;, &ldquo;universities&rdquo;,
          &ldquo;research institutes&rdquo;), those constraints become hard filters before
          retrieval. If the query looks like an organization name, a separate trigram lookup
          surfaces the most likely match in a banner above the ranked results.
        </li>
      </ol>

      <h2 className="mt-8 text-lg font-semibold">What is indexed</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10 bg-white text-xs">
        <table className="w-full">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 text-right font-semibold">Grants</th>
              <th className="px-3 py-2 font-semibold">Date coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            <Row source="Federal Proactive Disclosure (all departments)" code="FEDERAL_OTHER" count="13,573" coverage="2024-05-24 to 2026-04-28" />
            <Row source="NSERC awards (Discovery, Alliance, CRD, Other)" code="NSERC_*" count="22,510" coverage="Fiscal year 2024 (FY2025 not yet published)" note />
            <Row source="NRC Industrial Research Assistance Program" code="IRAP" count="4,029" coverage="2024-05-27 to 2026-01-19" />
            <Row source="Quebec FRQ (Santé / Nature et technologies / Société et culture)" code="FRQ*" count="6,959" coverage="FY2023-24 (latest published by FRQ; pre-window)" note />
            <Row source="Canada Foundation for Innovation (funded projects)" code="CFI" count="817" coverage="Calendar years 2024 to 2025" />
            <Row source="Alberta Innovates + Emissions Reduction Alberta" code="PROVINCIAL_OTHER" count="879" coverage="2024 to 2025 (dates sparse)" note />
            <Row source="Scale AI funded projects" code="SCALE_AI" count="167" coverage="No per-project dates" note />
            <Row source="Strategic Innovation Fund" code="SIF" count="30" coverage="2024-06-11 to 2026-03-31" />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Totals (after entity-resolution cleanup): <span className="font-medium">48,952 grants</span>,{" "}
        <span className="font-medium">14,759 organizations</span>,{" "}
        <span className="font-medium">93,002 indexed text chunks</span>.
        Browse the raw data at <Link href="/browse" className="underline">/browse</Link> or aggregate
        totals at <Link href="/stats" className="underline">/stats</Link>.
      </p>

      <h2 className="mt-8 text-lg font-semibold">What this is not (limitations)</h2>
      <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed">
        <li>
          <span className="font-medium">SR&amp;ED tax credits are confidential.</span> The Scientific
          Research and Experimental Development program is the single largest federal R&amp;D channel
          in Canada (over $4B per year) and is legally not disclosable per recipient. Granted cannot
          show it. Treat the funding totals you see here as a <em>lower bound</em>, not the truth.
        </li>
        <li>
          <span className="font-medium">NSERC is one year behind.</span> NSERC publishes one CSV per
          fiscal year, about a year after the year ends. The current dataset covers FY2024 (April 2024
          to March 2025). FY2025 will appear around late 2026. Also, NSERC rows carry only a fiscal
          year, not a start date, so date-range filters do not narrow NSERC results.
        </li>
        <li>
          <span className="font-medium">Quebec FRQ is pre-window.</span> The latest FRQ data on
          donneesquebec.ca is the FY2023-24 year, which ended in March 2024 (before our nominal
          2-year recency window). Quebec research grants are included because they are still the
          best signal available, but they are not <em>recent</em>.
        </li>
        <li>
          <span className="font-medium">Provincial coverage is uneven.</span> Alberta is well-covered
          via Alberta Innovates and Emissions Reduction Alberta. Ontario, BC, and the Atlantic
          provinces are covered only by whatever federal funds flowed to companies there — there is
          no equivalent provincial agency feed yet for OCI/FedDev (ON), Innovate BC, or ACOA-specific
          programs beyond what proactive disclosure captures.
        </li>
        <li>
          <span className="font-medium">No researcher search.</span> NSERC and FRQ data contain
          ~26,000 unique investigator names, but they live only in the raw JSON of each grant and
          are not indexed. A query like &ldquo;dr. so-and-so&rdquo; will not find their grants today;
          you have to find the institution first and click through.
        </li>
        <li>
          <span className="font-medium">CFI lacks project descriptions.</span> The CFI funded-projects
          dashboard does not expose abstracts, only fund type, field of research, institution, year,
          and team members. We synthesize a chunk from those fields for embedding, but the semantic
          match on CFI rows will be coarser than for IRAP/SIF which have proper abstracts.
        </li>
        <li>
          <span className="font-medium">Some Provincial / Alberta rows have no dates.</span> The
          Alberta Innovates and ERA Alberta scrapers extract dates from project pages best-effort;
          828 of 879 PROVINCIAL_OTHER rows have a null start_date. They still appear in name and
          topic searches; they just will not appear in a date-bounded browse filter.
        </li>
        <li>
          <span className="font-medium">Entity resolution is good, not perfect.</span> We merged
          649 obvious duplicates in the most recent cleanup (University of Toronto used to have
          three separate rows). Smaller subsidiaries, regional campuses, and trade-name variations
          may still appear as separate organizations.
        </li>
        <li>
          <span className="font-medium">Not real-time.</span> Federal proactive disclosure refreshes
          quarterly. Re-ingestion is manual. A recent grant award here often precedes hiring by 3 to
          6 months.
        </li>
        <li>
          <span className="font-medium">Not a job board.</span> Granted shows you which organizations
          are credibly building real tech with public R&amp;D money. You still apply or reach out
          through their own channels.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Search policy</h2>
      <p className="mt-2 text-sm leading-relaxed">
        Each IP is limited to <span className="font-medium">10 searches, total</span> &mdash; not
        per day. The limit is per-lifetime because every search calls the Claude API for the rerank
        step and there is no signed-in account model to attribute usage to. Once an IP hits the
        cap, further searches from that address are blocked. Browsing grants and viewing stats are
        unlimited.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Provenance and verification</h2>
      <p className="mt-2 text-sm leading-relaxed">
        Every data row links back to its source (open.canada.ca for federal proactive disclosure,
        nserc-crsng.gc.ca for NSERC, donneesquebec.ca for FRQ, innovation.ca for CFI,
        albertainnovates.ca and eralberta.ca for Alberta, scaleai.ca for Scale AI). Public data only.
        Before contacting an organization or making a decision based on a match, verify on the
        original source.
      </p>

      <p className="mt-8 text-xs text-[var(--color-muted)]">
        Built as a personal project. No affiliation with the Government of Canada or any of the
        funding agencies referenced here.
      </p>
    </article>
  );
}

function Row({
  source, code, count, coverage, note,
}: { source: string; code: string; count: string; coverage: string; note?: boolean }) {
  return (
    <tr>
      <td className="px-3 py-2">
        {source}
        <span className="ml-1.5 rounded-full bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
          {code}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono">{count}</td>
      <td className="px-3 py-2">
        {coverage}
        {note && <span className="ml-1 text-[var(--color-muted)]">*</span>}
      </td>
    </tr>
  );
}
