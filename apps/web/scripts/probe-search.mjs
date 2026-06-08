// Faithful replica of the /search pipeline for one query, for coverage analysis.
// Mirrors lib/rag/prepare-query.ts + lib/rag/search.ts (retrieval + Claude rerank).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const QUERY = process.argv.slice(2).join(" ") || "text to sql related research";
const TARGET_GRANT = "7a18efe0"; // the NL-interfaces-to-DB / text-to-SQL grant prefix

// ---- prepare-query.ts (cleanGoal, no filters) ----
const FILLER = new Set(["a","an","the","any","some","all","in","of","from","for","to","at","with","by","on","and","or","but","i","me","my","we","our","you","your","doing","do","looking","look","find","show","see","give","labs","lab","place","places","that","which","who","is","are","was","were","be","been"]);
const ABBR = { ml:"machine learning", ai:"artificial intelligence", nlp:"natural language processing", cv:"computer vision", llm:"large language model", llms:"large language models" };
const tokens = QUERY.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const cleaned = tokens.filter(t => !FILLER.has(t)).map(t => ABBR[t] ?? t).join(" ") || QUERY;
const embedText = cleaned, ftsText = cleaned;
console.log(`QUERY: "${QUERY}"`);
console.log(`embedText/ftsText sent: "${cleaned}"\n`);

// ---- embed (Voyage, input_type=query) ----
const er = await fetch("https://api.voyageai.com/v1/embeddings", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${env.VOYAGE_API_KEY}` },
  body: JSON.stringify({ input: [embedText], model: env.VOYAGE_EMBED_MODEL || "voyage-3.5", input_type: "query" }),
});
if (!er.ok) { console.error("Voyage failed", er.status, await er.text()); process.exit(1); }
const embedding = (await er.json()).data[0].embedding;

// ---- search_companies RPC (match_count=25, no filters) ----
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const rr = await fetch(`${URL}/rest/v1/rpc/search_companies`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    query_embedding: embedding, query_text: ftsText, match_count: 25,
    org_filter: process.env.ORG || null, province_filter: null, program_codes: null,
    min_start_date: null, max_start_date: null, min_amount: null, max_amount: null,
  }),
});
if (!rr.ok) { console.error("RPC failed", rr.status, await rr.text()); process.exit(1); }
const hits = await rr.json();
console.log(`RPC returned ${hits.length} candidate companies (match_count=25).\n`);

// fetch company names
const ids = hits.map(h => h.company_id);
const cr = await fetch(`${URL}/rest/v1/companies?select=id,display_name,org_type,province&id=in.(${ids.join(",")})`, {
  headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
});
const companies = await cr.json();
const byId = new Map(companies.map(c => [c.id, c]));

console.log("=== RETRIEVED CANDIDATES (raw hybrid order) ===");
let targetRank = -1;
hits.forEach((h, i) => {
  const c = byId.get(h.company_id) || {};
  const isTarget = (h.best_grant_id || "").startsWith(TARGET_GRANT);
  if (isTarget) targetRank = i + 1;
  const flag = isTarget ? "  <<< TARGET text-to-SQL grant" : "";
  console.log(
    `${String(i + 1).padStart(2)}. ${(c.display_name || h.company_id).slice(0, 50).padEnd(50)} ` +
    `[${c.org_type || "?"}] hyb=${h.hybrid_score?.toFixed(3)} vec=${h.vector_score?.toFixed(3)} fts=${h.fts_score?.toFixed(3)}${flag}`
  );
  console.log(`     chunk: ${(h.best_chunk || "").slice(0, 220).replace(/\s+/g, " ")}`);
});
console.log(`\nTARGET text-to-SQL grant (${TARGET_GRANT}) retrieved at rank: ${targetRank > 0 ? targetRank : "NOT IN TOP 25"}`);
console.log(`Reaches Claude rerank (top 10)? ${targetRank > 0 && targetRank <= 10 ? "YES" : "NO"}`);
console.log(`Shown in default top-5 "matches"? depends on rerank below.\n`);

// ---- Claude rerank top 10 (mirrors rerankLocally) ----
const pool = hits.slice(0, 10);
const system = `You are a ranking function. Rank Canadian organizations by how well their federally-funded R&D work matches the user's intent.
You receive a <user_query> and candidate organizations each with a funded-R&D <chunk>.
Output ONLY JSON: {"ranked":[{"id":"<verbatim id>","score":0.0,"rationale":"one short sentence"}]} ordered best→worst, every candidate once.`;
const userMsg = [
  `<user_query>\n${QUERY}\n</user_query>`,
  `\nORGANIZATIONS (rank these):\n`,
  ...pool.map((h, i) => {
    const c = byId.get(h.company_id) || {};
    return `--- [${i}] id=${h.company_id}\nName: ${c.display_name}\n<chunk>${(h.best_chunk || "").slice(0, 300)}</chunk>`;
  }),
].join("\n");

const SCHEMA = { type:"object", additionalProperties:false, properties:{ ranked:{ type:"array", items:{ type:"object", additionalProperties:false, properties:{ id:{type:"string"}, score:{type:"number"}, rationale:{type:"string"} }, required:["id","score","rationale"] } } }, required:["ranked"] };
const model = env.ANTHROPIC_MODEL;
const supportsEffort = !model.includes("haiku") && !model.startsWith("claude-sonnet-4-5");
const outputConfig = {};
if (supportsEffort) outputConfig.effort = "low";
outputConfig.format = { type: "json_schema", schema: SCHEMA };

const ar = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model, max_tokens: 4096, output_config: outputConfig, system, messages: [{ role: "user", content: userMsg }] }),
});
if (!ar.ok) { console.error("\nClaude rerank failed", ar.status, (await ar.text()).slice(0, 400)); process.exit(0); }
const aj = await ar.json();
const text = (aj.content || []).filter(b => b.type === "text").map(b => b.text).join("");
let ranked;
try { ranked = JSON.parse(text).ranked; } catch { console.error("rerank parse fail:", text.slice(0,300)); process.exit(0); }

console.log("=== FINAL BOT ANSWER (Claude rerank → top 5 'matches') ===");
ranked.slice(0, 5).forEach((r, i) => {
  const c = byId.get(r.id) || {};
  const isTarget = pool.find(h => h.company_id === r.id && (h.best_grant_id||"").startsWith(TARGET_GRANT));
  console.log(`${i+1}. ${(c.display_name||r.id).slice(0,50)} [${c.org_type||"?"}] score=${r.score}${isTarget?"  <<< TARGET":""}`);
  console.log(`   ${r.rationale}`);
});
