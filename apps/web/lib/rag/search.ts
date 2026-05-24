import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { supabaseAnon } from "@/lib/db/supabase-server";
import { embedQuery } from "@/lib/ai/embeddings";
import { chatJson } from "@/lib/ai/llm";
import { prepareEmbedQuery } from "@/lib/rag/prepare-query";
import type {
  Company,
  CompanyHit,
  SearchFilters,
} from "@/lib/db/types";

export type Match = CompanyHit & {
  company: Company;
  rerank_score?: number;
  rationale?: string;
};

/**
 * Embed the user's query (goal + optional resume), run hybrid search across
 * grant_chunks, then have the local LLM rerank the top 10 → top topK with a
 * short rationale per match.
 *
 * Cached via `"use cache"` — identical queries are free within the window.
 * The ingestion pipeline invalidates the `search` tag after each run.
 */
export async function searchCompanies(
  query: string,
  opts: SearchFilters & { topK?: number } = {},
): Promise<Match[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("search");

  const topK = opts.topK ?? 5;

  const supabase = supabaseAnon();
  // Embed a cleaned version of the query (filter words removed, abbreviations
  // expanded); pass the cleaned goal to FTS too so keyword search isn't
  // forced to AND every paper-body word against every grant chunk.
  // See lib/rag/prepare-query.ts for the rationale.
  const { embedText, ftsText } = prepareEmbedQuery(query, opts);
  const embedding = await embedQuery(embedText);

  const { data: hits, error } = await supabase.rpc("search_companies", {
    query_embedding: embedding,
    query_text: ftsText,
    match_count: 10,
    org_filter: opts.orgFilter ?? null,
    province_filter: opts.province ?? null,
    program_codes: opts.programCodes ?? null,
    min_start_date: opts.minStartDate ?? null,
    max_start_date: opts.maxStartDate ?? null,
    min_amount: opts.minAmount ?? null,
    max_amount: opts.maxAmount ?? null,
  });
  if (error) throw new Error(`search_companies RPC failed: ${error.message}`);
  if (!hits || hits.length === 0) return [];

  const companyIds = hits.map((h) => h.company_id);
  const { data: companies, error: cErr } = await supabase
    .from("companies")
    .select("*")
    .in("id", companyIds);
  if (cErr) throw new Error(`companies fetch failed: ${cErr.message}`);
  const byId = new Map(companies!.map((c) => [c.id, c as Company]));

  const candidates: Match[] = hits
    .map((h) => {
      const c = byId.get(h.company_id);
      return c ? { ...h, company: c } : null;
    })
    .filter((x): x is Match => x !== null);

  return rerankLocally(query, candidates, topK);
}

/** Local LLM rerank via Ollama. Strict JSON output. */
async function rerankLocally(query: string, candidates: Match[], topK: number): Promise<Match[]> {
  if (candidates.length === 0) return [];

  const system = `You rank Canadian organizations by how well their federally-funded R&D work matches the user's intent and background.

The user's query may be any of:
  - a job-seeker's goal + resume (find companies hiring in their field)
  - a researcher's goal + paper or thesis (find labs / academic groups with adjacent work, or industry partners doing applied research on the same topic)
  - a free-text project brief (find collaborators, suppliers, or competitors)

Honor any constraint the user states in prose — "companies only", "university labs", "in Quebec", "industry partners" — and weight those constraints heavily when ranking.

Output ONLY JSON of this exact shape, with no extra fields:
{"ranked":[{"id":"<copy id verbatim from input>","score":0.0,"rationale":"one short sentence naming the overlap"}]}

Rules:
- "id" MUST be copied EXACTLY from the "id=" line of each candidate (e.g. id=abc-123 → "id":"abc-123"). Never substitute numeric indices.
- "score" is a number 0..1: 1.0 = very strong match, 0.0 = unrelated.
- Order the array best → worst.
- Include every candidate exactly once.
- Do not invent extra JSON fields.`;

  const user = [
    `USER QUERY (goal + optional document):\n${query}\n`,
    `ORGANIZATIONS:`,
    ...candidates.map((c, i) => {
      const o = c.company;
      return [
        `--- [${i}] id=${o.id}`,
        `Name: ${o.display_name}${o.org_type !== "company" ? ` (${o.org_type})` : ""}`,
        o.province ? `Location: ${[o.city, o.province].filter(Boolean).join(", ")}` : "",
        o.sectors.length ? `Sectors: ${o.sectors.join(", ")}` : "",
        `Funded R&D excerpt: ${c.best_chunk.slice(0, 300)}`,
      ].filter(Boolean).join("\n");
    }),
  ].join("\n");

  type RerankShape = { ranked: Array<{ id: string; score: number; rationale: string }> };
  // Strict JSON schema — Claude's output_config.format enforces this shape
  // so we don't need defensive guards beyond the empty-array check below.
  const RERANK_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      ranked: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            score: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["id", "score", "rationale"],
        },
      },
    },
    required: ["ranked"],
  };

  let parsed: RerankShape;
  try {
    parsed = await chatJson<RerankShape>({ system, user, schema: RERANK_SCHEMA });
  } catch {
    return candidates.slice(0, topK);
  }
  if (!Array.isArray(parsed.ranked)) return candidates.slice(0, topK);

  const idIndex = new Map(candidates.map((c) => [c.company.id, c]));
  const ordered: Match[] = [];
  for (const r of parsed.ranked) {
    const c = idIndex.get(r.id);
    if (!c) continue;
    ordered.push({ ...c, rerank_score: r.score, rationale: r.rationale });
    if (ordered.length >= topK) break;
  }
  return ordered;
}
