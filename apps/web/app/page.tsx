import Form from "next/form";
import Link from "next/link";
import { searchWithResume } from "./actions";
import { ResumeInput } from "./_components/resume-input";

// Next.js 16: this page is fully static (PPR shell). The dynamic part lives
// at /search and is streamed in via <Suspense> there.
export default function Home() {
  return (
    <section className="mx-auto max-w-2xl py-8 sm:py-12">
      {/* Pill above the headline — small but adds a "polished landing page" feel */}
      <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[var(--color-muted)] shadow-sm backdrop-blur">
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent)]" />
        </span>
        48,952 grants indexed across 9 Canadian funding sources
      </div>

      <h1 className="mt-6 text-center text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Find Canadian organizations{" "}
        <span className="text-gradient">actually doing</span>{" "}
        the work you care about.
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-center text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
        Upload your resume, a research paper, or a project brief, and describe what you want to find.
        Granted matches against organizations whose{" "}
        <span className="font-medium text-[var(--color-ink)]">federally-funded R&amp;D</span>{" "}
        overlaps with your background — companies for job-hunters, labs for researchers, both for partnerships.
      </p>

      <Form
        action={searchWithResume}
        className="mt-10 grid gap-4 rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_8px_32px_-12px_rgba(11,13,16,0.12)] backdrop-blur sm:p-6"
      >
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Resume, research paper, or project PDF (optional)
          </span>
          <ResumeInput />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            What are you looking for?
          </span>
          <textarea
            name="q"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            // Prevent browser bfcache / form-state restoration from filling
            // in a stale query when the user back-navigates from results.
            autoComplete="off"
            placeholder={
              "Examples:\n" +
              "• ML systems engineer focused on LLM inference efficiency — companies hiring in this area.\n" +
              "• Find Canadian labs whose research is close to my paper on SDN traffic sampling.\n" +
              "• Industry partners doing applied work in battery recycling, Ontario or BC.\n" +
              "Mention 'companies only' or 'university labs' to narrow."
            }
            className="focus-ring w-full resize-y rounded-2xl border border-black/10 bg-white p-4 text-base shadow-sm outline-none transition-colors focus:border-[var(--color-accent)]/40"
          />
        </label>

        <button
          type="submit"
          className="btn-primary focus-ring mx-auto mt-1 rounded-full px-7 py-3 text-sm font-semibold"
        >
          Find my matches  →
        </button>
      </Form>

      {/* Stat strip — pulls the eye after the form, reinforces "this thing has real data" */}
      <ul className="mt-10 grid grid-cols-3 gap-3 text-center">
        <Stat label="Grants" value="48.9K" sub="indexed" />
        <Stat label="Organizations" value="14.7K" sub="deduped" />
        <Stat label="Sources" value="9" sub="federal + provincial" />
      </ul>

      {/* Secondary actions — kept small but tactile */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-sm">
        <SecondaryLink href="/compete">Am I competitive?</SecondaryLink>
        <SecondaryLink href="/browse">Browse all grants</SecondaryLink>
        <SecondaryLink href="/stats">See the numbers</SecondaryLink>
        <SecondaryLink href="/about">How this works</SecondaryLink>
      </div>

      <p className="mt-8 text-center text-xs text-[var(--color-muted)]">
        Public data only. No SR&amp;ED (it&rsquo;s legally confidential). Treat totals as a lower bound.
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <li className="rounded-2xl border border-black/10 bg-white/60 px-3 py-4 backdrop-blur">
      <p className="font-mono text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {value}
      </p>
      <p className="mt-1 text-xs font-medium text-[var(--color-ink)]">{label}</p>
      <p className="text-[11px] text-[var(--color-muted)]">{sub}</p>
    </li>
  );
}

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-black/10 bg-white/60 px-4 py-1.5 text-[var(--color-ink)] transition hover:border-[var(--color-ink)]/30 hover:bg-white"
    >
      {children}
    </Link>
  );
}
