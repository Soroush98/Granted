import type { CompeteResult, VerdictLabel } from "@/lib/talent/types";

// Plain-language framing for each verdict — no jargon, encouraging even when
// the answer is "not yet".
const VERDICT_COPY: Record<
  VerdictLabel,
  { emoji: string; headline: string; sub: string; chip: string; bar: string; gapsTitle: string }
> = {
  competitive: {
    emoji: "🎯",
    headline: "You're a strong contender",
    sub: "Your background holds up well against people already doing this role. Go for it.",
    chip: "bg-emerald-100 text-emerald-900 border-emerald-200",
    bar: "bg-emerald-500",
    gapsTitle: "Nice-to-haves",
  },
  borderline: {
    emoji: "✨",
    headline: "You're close",
    sub: "You're within range — a few focused moves would make you a clear fit.",
    chip: "bg-amber-100 text-amber-900 border-amber-200",
    bar: "bg-amber-500",
    gapsTitle: "Where to focus next",
  },
  not_yet: {
    emoji: "🌱",
    headline: "Not there yet — but it's reachable",
    sub: "There's a real gap today. Here's exactly what to build toward.",
    chip: "bg-rose-100 text-rose-900 border-rose-200",
    bar: "bg-rose-500",
    gapsTitle: "Your roadmap",
  },
};

export function VerdictCard({ result }: { result: CompeteResult }) {
  const { verdict, percentile, cohort_summary: s, company, role } = result;
  const c = VERDICT_COPY[verdict.verdict];
  const scorePct = Math.round(verdict.score * 100);

  return (
    <div className="overflow-hidden rounded-3xl border border-black/10 bg-white/70 shadow-[0_8px_32px_-12px_rgba(11,13,16,0.12)] backdrop-blur">
      {/* Hero */}
      <div className="border-b border-black/5 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            {role} · {company}
          </p>
          <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${c.chip}`}>
            {verdict.verdict === "not_yet" ? "Not yet" : verdict.verdict === "borderline" ? "Close" : "Competitive"}
          </span>
        </div>
        <h2 className="mt-3 flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          <span aria-hidden>{c.emoji}</span>
          <span>{c.headline}</span>
        </h2>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-[var(--color-muted)]">{c.sub}</p>
      </div>

      {/* The two meters, in plain language */}
      <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-7">
        <Meter
          label="Overall competitiveness"
          pct={scorePct}
          barClass={c.bar}
          caption={
            scorePct >= 70
              ? "You'd be a serious candidate here."
              : scorePct >= 45
                ? "You're in the conversation, with room to grow."
                : "A meaningful gap to close first."
          }
        />
        <Meter
          label="How naturally you fit in"
          pct={percentile}
          barClass="bg-[var(--color-accent)]"
          caption={`Your background lines up better than ${percentile}% of the people already in this role.`}
        />
      </div>

      {/* The honest summary */}
      <div className="px-6 sm:px-7">
        <div className="rounded-2xl border border-black/10 bg-white/60 p-4 text-[15px] leading-relaxed text-[var(--color-ink)]">
          {verdict.summary}
        </div>
      </div>

      {/* Strengths + focus areas */}
      <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-7">
        <List
          title="What's working for you"
          items={verdict.strengths}
          tone="good"
          empty="We didn't spot standout overlaps yet — the focus areas are where to start."
        />
        <List
          title={c.gapsTitle}
          items={verdict.gaps}
          tone="bad"
          empty="Nothing major stood out — you cover the essentials."
        />
      </div>

      {/* Who you're up against */}
      <div className="border-t border-black/5 bg-white/40 p-6 sm:p-7">
        <p className="text-sm font-semibold text-[var(--color-ink)]">
          Who&rsquo;s already in this role
        </p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Based on {s.profile_count} real profiles. The skills they list most:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {s.top_skills.slice(0, 10).map((sk) => (
            <span
              key={sk.skill}
              className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[var(--color-ink)]"
            >
              {sk.skill}
              <span className="ml-1 text-[var(--color-muted)]">{sk.count}</span>
            </span>
          ))}
        </div>
        {s.median_years_experience !== null && (
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Typically around{" "}
            <span className="font-medium text-[var(--color-ink)]">
              {s.median_years_experience} years
            </span>{" "}
            of experience
            {s.common_prior_companies.length > 0 && (
              <>
                , often coming from{" "}
                <span className="font-medium text-[var(--color-ink)]">
                  {s.common_prior_companies.slice(0, 3).map((co) => co.company).join(", ")}
                </span>
              </>
            )}
            .
          </p>
        )}
      </div>
    </div>
  );
}

/** A labelled progress bar — reads as "X out of 100" rather than a raw stat. */
function Meter({
  label,
  pct,
  barClass,
  caption,
}: {
  label: string;
  pct: number;
  barClass: string;
  caption: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-[var(--color-ink)]">{label}</span>
        <span className="font-mono text-sm font-semibold text-[var(--color-ink)]">{clamped}/100</span>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-black/10">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-muted)]">{caption}</p>
    </div>
  );
}

function List({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: "good" | "bad";
  empty: string;
}) {
  const icon = tone === "good" ? "✓" : "→";
  const iconClass =
    tone === "good"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-amber-100 text-amber-700";
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-muted)]">{empty}</p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconClass}`}
                aria-hidden
              >
                {icon}
              </span>
              <span className="leading-relaxed">{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
