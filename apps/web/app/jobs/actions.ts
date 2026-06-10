"use server";

import { findBySpikes, type FindState } from "@/lib/njf/find";
import { checkSearchLimit, logSearch, searchLimitMessage } from "@/lib/njf/usage";

const MAX_CHARS = 6000;

export async function findJobsAction(_prev: FindState, formData: FormData): Promise<FindState> {
  const background = String(formData.get("bg") ?? "").trim();
  if (background.length < 10) {
    return { status: "error", message: "Tell us a bit about your background — your field, projects, or skills." };
  }

  const limit = await checkSearchLimit();
  if (!limit.ok) {
    return { status: "error", message: searchLimitMessage(limit.used) };
  }

  const query = background.slice(0, MAX_CHARS);
  const spikes = await findBySpikes(query, { orgFilter: "company" });
  if (spikes.length === 0) {
    return { status: "error", message: "Couldn't read distinctive strengths from that text. Add concrete projects, methods, and tools, then try again." };
  }

  logSearch({
    query,
    orgFilter: "company",
    resultCount: spikes.reduce((n, s) => n + s.matches.length, 0),
    ip: limit.ip,
  });

  return { status: "ok", background, spikes };
}
