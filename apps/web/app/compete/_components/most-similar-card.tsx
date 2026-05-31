import type { MostSimilar } from "@/lib/talent/types";

/** The real cohort member whose profile is closest to the user's resume.
 * Shown only when the verdict isn't "not_yet" (gated in the page). Full public
 * identity per the product decision — name + headline + LinkedIn link. */
export function MostSimilarCard({ person }: { person: MostSimilar }) {
  const initials = person.full_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="rounded-3xl border border-[var(--color-accent)]/20 bg-[var(--color-accent-soft)]/40 p-6 backdrop-blur sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
        👋 Meet your closest match
      </p>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Of everyone already in this role, this person&rsquo;s path looks most like yours — a natural
        person to learn from or reach out to.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/80 text-sm font-semibold text-[var(--color-ink)] shadow-sm">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold tracking-tight text-[var(--color-ink)]">
            {person.full_name}
          </p>
          {(person.current_title || person.headline) && (
            <p className="truncate text-sm text-[var(--color-muted)]">
              {person.current_title ?? person.headline}
              {person.location && <> · {person.location}</>}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-black/10 bg-white/70 px-3 py-1 font-mono text-xs font-semibold text-[var(--color-ink)]">
          {Math.round(person.similarity * 100)}% match
        </span>
      </div>

      <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-ink)]">
        <span className="font-medium">Why them: </span>
        {person.rationale}
      </p>

      {person.linkedin_url && (
        <a
          href={person.linkedin_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="btn-primary focus-ring mt-5 inline-flex rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          See their profile on LinkedIn  →
        </a>
      )}
    </div>
  );
}
