import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";
import { findResearchPiAction } from "./actions";

export const metadata: Metadata = {
  title: "Find a funded research PI in Canada or Australia — Granted",
  description:
    "Internationally trained researchers and physicians: describe your clinical or research focus and find principal investigators in Canada and Australia with active research funding (CIHR, NSERC, FRQS, ARC…) — the labs positioned to host you.",
};

export default function ResearchPiPage() {
  return (
    <section>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Find a funded research PI in Canada or Australia</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Relocating for research — finishing an MD, a PhD, or a postdoc abroad? Describe your
          clinical or research focus and we&rsquo;ll find principal investigators in{" "}
          <span className="font-medium text-[var(--color-ink)]">Canada and Australia</span> with{" "}
          <span className="font-medium text-[var(--color-ink)]">active research funding (CIHR, NSERC, FRQS, ARC…)</span>{" "}
          in that exact area. A funded lab is one that can take you on — and each match names the PI
          and shows the grant, so you can reach out with a concrete reason.
        </p>
      </header>
      <SpikeFinder
        action={findResearchPiAction}
        countrySelect
        copy={{
          placeholder: "e.g. interventional cardiology, heart-failure imaging, post-MI remodelling… (or paste your CV)",
          ctaIdle: "Find PIs",
          ctaBusy: "Finding funded labs…",
          searched: "research labs & PIs",
          holderLabel: "Principal investigator",
        }}
      />
    </section>
  );
}
