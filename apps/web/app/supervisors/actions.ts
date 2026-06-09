"use server";

import { findBySpikes, type FindState } from "@/lib/njf/find";

const MAX_CHARS = 6000;

export async function findSupervisorsAction(_prev: FindState, formData: FormData): Promise<FindState> {
  const background = String(formData.get("bg") ?? "").trim();
  if (background.length < 10) {
    return { status: "error", message: "Tell us the research area or background you want a supervisor in (e.g. \"neuroradiology, brain MRI segmentation\")." };
  }

  const spikes = await findBySpikes(background.slice(0, MAX_CHARS), { orgFilter: "university" });
  if (spikes.length === 0) {
    return { status: "error", message: "Couldn't read a research focus from that text. Add the specific topics or methods you care about, then try again." };
  }

  return { status: "ok", background, spikes };
}
