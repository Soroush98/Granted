import { findBySpikes, type Country, type FindState, type WebResults } from "@/lib/njf/find";
import { consumeSearchQuota, consumeWebQuota, logSearch, quotaMessage } from "@/lib/njf/usage";
import { verifyTurnstile } from "@/lib/turnstile";
import { webSearchCompanies } from "@/lib/ai/websearch";

// Streaming finder endpoint shared by /jobs, /supervisors, /research-pi. Emits
// newline-delimited JSON: {t:"phase",...} as each real pipeline stage starts,
// then exactly one {t:"result"} or {t:"error"}. The grant search + optional web
// pass can run ~30s+, so the route gets the long maxDuration (was on the page's
// server action before streaming).
export const maxDuration = 60;

type Kind = "jobs" | "supervisors" | "research-pi";

const CFG: Record<
  Kind,
  {
    noun: string;
    orgFilter: "company" | "university" | null;
    mode: "pi" | null;
    shortMsg: string;
    zeroMsg: string;
    logFilter: (c: Country) => string;
    allowWeb: boolean;
  }
> = {
  jobs: {
    noun: "Canadian companies",
    orgFilter: "company",
    mode: null,
    shortMsg: "Tell us a bit about your background — your field, projects, or skills.",
    zeroMsg:
      "Couldn't read distinctive strengths from that text. Add concrete projects, methods, and tools, then try again.",
    logFilter: () => "company",
    allowWeb: true,
  },
  supervisors: {
    noun: "universities & labs",
    orgFilter: "university",
    mode: null,
    shortMsg:
      'Tell us the research area or background you want a supervisor in (e.g. "neuroradiology, brain MRI segmentation").',
    zeroMsg:
      "Couldn't read a research focus from that text. Add the specific topics or methods you care about, then try again.",
    logFilter: () => "university",
    allowWeb: false,
  },
  "research-pi": {
    noun: "funded labs",
    orgFilter: null,
    mode: "pi",
    shortMsg:
      'Tell us your clinical or research focus (e.g. "cardiology, heart-failure imaging"), or paste your CV.',
    zeroMsg:
      "Couldn't read a research focus from that text. Add the specific clinical areas, methods, or conditions you work on, then try again.",
    logFilter: (c) => `pi:${c}`,
    allowWeb: false,
  },
};

const MAX_CHARS = 6000;
const TURNSTILE_FAIL = "Please complete the verification challenge, then try again.";
const enc = new TextEncoder();

export async function POST(req: Request) {
  const form = await req.formData();
  const kind = String(form.get("kind") ?? "") as Kind;
  const cfg = CFG[kind];
  const background = String(form.get("bg") ?? "").trim();
  const rawCountry = String(form.get("country") ?? "CA");
  const country: Country = rawCountry === "AU" || rawCountry === "both" ? rawCountry : "CA";
  const wantWeb = form.get("web") === "1" && !!cfg?.allowWeb;
  const token = String(form.get("cf-turnstile-response") ?? "").trim() || null;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client disconnected */
        }
      };
      const fail = (message: string) => {
        emit({ t: "error", message });
        controller.close();
      };

      if (!cfg) return fail("Unknown search.");
      if (background.length < 10) return fail(cfg.shortMsg);
      if (!(await verifyTurnstile(token))) return fail(TURNSTILE_FAIL);

      const limit = await consumeSearchQuota();
      if (!limit.ok) return fail(quotaMessage(limit));

      const query = background.slice(0, MAX_CHARS);
      emit({ t: "phase", key: "extract", label: "Finding your distinctive strengths" });

      const spikes = await findBySpikes(query, {
        orgFilter: cfg.orgFilter,
        mode: cfg.mode,
        country,
        onPhase: (p) => {
          if (p.key === "spikes") {
            emit({
              t: "phase",
              key: "search",
              label: `Searching ${cfg.noun}`,
              detail: p.labels.join(" · "),
            });
          }
        },
      });

      if (spikes.length === 0) return fail(cfg.zeroMsg);

      logSearch({
        query,
        orgFilter: cfg.logFilter(country),
        resultCount: spikes.reduce((n, s) => n + s.matches.length, 0),
        ip: limit.ip,
      });

      let web: WebResults | undefined;
      if (wantWeb) {
        if (await consumeWebQuota(limit.ip)) {
          emit({ t: "phase", key: "web", label: "Searching the web for funded companies" });
          try {
            const companies = await webSearchCompanies(query, { country: country === "AU" ? "AU" : "CA" });
            emit({ t: "phase", key: "signals", label: "Checking funding signals" });
            web = { companies };
          } catch (e) {
            console.error("[websearch] failed:", e);
            web = { companies: [], note: "Web search is temporarily unavailable — showing grant matches only." };
          }
        } else {
          web = { companies: [], note: "Daily web-search limit reached — showing grant matches only." };
        }
      }

      const state: FindState = { status: "ok", background, spikes, web };
      emit({ t: "result", state });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Disable proxy buffering so phase events flush immediately.
      "x-accel-buffering": "no",
    },
  });
}
