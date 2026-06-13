import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";

export const metadata: Metadata = {
  title: "Find a research supervisor — Granted",
  description:
    "Describe your research interests. Granted finds university labs in Canada, the US, the UK and Australia funded in that exact area, so you can find a supervisor and reach out with a concrete reason.",
};

export default function SupervisorsPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Find a <span className="text-gradient">research supervisor</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
          Describe the research you want to do, or paste a fuller background. We find university
          labs <span className="font-medium text-[var(--color-ink)]">funded</span>{" "}
          to work in that exact area, with the grant that proves it — so you can approach a
          supervisor with a real reason.
        </p>
      </header>
      <SpikeFinder
        kind="supervisors"
        countrySelect
        copy={{
          placeholder: "e.g. neuroradiology, brain tumour MRI segmentation, functional connectivity… (or paste a fuller background)",
          ctaIdle: "Find supervisors",
          ctaBusy: "Finding labs…",
          searched: "university labs",
          holderLabel: "Supervisor",
          examples: [
            "Neuroradiology — brain tumour MRI segmentation, deep learning",
            "Sustainable concrete: supplementary cementitious materials, CO2 curing",
            "Wireless networks: reinforcement learning for resource allocation in 6G",
          ],
        }}
      />
    </section>
  );
}
