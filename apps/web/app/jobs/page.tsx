import type { Metadata } from "next";
import { SpikeFinder } from "@/app/_components/spike-finder";

export const metadata: Metadata = {
  title: "Find companies doing your exact work — Granted",
  description:
    "Paste your background. Granted breaks it into your distinctive strengths and finds Canadian companies funded to do that work — including ones not advertising jobs.",
};

export default function JobsPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Find companies doing <span className="text-gradient">your exact work</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
          Paste your background. We break it into your most distinctive strengths and find Canadian
          companies <span className="font-medium text-[var(--color-ink)]">funded</span>{" "}
          to do that exact work — including ones that aren&rsquo;t posting jobs. Every match shows
          the real grant: your concrete reason to reach out.
        </p>
      </header>
      <SpikeFinder
        kind="jobs"
        webSearchOption
        copy={{
          placeholder: "Paste your resume text, or a few sentences about your background, projects, and tools…",
          ctaIdle: "Find companies",
          ctaBusy: "Finding companies…",
          searched: "Canadian companies",
          examples: [
            "Computer vision engineer — defect detection on manufacturing lines, PyTorch, edge deployment",
            "Battery materials researcher: lithium-ion cathodes, electrochemistry, pilot-scale production",
            "Backend developer focused on real-time data pipelines for IoT sensors",
          ],
        }}
      />
    </section>
  );
}
