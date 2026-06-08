import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/app/_components/logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Granted: Find Canadian companies actually doing funded R&D",
  description:
    "Search Canadian companies and labs by the federal R&D funding they've received. Granted indexes NSERC, IRAP, SIF, CFI, FRQ, and other public funding sources so you can find serious tech employers in your field.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-black/5 bg-[color-mix(in_srgb,var(--color-warm-bg)_85%,transparent)] backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
            <Link
              href="/"
              className="group flex items-center gap-2 text-lg font-semibold tracking-tight"
            >
              <Logo
                size={26}
                className="transition-transform group-hover:rotate-[8deg] group-hover:scale-110"
              />
              <span className="transition-colors group-hover:text-[var(--color-accent)]">
                Granted
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm text-[var(--color-muted)]">
              <NavLink href="/jobs">Find a Job</NavLink>
              <NavLink href="/supervisors">Find a Supervisor</NavLink>
              <NavLink href="/search">Search</NavLink>
              <NavLink href="/browse">Browse</NavLink>
              <NavLink href="/stats">Stats</NavLink>
              <NavLink href="/about">About</NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
        <footer className="mx-auto mt-16 max-w-5xl border-t border-black/5 px-6 py-8 text-xs text-[var(--color-muted)]">
          <p>
            Public data from NSERC, IRAP, SIF, CFI, FRQ (Quebec), Alberta Innovates, ERA, Scale AI,
            and federal proactive disclosure. Amounts and recipients may be incomplete; verify on
            the official sources before contacting any organization.
          </p>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 transition-colors hover:bg-black/5 hover:text-[var(--color-ink)]"
    >
      {children}
    </Link>
  );
}
