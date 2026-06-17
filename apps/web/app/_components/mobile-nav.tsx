"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/supervisors", label: "Supervisors" },
  { href: "/research-pi", label: "PIs" },
  { href: "/search", label: "Search" },
  { href: "/pass", label: "Pricing" },
  { href: "/notes", label: "Notes" },
  { href: "/about", label: "How it works" },
] as const;

// Small-screen navigation. The desktop nav is hidden below `sm`, so without
// this the primary routes are unreachable on a phone. A hamburger toggles a
// dropdown sheet; tapping a link or the backdrop closes it.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-ink)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="17" x2="21" y2="17" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-[57px] z-30 bg-black/20"
          />
          {/* Sheet */}
          <nav className="absolute left-0 right-0 top-full z-40 border-b border-[var(--color-border)] bg-[var(--color-paper)] shadow-lg">
            <ul className="mx-auto grid max-w-5xl gap-0.5 px-4 py-3">
              {LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className={`block rounded-lg px-3 py-2.5 text-[15px] transition-colors ${
                        active
                          ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                          : "text-[var(--color-ink)] hover:bg-[var(--color-warm-bg)]"
                      }`}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}
    </div>
  );
}
