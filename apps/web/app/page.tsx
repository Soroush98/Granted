import Form from "next/form";
import Link from "next/link";
import { searchWithResume } from "./actions";
import { ResumeInput } from "./_components/resume-input";
import { corpusTotals } from "@/lib/rag/browse";

// Landing page: a clean hero that routes to the three finders, with the
// free-form PDF search as the "or search everything" panel below.
export default async function Home() {
  const totals = await corpusTotals();
  return (
    <section className="mx-auto max-w-3xl py-6 sm:py-10">
      {/* Hero */}
      <p className="kicker text-center">
        Grant-funded orgs · Canada · US · UK · Australia
      </p>

      <h1 className="mt-5 text-center text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Who&rsquo;s <span className="text-gradient">funded</span> to do your exact work?
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-center text-lg leading-relaxed text-[var(--color-muted)]">
        Every match cites a real grant — your concrete reason to reach out.
      </p>

      {/* The three finders */}
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        <FinderCard
          href="/jobs"
          title="Find a Job"
          note="Companies funded to do your work — even ones not posting jobs."
          cta="Find companies"
        />
        <FinderCard
          href="/supervisors"
          title="Find a Supervisor"
          note="University labs funded in your research area."
          cta="Find labs"
        />
        <FinderCard
          href="/research-pi"
          title="Find a PI"
          note="Funded investigators in Canada, the US, the UK & Australia who can host you."
          cta="Find PIs"
        />
      </div>

      {/* Divider */}
      <div className="mt-14 mb-5 flex items-center gap-4">
        <div className="h-px flex-1 bg-[var(--color-border)]" />
        <p className="text-sm text-[var(--color-muted)]">or search everything</p>
        <div className="h-px flex-1 bg-[var(--color-border)]" />
      </div>

      {/* Free-form search (PDF upload is unique to this page). */}
      <Form action={searchWithResume} className="paper grid gap-4 p-5 sm:p-6">
        <label className="grid gap-1.5">
          <span className="kicker">Resume, research paper, or project PDF (optional)</span>
          <ResumeInput />
        </label>

        <label className="grid gap-1.5">
          <span className="kicker">What are you looking for?</span>
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
            className="focus-ring w-full resize-y rounded-lg border border-[var(--color-border)] bg-white px-4 py-3 text-base leading-relaxed outline-none transition-colors focus:border-[var(--color-accent)]"
          />
        </label>

        <button
          type="submit"
          className="btn-primary focus-ring mt-1 w-full px-7 py-3 text-sm font-semibold sm:mx-auto sm:w-auto"
        >
          Find my matches
        </button>
      </Form>

      {/* The ledger line */}
      <p className="mt-10 text-center font-[family-name:var(--font-mono)] text-[13px] text-[var(--color-muted)]">
        {totals.grants.toLocaleString()} grants&nbsp;&nbsp;·&nbsp;&nbsp;
        {totals.organizations.toLocaleString()} organizations&nbsp;&nbsp;·&nbsp;&nbsp;
        {totals.chunks.toLocaleString()} indexed chunks&nbsp;&nbsp;·&nbsp;&nbsp;
        <Link href="/stats" className="underline underline-offset-2 hover:text-[var(--color-ink)]">
          see the numbers
        </Link>
      </p>

      {/* Pass teaser */}
      <div className="sticky-note mx-auto mt-12 flex max-w-lg flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
        <div className="flex-1">
          <p className="font-semibold text-[var(--color-ink)]">Hunting seriously?</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted)]">
            The 30-Day Job Hunt Pass — 500 searches + live web search for freshly-funded
            companies. One-time. No auto-renew.
          </p>
        </div>
        <Link
          href="/pass"
          className="btn-primary focus-ring shrink-0 px-5 py-2.5 text-sm font-semibold"
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
  href, title, note, cta,
}: { href: string; title: string; note: string; cta: string }) {
  return (
    <Link href={href} className="paper card-lift group flex flex-col p-5">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[var(--color-muted)]">
        {note}
      </p>
      <span className="mt-4 text-[13px] font-medium text-[var(--color-accent)] transition-transform group-hover:translate-x-0.5">
        {cta} →
      </span>
    </Link>
  );
}
