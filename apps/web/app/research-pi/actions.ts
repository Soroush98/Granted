"use server";

import { findBySpikes, type FindState } from "@/lib/njf/find";

const MAX_CHARS = 6000;

export async function findResearchPiAction(_prev: FindState, formData: FormData): Promise<FindState> {
  const background = String(formData.get("bg") ?? "").trim();
  if (background.length < 10) {
    return { status: "error", message: "Tell us your clinical or research focus (e.g. \"cardiology, heart-failure imaging\"), or paste your CV." };
  }

  // `mode: "pi"` keeps only PI-held lab grants (any research funder — CIHR,
  // NSERC, FRQS…) — the labs whose lead is funded to host an incoming researcher.
  const spikes = await findBySpikes(background.slice(0, MAX_CHARS), { mode: "pi" });
  if (spikes.length === 0) {
    return { status: "error", message: "Couldn't read a research focus from that text. Add the specific clinical areas, methods, or conditions you work on, then try again." };
  }

  return { status: "ok", background, spikes };
}
