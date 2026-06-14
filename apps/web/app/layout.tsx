import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Karla, IBM_Plex_Mono, Caveat } from "next/font/google";
import { Logo } from "@/app/_components/logo";
import { UserNav } from "@/app/_components/user-nav";
import "./globals.css";

// FIELD NOTES type system: Karla (body) + IBM Plex Mono (labels/data) +
// Caveat (handwritten annotations). Exposed as CSS vars for globals.css.
const karla = Karla({ subsets: ["latin"], variable: "--font-karla" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat" });

export const metadata: Metadata = {
  title: "Granted: Find companies & labs actually doing funded R&D",
  description:
    "Search companies and labs in Canada, the US, the UK, and Australia by the public R&D funding they've received. Granted indexes NSERC, CIHR, NSF, NIH, UKRI, ARC, and other funding sources so you can find serious tech employers and research labs in your field.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${karla.variable} ${plexMono.variable} ${caveat.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-dashed border-[var(--color-ink)]/25 bg-[var(--color-paper)]/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link href="/" className="group flex items-baseline gap-2">
              <Logo size={24} className="self-center transition-transform group-hover:rotate-[8deg] group-hover:scale-110" />
              <span className="text-lg font-bold tracking-tight">granted</span>
              <span className="hand hidden text-lg leading-none text-[var(--color-muted)] sm:inline">
                — field notes on funded R&amp;D
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <nav className="flex items-center gap-0.5 font-[family-name:var(--font-mono)] text-[13px] text-[var(--color-muted)]">
                <NavLink href="/jobs">jobs</NavLink>
                <NavLink href="/supervisors">supervisors</NavLink>
                <NavLink href="/research-pi">PIs</NavLink>
                <NavLink href="/search">search &amp; browse</NavLink>
                <NavLink href="/pass">pricing</NavLink>
              </nav>
              <Suspense fallback={<div className="h-7 w-24" />}>
                <UserNav />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
        <footer className="mx-auto mt-16 max-w-5xl border-t border-dashed border-[var(--color-ink)]/25 px-6 py-8 text-xs text-[var(--color-muted)]">
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-[family-name:var(--font-mono)]">
            <Link href="/about" className="hover:text-[var(--color-ink)] hover:underline">how it works</Link>
            <Link href="/stats" className="hover:text-[var(--color-ink)] hover:underline">stats</Link>
            <Link href="/search" className="hover:text-[var(--color-ink)] hover:underline">browse grants</Link>
            <Link href="/pass" className="hover:text-[var(--color-ink)] hover:underline">pricing</Link>
            <Link href="/login" className="hover:text-[var(--color-ink)] hover:underline">log in</Link>
          </div>
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
      className="rounded px-2.5 py-1.5 transition-colors hover:bg-[var(--color-highlight)]/50 hover:text-[var(--color-ink)]"
    >
      {children}
    </Link>
  );
}
