import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";

export const metadata: Metadata = {
  title: "Find a research supervisor — Granted",
  description:
    "Describe your research interests. Granted finds Canadian university labs funded in that exact area, so you can find a supervisor and reach out with a concrete reason.",
};

export default function SupervisorsPage() {
  return (
    <section>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Find a research supervisor</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Describe the research you want to do — a topic like{" "}
          <span className="font-medium text-[var(--color-ink)]">&ldquo;neuroradiology, brain MRI segmentation&rdquo;</span>,
          or paste a fuller background. We find Canadian university labs{" "}
          <span className="font-medium text-[var(--color-ink)]">funded</span> to work in that exact area, with the
          grant that proves it — so you can approach a supervisor with a real reason.
        </p>
      </header>
      <SpikeFinder
        kind="supervisors"
        copy={{
          placeholder: "e.g. neuroradiology, brain tumour MRI segmentation, functional connectivity… (or paste a fuller background)",
          ctaIdle: "Find supervisors",
          ctaBusy: "Finding labs…",
          searched: "Canadian university labs",
          holderLabel: "Supervisor",
        }}
      />
    </section>
  );
}
