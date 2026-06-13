import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";

export const metadata: Metadata = {
  title: "Find a funded research PI in Canada, the US, the UK or Australia — Granted",
  description:
    "Internationally trained researchers and physicians: describe your clinical or research focus and find principal investigators in Canada, the United States, the United Kingdom and Australia with active research funding (CIHR, NSERC, NIH, NSF, UKRI, ARC…) — the labs positioned to host you.",
};

export default function ResearchPiPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Find a <span className="text-gradient">funded research PI</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
          Relocating for research? Describe your clinical or research focus and we&rsquo;ll find
          principal investigators in{" "}
          <span className="font-medium text-[var(--color-ink)]">
            Canada, the US, the UK and Australia
          </span>{" "}
          with active research funding (CIHR, NSERC, NIH, NSF, UKRI, ARC…) in that exact area.
          Each match names the PI and shows the grant — your concrete reason to reach out.
        </p>
      </header>
      <SpikeFinder
        kind="research-pi"
        countrySelect
        webSearchOption
        copy={{
          placeholder: "e.g. interventional cardiology, heart-failure imaging, post-MI remodelling… (or paste your CV)",
          ctaIdle: "Find PIs",
          ctaBusy: "Finding funded labs…",
          searched: "research labs & PIs",
          holderLabel: "Principal investigator",
          examples: [
            "Interventional cardiology — heart-failure imaging, post-MI remodelling",
            "Pediatric oncology: immunotherapy response biomarkers",
            "Public health: infectious disease modelling and surveillance",
          ],
        }}
      />
    </section>
  );
}
