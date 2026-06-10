"use server";

import { findBySpikes, type FindState } from "@/lib/njf/find";
import { consumeSearchQuota, logSearch, quotaMessage } from "@/lib/njf/usage";
import { verifyTurnstile } from "@/lib/turnstile";

const MAX_CHARS = 6000;
const TURNSTILE_FAIL = "Please complete the verification challenge, then try again.";

export async function findSupervisorsAction(_prev: FindState, formData: FormData): Promise<FindState> {
  const background = String(formData.get("bg") ?? "").trim();
  if (background.length < 10) {
    return { status: "error", message: "Tell us the research area or background you want a supervisor in (e.g. \"neuroradiology, brain MRI segmentation\")." };
  }

  const token = String(formData.get("cf-turnstile-response") ?? "").trim() || null;
  if (!(await verifyTurnstile(token))) {
    return { status: "error", message: TURNSTILE_FAIL };
  }

  const limit = await consumeSearchQuota();
  if (!limit.ok) {
    return { status: "error", message: quotaMessage(limit) };
  }

  const query = background.slice(0, MAX_CHARS);
  const spikes = await findBySpikes(query, { orgFilter: "university" });
  if (spikes.length === 0) {
    return { status: "error", message: "Couldn't read a research focus from that text. Add the specific topics or methods you care about, then try again." };
  }

  logSearch({
    query,
    orgFilter: "university",
    resultCount: spikes.reduce((n, s) => n + s.matches.length, 0),
    ip: limit.ip,
  });

  return { status: "ok", background, spikes };
}
