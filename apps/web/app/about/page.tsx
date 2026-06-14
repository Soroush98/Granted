import Link from "next/link";
import { corpusTotals } from "@/lib/rag/browse";

export default async function About() {
  const totals = await corpusTotals();
  return (
    <article className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">About Granted</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
        Granted indexes publicly-funded R&amp;D across <span className="font-medium text-[var(--color-ink)]">Canada,
        the United States, the United Kingdom, and Australia</span>, and matches your goal (or your
        resume, or a research paper) against organizations whose disclosed work overlaps with what
        you care about. It is read-only, public-data-only, and built to be honest about what it
        cannot tell you.
      </p>

      <h2 className="mt-8 text-lg font-semibold">How it works</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        <li>
          We index each public funding source &mdash; Canadian (NSERC, CIHR, FRQ, federal
          disclosure&hellip;), US (NSF, NIH), UK (UKRI), and Australian (ARC, GrantConnect) &mdash;
          storing every grant with its recipient organization, an amount, a date, and a searchable
          description of the work.
        </li>
        <li>
          When you search, we match your goal &mdash; or your resume or a research paper &mdash;
          against that work <span className="font-medium">by meaning</span>, not just keywords, to
          surface organizations doing what you care about.
        </li>
        <li>
          The strongest candidates are re-ranked for relevance, and each match comes with a
          one-sentence reason it surfaced, so you can judge the fit at a glance.
        </li>
        <li>
          Filter by <span className="font-medium">country</span> (Canada / US / UK / Australia),
          org type, or region in the Filters panel &mdash; or just mention a place
          (&ldquo;Toronto&rdquo;) or org type (&ldquo;companies&rdquo;) in your query and it
          becomes a filter automatically. Type an organization&rsquo;s name and we surface the
          likely match directly.
        </li>
      </ol>

      <h2 className="mt-8 text-lg font-semibold">What is indexed</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-black/10 bg-white text-xs">
        <table className="w-full">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-3 py-2 font-semibold"></th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 text-right font-semibold">Grants</th>
              <th className="px-3 py-2 font-semibold">Date coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            <Row flag="🇨🇦" source="NSERC awards (Discovery, Alliance, CRD, Other)" code="NSERC_*" count="22,510" coverage="Fiscal year 2024 (FY2025 not yet published)" note />
            <Row flag="🇨🇦" source="Federal Proactive Disclosure (all departments)" code="FEDERAL_OTHER" count="13,167" coverage="2024-05-24 to 2026-04-28" />
            <Row flag="🇨🇦" source="NRC Industrial Research Assistance Program" code="IRAP" count="4,029" coverage="2024-05-27 to 2026-01-19" />
            <Row flag="🇨🇦" source="CIHR Grants & Awards (with abstracts)" code="CIHR" count="7,398" coverage="Fiscal year 2025-26" />
            <Row flag="🇨🇦" source="Quebec FRQ (Santé / Nature et technologies / Société et culture)" code="FRQ*" count="6,947" coverage="FY2023-24 (latest published by FRQ; pre-window)" note />
            <Row flag="🇨🇦" source="Canada Foundation for Innovation (funded projects)" code="CFI" count="817" coverage="Calendar years 2024 to 2025" />
            <Row flag="🇨🇦" source="Alberta Innovates + Emissions Reduction Alberta" code="PROVINCIAL_OTHER" count="879" coverage="2024 to 2025 (dates sparse)" note />
            <Row flag="🇨🇦" source="Scale AI funded projects" code="SCALE_AI" count="167" coverage="No per-project dates" note />
            <Row flag="🇨🇦" source="Strategic Innovation Fund" code="SIF" count="30" coverage="2024-06-11 to 2026-03-31" />
            <Row flag="🇺🇸" source="NIH RePORTER (medical research, with abstracts)" code="NIH" count="72,941" coverage="~2 years (award notice from 2024-06)" />
            <Row flag="🇺🇸" source="NSF Awards (science & engineering, incl. SBIR/STTR)" code="NSF" count="17,422" coverage="~2 years (from 2024-06)" />
            <Row flag="🇬🇧" source="UKRI Gateway to Research (7 councils + Innovate UK)" code="UKRI" count="8,881" coverage="~2 years (fund start from 2024-06)" />
            <Row flag="🇦🇺" source="ARC National Competitive Grants (research)" code="ARC" count="12,510" coverage="Commencing 2016 onward" />
            <Row flag="🇦🇺" source="GrantConnect (federal grants, R&D/industry-filtered)" code="GRANTCONNECT" count="10,844" coverage="~2 years (publish from 2024-06)" note />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Totals (after entity-resolution cleanup): <span className="font-medium">{totals.grants.toLocaleString()} grants</span>,{" "}
        <span className="font-medium">{totals.organizations.toLocaleString()} organizations</span>,{" "}
        <span className="font-medium">{totals.chunks.toLocaleString()} indexed text chunks</span>.
        Browse the raw data at <Link href="/search" className="underline">/search</Link> or aggregate
        totals at <Link href="/stats" className="underline">/stats</Link>.
      </p>

      <h2 className="mt-8 text-lg font-semibold">What this is not (limitations)</h2>
      <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed">
        <li>
          <span className="font-medium">Coverage varies by country.</span> Canada is deep but
          lagging; the US, UK, and Australian (GrantConnect) feeds are the last ~2 years; ARC goes
          back to 2016. Amounts sit in one field regardless of currency (CAD/USD/GBP/AUD), so
          cross-country dollar totals are indicative, not converted. Australian <em>company</em>
          coverage comes only from GrantConnect (R&amp;D-filtered, partial) &mdash; ARC funds
          university research only.
        </li>
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
        A few AI searches are free to try without an account. A free account gives you{" "}
        <span className="font-medium">10 searches</span>, and the{" "}
        <Link href="/pass" className="underline">30-Day Job Hunt Pass</Link> unlocks{" "}
        <span className="font-medium">500 searches</span> plus live web search for funded companies.
        Browsing grants and viewing stats is always free and unlimited.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Provenance and verification</h2>
      <p className="mt-2 text-sm leading-relaxed">
        Every data row links back to its source &mdash; Canada: open.canada.ca (federal disclosure
        &amp; CIHR), nserc-crsng.gc.ca, donneesquebec.ca (FRQ), innovation.ca (CFI),
        albertainnovates.ca/eralberta.ca, scaleai.ca; US: api.nsf.gov (NSF), reporter.nih.gov (NIH);
        UK: gtr.ukri.org (UKRI); Australia: dataportal.arc.gov.au (ARC), grants.gov.au (GrantConnect).
        Public data only. Before contacting an organization or making a decision based on a match,
        verify on the original source.
      </p>

      <p className="mt-8 text-xs text-[var(--color-muted)]">
        Built as a personal project. No affiliation with the Government of Canada or any of the
        funding agencies referenced here.
      </p>
    </article>
  );
}

function Row({
  flag, source, code, count, coverage, note,
}: { flag: string; source: string; code: string; count: string; coverage: string; note?: boolean }) {
  return (
    <tr>
      <td className="px-3 py-2 text-center">{flag}</td>
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
