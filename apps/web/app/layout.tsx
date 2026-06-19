import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import { Logo } from "@/app/_components/logo";
import { UserNav } from "@/app/_components/user-nav";
import { MobileNav } from "@/app/_components/mobile-nav";
import "./globals.css";

// Clean type system: Inter (UI/body) + IBM Plex Mono (data labels & counts).
// Exposed as CSS vars for globals.css.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Granted: Find companies & labs actually doing funded R&D",
  description:
    "Search companies and labs in Canada, the US, the UK, and Australia by the public R&D funding they've received. Granted indexes NSERC, CIHR, NSF, NIH, UKRI, ARC, and other funding sources so you can find serious tech employers and research labs in your field.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">
        {/* Google Analytics (gtag.js) — loaded after the page is interactive
            so it never blocks first paint. GA4 measurement IDs are public. */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-KGNMQYM9L1"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-KGNMQYM9L1');
          `}
        </Script>
        <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-paper)]/80 backdrop-blur-md relative">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5">
            <Link href="/" className="group flex shrink-0 items-center gap-2">
              <Logo size={24} className="transition-transform group-hover:scale-105" />
              <span className="text-[17px] font-semibold tracking-tight">granted</span>
            </Link>
            <nav className="hidden items-center gap-0.5 text-[14px] text-[var(--color-muted)] sm:flex">
              <NavLink href="/jobs">Jobs</NavLink>
              <NavLink href="/supervisors">Supervisors</NavLink>
              <NavLink href="/research-pi">PIs</NavLink>
              <NavLink href="/search">Search</NavLink>
              <NavLink href="/pass">Pricing</NavLink>
            </nav>
            <div className="flex items-center gap-2">
              <Suspense fallback={<div className="h-7 w-24" />}>
                <UserNav />
              </Suspense>
              {/* Suspense-wrapped: MobileNav reads usePathname(), which is
                  dynamic on param routes (e.g. /companies/[id]). Without a
                  boundary, cacheComponents fails the prerender there. */}
              <Suspense fallback={<div className="h-7 w-7 sm:hidden" />}>
                <MobileNav />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
        <footer className="mx-auto mt-16 max-w-5xl border-t border-[var(--color-border)] px-6 py-8 text-xs text-[var(--color-muted)]">
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/about" className="hover:text-[var(--color-ink)]">How it works</Link>
            <Link href="/stats" className="hover:text-[var(--color-ink)]">Stats</Link>
            <Link href="/search" className="hover:text-[var(--color-ink)]">Browse grants</Link>
            <Link href="/pass" className="hover:text-[var(--color-ink)]">Pricing</Link>
            <Link href="/login" className="hover:text-[var(--color-ink)]">Log in</Link>
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
      className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-[var(--color-warm-bg)] hover:text-[var(--color-ink)]"
    >
      {children}
    </Link>
  );
}
