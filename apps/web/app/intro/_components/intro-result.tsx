"use client";

import { useState } from "react";
import type { IntroKit } from "@/lib/intro/types";

export function IntroResult({ kit }: { kit: IntroKit }) {
  const { company, grant, engineer } = kit;
  const display = engineer.name ?? engineer.login;
  const where = [company.city, company.province].filter(Boolean).join(", ");

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      {/* Grounding: the real funded work the outreach references */}
      {grant && (
        <div className="rounded-2xl border border-[var(--color-accent)]/20 bg-[var(--color-accent-soft)]/30 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            Grounded in {company.display_name}&rsquo;s funded work
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">
            {grant.title ?? "Recent R&D award"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            {[
              grant.program,
              grant.amount_cad ? `$${Math.round(grant.amount_cad).toLocaleString()}` : null,
              grant.fiscal_year ?? (grant.start_date ? grant.start_date.slice(0, 4) : null),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}

      {/* The referral target */}
      <div className="flex items-start gap-3 rounded-2xl border border-black/10 bg-white/70 p-4 backdrop-blur">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-accent-soft)]/60 text-sm font-semibold text-[var(--color-ink)]">
          {initials(display)}
          {engineer.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={engineer.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Reach out to
          </p>
          <p className="truncate text-base font-semibold tracking-tight text-[var(--color-ink)]">
            {display}{" "}
            <a
              href={engineer.html_url ?? `https://github.com/${engineer.login}`}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-sm font-normal text-[var(--color-accent)] hover:underline"
            >
              @{engineer.login}
            </a>
          </p>
          {where && <p className="text-xs text-[var(--color-muted)]">{where}</p>}
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{kit.why_match}</p>
        </div>
      </div>

      {/* The drafted message */}
      <DraftCard subject={kit.subject} message={kit.message} />

      <p className="text-center text-xs text-[var(--color-muted)]">
        A first draft, not a send button. Make it yours — then reach out on GitHub, LinkedIn, or email.
      </p>
    </div>
  );
}

function DraftCard({ subject, message }: { subject: string; message: string }) {
  const [copied, setCopied] = useState(false);
  const full = `Subject: ${subject}\n\n${message}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Your draft
        </p>
        <button
          type="button"
          onClick={copy}
          className="focus-ring rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-[var(--color-ink)] transition-colors hover:bg-black/[0.03]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <p className="mt-3 text-sm font-medium text-[var(--color-ink)]">{subject}</p>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink)]">
        {message}
      </p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
