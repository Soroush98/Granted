"use server";

import { findBySpikes, type FindState } from "@/lib/njf/find";

const MAX_CHARS = 6000;

export async function findJobsAction(_prev: FindState, formData: FormData): Promise<FindState> {
  const background = String(formData.get("bg") ?? "").trim();
  if (background.length < 10) {
    return { status: "error", message: "Tell us a bit about your background — your field, projects, or skills." };
  }

  const spikes = await findBySpikes(background.slice(0, MAX_CHARS), "company");
  if (spikes.length === 0) {
    return { status: "error", message: "Couldn't read distinctive strengths from that text. Add concrete projects, methods, and tools, then try again." };
  }

  return { status: "ok", background, spikes };
}
