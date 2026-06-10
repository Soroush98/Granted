"use server";

import { findBySpikes, type Country, type FindState } from "@/lib/njf/find";
import { consumeSearchQuota, logSearch, quotaMessage } from "@/lib/njf/usage";
import { verifyTurnstile } from "@/lib/turnstile";

const MAX_CHARS = 6000;
const TURNSTILE_FAIL = "Please complete the verification challenge, then try again.";

export async function findResearchPiAction(_prev: FindState, formData: FormData): Promise<FindState> {
  const background = String(formData.get("bg") ?? "").trim();
  if (background.length < 10) {
    return { status: "error", message: "Tell us your clinical or research focus (e.g. \"cardiology, heart-failure imaging\"), or paste your CV." };
  }

  const raw = String(formData.get("country") ?? "CA");
  const country: Country = raw === "AU" || raw === "both" ? raw : "CA";

  const token = String(formData.get("cf-turnstile-response") ?? "").trim() || null;
  if (!(await verifyTurnstile(token))) {
    return { status: "error", message: TURNSTILE_FAIL };
  }

  const limit = await consumeSearchQuota();
  if (!limit.ok) {
    return { status: "error", message: quotaMessage(limit) };
  }

  // `mode: "pi"` keeps only PI-held lab grants (any research funder — CIHR,
  // NSERC, FRQS, ARC…) — the labs whose lead is funded to host an incoming
  // researcher. `country` scopes results to Canada, Australia, or both.
  const query = background.slice(0, MAX_CHARS);
  const spikes = await findBySpikes(query, { mode: "pi", country });
  if (spikes.length === 0) {
    return { status: "error", message: "Couldn't read a research focus from that text. Add the specific clinical areas, methods, or conditions you work on, then try again." };
  }

  logSearch({
    query,
    orgFilter: `pi:${country}`,
    resultCount: spikes.reduce((n, s) => n + s.matches.length, 0),
    ip: limit.ip,
  });

  return { status: "ok", background, spikes };
}
