"use client";

import type { PublicEngineer } from "@/lib/engineers/types";

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Minimal clickable card for one engineer — avatar, name, bio, top languages. */
export function EngineerCard({
  engineer,
  onSelect,
}: {
  engineer: PublicEngineer;
  onSelect: (e: PublicEngineer) => void;
}) {
  const display = engineer.name ?? engineer.login;

  return (
    <button
      type="button"
      onClick={() => onSelect(engineer)}
      className="card-lift focus-ring flex items-start gap-3 rounded-2xl border border-black/10 bg-white/70 p-4 text-left backdrop-blur transition-shadow"
    >
      <Avatar engineer={engineer} display={display} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">
          {display}
        </span>
        <span className="block truncate text-sm text-[var(--color-muted)]">
          @{engineer.login}
          {engineer.location ? ` · ${engineer.location}` : ""}
        </span>
        {engineer.bio && (
          <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">
            {engineer.bio}
          </span>
        )}
        {engineer.top_languages.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1">
            {engineer.top_languages.slice(0, 3).map((lang) => (
              <span
                key={lang}
                className="rounded-full border border-black/10 bg-[var(--color-warm-bg)] px-2 py-0.5 text-[11px] text-[var(--color-ink)]"
              >
                {lang}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/** Avatar image with an initials fallback rendered underneath. */
export function Avatar({
  engineer,
  display,
  size = 44,
}: {
  engineer: PublicEngineer;
  display: string;
  size?: number;
}) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-accent-soft)]/60 text-sm font-semibold text-[var(--color-ink)]"
      style={{ height: size, width: size }}
    >
      {initialsOf(display)}
      {engineer.avatar_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={engineer.avatar_url}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
