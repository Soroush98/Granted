import Form from "next/form";
import Link from "next/link";
import { searchWithResume } from "./actions";
import { ResumeInput } from "./_components/resume-input";
import { corpusTotals } from "@/lib/rag/browse";

// Landing page, FIELD NOTES style: a researcher's notebook spread that routes
// to the three finders (taped index cards), with the free-form PDF search as
// the "or search everything" sheet below.
export default async function Home() {
  const totals = await corpusTotals();
  return (
    <section className="mx-auto max-w-3xl py-6 sm:py-8">
      {/* Hero */}
      <p className="kicker text-center">
        field notes · grant-funded orgs · canada · us · uk · australia
      </p>

      <h1 className="mt-5 text-center text-balance text-4xl font-bold tracking-tight sm:text-5xl">
        Who&rsquo;s <span className="highlight">funded</span> to do{" "}
        <span className="text-gradient">your exact work</span>?
      </h1>

      <p className="hand mx-auto mt-4 max-w-xl text-center text-2xl leading-snug text-[var(--color-muted)]">
        every match cites a real grant — your concrete reason to reach out ↓
      </p>

      {/* The three finders: index cards taped to the page */}
      <div className="mt-12 grid gap-5 sm:grid-cols-3">
        <FinderCard
          href="/jobs"
          tape="tape-left"
          no="01"
          title="Find a Job"
          note="companies funded to do your work — even ones not posting jobs"
          cta="find companies"
        />
        <FinderCard
          href="/supervisors"
          tape=""
          no="02"
          title="Find a Supervisor"
          note="university labs funded in your research area"
          cta="find labs"
        />
        <FinderCard
          href="/research-pi"
          tape="tape-right"
          no="03"
          title="Find a PI"
          note="funded investigators in Canada, the US, the UK & Australia who can host you"
          cta="find PIs"
        />
      </div>

      {/* Divider */}
      <div className="mt-14 mb-4 flex items-center gap-3">
        <div className="h-px flex-1 border-t border-dashed border-[var(--color-ink)]/30" />
        <p className="hand text-2xl text-[var(--color-muted)]">or search everything…</p>
        <div className="h-px flex-1 border-t border-dashed border-[var(--color-ink)]/30" />
      </div>

      {/* Free-form search: a paper sheet with ruled lines (PDF upload is unique
          to this page). */}
      <Form action={searchWithResume} className="paper tape-card grid gap-4 p-5 sm:p-6">
        <label className="grid gap-1.5">
          <span className="kicker">resume, research paper, or project pdf (optional)</span>
          <ResumeInput />
        </label>

        <label className="grid gap-1.5">
          <span className="kicker">what are you looking for?</span>
          <textarea
            name="q"
            required
            minLength={20}
            maxLength={2000}
            rows={4}
            autoComplete="off"
            placeholder={
              "e.g. ML systems engineer focused on LLM inference efficiency — companies hiring in this area.\n" +
              "Mention 'companies only' or 'university labs' to narrow."
            }
            className="ruled focus-ring w-full resize-y rounded-md border border-[var(--color-ink)]/15 bg-white px-4 py-1 text-base outline-none transition-colors focus:border-[var(--color-accent)]/50"
          />
        </label>

        <button
          type="submit"
          className="btn-primary focus-ring mx-auto mt-1 px-7 py-3 text-sm font-semibold"
        >
          Find my matches&nbsp;&nbsp;→
        </button>
      </Form>

      {/* The ledger line */}
      <p className="mt-10 text-center font-[family-name:var(--font-mono)] text-[13px] text-[var(--color-muted)]">
        {totals.grants.toLocaleString()} grants&nbsp;&nbsp;·&nbsp;&nbsp;
        {totals.organizations.toLocaleString()} organizations&nbsp;&nbsp;·&nbsp;&nbsp;
        {totals.chunks.toLocaleString()} indexed chunks&nbsp;&nbsp;·&nbsp;&nbsp;
        <Link href="/stats" className="underline hover:text-[var(--color-ink)]">
          see the numbers
        </Link>
      </p>

      {/* Pass teaser: a sticky note */}
      <div className="sticky-note mx-auto mt-12 max-w-md rounded-sm p-5 text-center">
        <p className="hand text-3xl leading-none">hunting seriously?</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink)]/80">
          The 30-Day Job Hunt Pass — 500 searches + live web search for freshly-funded companies.
          One-time. No auto-renew.
        </p>
        <Link
          href="/pass"
          className="btn-primary focus-ring mt-3 inline-block px-5 py-2 text-sm font-semibold"
        >
          See pricing
        </Link>
      </div>

      <p className="mt-10 text-center text-xs text-[var(--color-muted)]">
        Public data only. No SR&amp;ED (it&rsquo;s legally confidential). Treat totals as a lower bound.
      </p>
    </section>
  );
}

function FinderCard({
  href, tape, no, title, note, cta,
}: { href: string; tape: string; no: string; title: string; note: string; cta: string }) {
  return (
    <Link href={href} className={`paper tape-card ${tape} card-lift group flex flex-col p-5`}>
      <span className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.14em] text-[var(--color-muted)]">
        № {no}
      </span>
      <h2 className="mt-2 text-lg font-bold tracking-tight">{title}</h2>
      <p className="hand mt-1.5 flex-1 text-[22px] leading-tight text-[var(--color-muted)]">
        {note}
      </p>
      <span className="mt-4 font-[family-name:var(--font-mono)] text-[13px] font-medium text-[var(--color-accent)] transition-transform group-hover:translate-x-0.5">
        {cta} →
      </span>
    </Link>
  );
}
