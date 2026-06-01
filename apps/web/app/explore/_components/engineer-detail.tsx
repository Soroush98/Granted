"use client";

import { useEffect } from "react";
import type { PublicEngineer } from "@/lib/engineers/types";
import { Avatar } from "./engineer-card";

/** Profile panel for one engineer — avatar, bio, company/location, languages,
 * follower/repo counts, and links out to GitHub + their site. Closes on Esc or
 * backdrop click. */
export function EngineerDetail({
  engineer,
  onClose,
}: {
  engineer: PublicEngineer;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const display = engineer.name ?? engineer.login;
  const blogHref = engineer.blog
    ? /^https?:\/\//i.test(engineer.blog)
      ? engineer.blog
      : `https://${engineer.blog}`
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Profile of ${display}`}
    >
      <div
        className="relative my-auto w-full max-w-lg rounded-3xl border border-black/10 bg-white p-6 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="focus-ring absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-ink)]"
        >
          ✕
        </button>

        <div className="flex items-center gap-3 pr-8">
          <Avatar engineer={engineer} display={display} size={48} />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-[var(--color-ink)]">
              {display}
            </h2>
            <p className="truncate text-sm text-[var(--color-muted)]">@{engineer.login}</p>
            {(engineer.company || engineer.location) && (
              <p className="truncate text-xs text-[var(--color-muted)]">
                {[engineer.company, engineer.location].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        {engineer.bio && (
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink)]">
            {engineer.bio}
          </p>
        )}

        <div className="mt-5 flex gap-6">
          <Stat value={engineer.followers} label="followers" />
          <Stat value={engineer.public_repos} label="public repos" />
          {engineer.hireable && <Stat value="open" label="to work" />}
        </div>

        {engineer.top_languages.length > 0 && (
          <Section title="Top languages">
            <div className="flex flex-wrap gap-1.5">
              {engineer.top_languages.map((lang) => (
                <span
                  key={lang}
                  className="rounded-full border border-black/10 bg-[var(--color-warm-bg)] px-2.5 py-1 text-xs text-[var(--color-ink)]"
                >
                  {lang}
                </span>
              ))}
            </div>
          </Section>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {engineer.html_url && (
            <a
              href={engineer.html_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="btn-primary focus-ring inline-flex rounded-full px-5 py-2.5 text-sm font-semibold"
            >
              View on GitHub  →
            </a>
          )}
          {blogHref && (
            <a
              href={blogHref}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="focus-ring inline-flex rounded-full border border-black/10 bg-white px-5 py-2.5 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-black/[0.03]"
            >
              Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">
        {value}
      </p>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </p>
      {children}
    </div>
  );
}
