import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// Web company finder backed by Claude's server-side web_search tool. This is a
// DIFFERENT cost/quality profile from the grant-DB search: each run spends
// $0.01 per web search (capped below) PLUS input tokens for fetched pages, so
// it must be quota-gated and counted heavily wherever it's exposed.
//
// Pinned to Sonnet 4.6: the app's default model (env.ANTHROPIC_MODEL) is Haiku
// for the cheap rerank/spike steps, but web-search dynamic filtering needs
// Sonnet 4.6 / Opus 4.6+ — Haiku can't do it.
//
// Prereq: your org admin must enable web search in the Claude Console
// (Settings → Privacy), or every call errors.

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SEARCH_MODEL = "claude-sonnet-4-6";
const MAX_WEB_SEARCHES = 5; // hard ceiling on $0.01/search server-tool cost per run
const MAX_RESUMES = 3; // pause_turn resume cap (server-side tool loop)

export type Country = "CA" | "AU" | "US" | "UK";

export type WebCompany = {
  name: string;
  location: string | null;
  whatTheyDo: string;
  /** Recent funding/traction event in the niche (e.g. "Raised $5M seed for IoT
   * anomaly detection, Mar 2025") — the reason-to-reach-out hook, mirroring the
   * grant shown on grant-DB matches. null when no signal was found (Tier 2). */
  signal: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
};

const LOCATIONS: Record<Country, { adj: string; loc: Anthropic.Messages.WebSearchTool20250305.UserLocation }> = {
  CA: {
    adj: "Canadian",
    loc: { type: "approximate", city: "Toronto", region: "Ontario", country: "CA", timezone: "America/Toronto" },
  },
  AU: {
    adj: "Australian",
    loc: { type: "approximate", city: "Sydney", region: "New South Wales", country: "AU", timezone: "Australia/Sydney" },
  },
  US: {
    adj: "American",
    loc: { type: "approximate", city: "Boston", region: "Massachusetts", country: "US", timezone: "America/New_York" },
  },
  UK: {
    adj: "British",
    loc: { type: "approximate", city: "London", region: "England", country: "GB", timezone: "Europe/London" },
  },
};

// Citations are always on for web search, which is INCOMPATIBLE with
// output_config.format — so we can't use strict JSON schema here. Instead we
// ask for a fenced JSON object and parse it leniently.
const RESULT_SHAPE =
  `{"companies":[{"name":<string>,"location":<string|null>,"whatTheyDo":<string>,` +
  `"signal":<string|null>,"sourceUrl":<string>,"sourceTitle":<string|null>}]}`;

/**
 * Find real companies (in `country`) actively working on `query`, via live web
 * search. Returns a deduped list with the source URL each was found on. Best-
 * effort: returns [] rather than throwing on a parse miss or empty result.
 */
export async function webSearchCompanies(
  query: string,
  opts: { country?: Country; onSearch?: (q: string) => void } = {},
): Promise<WebCompany[]> {
  const country = opts.country ?? "CA";
  const { adj, loc } = LOCATIONS[country];

  const system =
    `You find ${adj} companies a job-seeker should contact about working on a given topic, using web search. ` +
    `PRIORITIZE companies with a RECENT, CONCRETE traction signal in this exact area — raised funding ` +
    `(pre-seed/seed/Series A/B), won a research grant, landed a major contract, or announced expansion/hiring. ` +
    `That signal is the point: it means the company has budget and is growing in the niche, giving a real reason to reach out. ` +
    `Rules: name SPECIFIC companies with a clear ${adj} presence (HQ or office). ` +
    `Strongly prefer credible primary sources — funding announcements, press releases, the company's own site, reputable tech press ` +
    `(e.g. BetaKit, TechCrunch) — over generic "top N startups" listicles, directories, or aggregators. ` +
    `For each company capture: what they do (one sentence); the traction signal with a rough date if known, set to null ONLY if you ` +
    `genuinely could not find one; and the source URL. ` +
    `Return up to 8 companies, signal-bearing ones first. Prefer 4 companies with real signals over 10 generic ones. ` +
    `When finished searching, reply with ONLY a JSON object of this exact shape and no other text: ${RESULT_SHAPE}`;

  const text = await runWebSearch(system, `Find ${adj} companies working on: ${query}`, loc, opts.onSearch);
  return parseCompanies(text);
}

/**
 * Shared driver for a single web-search turn: streams the model (surfacing each
 * web_search query live via `onSearch`), follows the server-tool `pause_turn`
 * resume loop, and returns the final assistant text. Returns "" if the model
 * produced no message. Hard 50s timeout, no retry — a retry would exceed the
 * route's maxDuration, so callers fall back to grant-only results on failure.
 */
async function runWebSearch(
  system: string,
  userText: string,
  loc: Anthropic.Messages.WebSearchTool20250305.UserLocation,
  onSearch?: (q: string) => void,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];

  // Basic web search (web_search_20250305). NOT the _20260209 dynamic-filtering
  // version: that needs the code-execution tool enabled at the org level, and
  // without it the request hangs for minutes (verified in a live test). The
  // basic tool returns in ~25s with good results.
  const tools = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: MAX_WEB_SEARCHES,
      user_location: loc,
    },
  ] as unknown as Anthropic.MessageCreateParams["tools"];

  let message: Anthropic.Message | null = null;
  for (let i = 0; i <= MAX_RESUMES; i++) {
    const stream = client.messages.stream(
      { model: SEARCH_MODEL, max_tokens: 4096, system, messages, tools },
      { timeout: 50_000, maxRetries: 0 },
    );

    if (onSearch) {
      const partial = new Map<number, string>(); // index → accumulating input JSON
      stream.on("streamEvent", (event) => {
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "server_tool_use" &&
          event.content_block.name === "web_search"
        ) {
          partial.set(event.index, "");
        } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          const cur = partial.get(event.index);
          if (cur !== undefined) partial.set(event.index, cur + event.delta.partial_json);
        } else if (event.type === "content_block_stop" && partial.has(event.index)) {
          const buf = partial.get(event.index)!;
          partial.delete(event.index);
          try {
            const q = (JSON.parse(buf) as { query?: unknown }).query;
            if (typeof q === "string" && q.trim()) onSearch(q.trim());
          } catch {
            /* incomplete/non-JSON input — skip */
          }
        }
      });
    }

    message = await stream.finalMessage();
    // Server-side tool loop hit its per-response iteration cap — resume by
    // echoing the assistant turn back (no extra "continue" message needed).
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }
  if (!message) return "";

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function parseCompanies(text: string): WebCompany[] {
  // The model may wrap the JSON in prose or a ```json fence — extract the
  // outermost {...} and parse that.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { companies?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.companies)) return [];

  const seen = new Set<string>();
  const out: WebCompany[] = [];
  for (const raw of parsed.companies) {
    const c = raw as Partial<WebCompany>;
    if (!c || typeof c.name !== "string" || typeof c.sourceUrl !== "string") continue;
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: c.name.trim(),
      location: typeof c.location === "string" ? c.location : null,
      whatTheyDo: typeof c.whatTheyDo === "string" ? c.whatTheyDo : "",
      signal: typeof c.signal === "string" && c.signal.trim() ? c.signal.trim() : null,
      sourceUrl: c.sourceUrl,
      sourceTitle: typeof c.sourceTitle === "string" ? c.sourceTitle : null,
    });
  }
  // Signal-bearing companies (Tier 1) first; stable sort preserves order within
  // each tier.
  return out.sort((a, b) => (a.signal ? 0 : 1) - (b.signal ? 0 : 1));
}

// ---------------------------------------------------------------------------
// Research-PI / lab variant — used by /research-pi. Same cost/quality profile
// as the company search, but hunts for university/institute/hospital labs and
// principal investigators an incoming researcher could join. The differentiator
// vs. the grant DB is the OPENNESS signal (a lab advertising it's recruiting),
// which no structured grant source captures.
// ---------------------------------------------------------------------------

export type WebLab = {
  /** PI name or lab name. */
  name: string;
  institution: string | null;
  /** What the lab works on, one sentence. */
  focus: string;
  /** Openness/recency hook: "recruiting a postdoc in X (Apr 2026)", a new grant,
   * a notable recent paper. null when none was found (Tier 2). */
  signal: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
};

const LAB_RESULT_SHAPE =
  `{"labs":[{"name":<string>,"institution":<string|null>,"focus":<string>,` +
  `"signal":<string|null>,"sourceUrl":<string>,"sourceTitle":<string|null>}]}`;

/**
 * Find real ${country} research labs / PIs an incoming researcher should contact
 * about joining, via live web search. Prioritizes a recruiting / recent-funding
 * / recent-paper signal — the thing grant data can't show. Best-effort: returns
 * [] rather than throwing on a parse miss or empty result.
 */
export async function webSearchLabs(
  query: string,
  opts: { country?: Country; onSearch?: (q: string) => void } = {},
): Promise<WebLab[]> {
  const country = opts.country ?? "CA";
  const { adj, loc } = LOCATIONS[country];

  const system =
    `You find ${adj} university, research-institute, or hospital labs and principal investigators (PIs) ` +
    `an incoming researcher should contact about joining, using web search. ` +
    `PRIORITIZE labs/PIs with a RECENT, CONCRETE openness signal in this exact area — a lab or department page ` +
    `advertising that they are recruiting a postdoc / PhD student / research staff, a newly awarded grant, a new ` +
    `faculty hire or lab launch, or a notable recent paper. That signal is the point: it means the lab is active and ` +
    `may have a position, giving a real reason to reach out. ` +
    `Rules: name SPECIFIC PIs or labs with a clear ${adj} affiliation (named university / institute / hospital). ` +
    `Strongly prefer credible primary sources — the lab's or PI's own page, the university directory, the funder's ` +
    `grant announcement, Google Scholar, PubMed — over generic "top labs" listicles, rankings, or aggregators. ` +
    `For each capture: the PI or lab name; the institution; what they work on (one sentence); the openness signal ` +
    `with a rough date if known, set to null ONLY if you genuinely could not find one; and the source URL. ` +
    `Return up to 8, signal-bearing ones first. Prefer 4 with real signals over 10 generic ones. ` +
    `When finished searching, reply with ONLY a JSON object of this exact shape and no other text: ${LAB_RESULT_SHAPE}`;

  const text = await runWebSearch(
    system,
    `Find ${adj} research labs / principal investigators working on: ${query}`,
    loc,
    opts.onSearch,
  );
  return parseLabs(text);
}

function parseLabs(text: string): WebLab[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: { labs?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.labs)) return [];

  const seen = new Set<string>();
  const out: WebLab[] = [];
  for (const raw of parsed.labs) {
    const l = raw as Partial<WebLab>;
    if (!l || typeof l.name !== "string" || typeof l.sourceUrl !== "string") continue;
    const key = l.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: l.name.trim(),
      institution: typeof l.institution === "string" ? l.institution : null,
      focus: typeof l.focus === "string" ? l.focus : "",
      signal: typeof l.signal === "string" && l.signal.trim() ? l.signal.trim() : null,
      sourceUrl: l.sourceUrl,
      sourceTitle: typeof l.sourceTitle === "string" ? l.sourceTitle : null,
    });
  }
  return out.sort((a, b) => (a.signal ? 0 : 1) - (b.signal ? 0 : 1));
}
