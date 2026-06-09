import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";
import { findResearchPiAction } from "./actions";

export const metadata: Metadata = {
  title: "Find a funded research PI in Canada — Granted",
  description:
    "Internationally trained researchers and physicians: describe your clinical or research focus and find Canadian principal investigators with active research funding (CIHR, NSERC, FRQS…) — the labs positioned to host you.",
};

export default function ResearchPiPage() {
  return (
    <section>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Find a funded research PI in Canada</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Coming to Canada for research — finishing an MD, a PhD, or a postdoc abroad? Describe your
          clinical or research focus and we&rsquo;ll find Canadian principal investigators with{" "}
          <span className="font-medium text-[var(--color-ink)]">active research funding (CIHR, NSERC, FRQS…)</span>{" "}
          in that exact area. A funded lab is one that can take you on — and each match names the PI
          and shows the grant, so you can reach out with a concrete reason.
        </p>
      </header>
      <SpikeFinder
        action={findResearchPiAction}
        copy={{
          placeholder: "e.g. interventional cardiology, heart-failure imaging, post-MI remodelling… (or paste your CV)",
          ctaIdle: "Find PIs",
          ctaBusy: "Finding funded labs…",
          searched: "Canadian health-research labs & PIs",
          holderLabel: "Principal investigator",
        }}
      />
    </section>
  );
}
