// Coverage audit: which genuinely text-to-SQL-relevant grants in the DB does
// the search retrieve (top-25 cap) for "text to sql related research"?
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
const env = {};
for (const line of envText.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); }
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

// 1) embed the query exactly as the app would
const cleaned = "text sql related research";
const er = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.VOYAGE_API_KEY}` }, body: JSON.stringify({ input: [cleaned], model: "voyage-3.5", input_type: "query" }) });
const embedding = (await er.json()).data[0].embedding;

// 2) retrieve at the real cap (25) AND at a deep cap (200) to see what's beyond the cliff
async function retrieve(n) {
  const rr = await fetch(`${URL}/rest/v1/rpc/search_companies`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ query_embedding: embedding, query_text: cleaned, match_count: n, org_filter: null, province_filter: null, program_codes: null, min_start_date: null, max_start_date: null, min_amount: null, max_amount: null }) });
  return rr.json();
}
const top25 = await retrieve(25);
const deep = await retrieve(200);
const rankOf = new Map(deep.map((h, i) => [h.company_id, i + 1]));
const top25ids = new Set(top25.map(h => h.company_id));

// 3) ground-truth: companies with genuinely NL->query / text-to-SQL relevant grants
//    (hand-picked from the chunk scan)
const GT = {
  "d3560c0f": "NL Interfaces to Databases + LLM query generation (THE text-to-SQL grant)",
  "8b10b147": "AI Assist: natural language query pilot",
  "5beccfad": "Graph-based Natural Language Querying of bio knowledge DBs (KibioAI)",
  "4295b5ac": "AI-powered data structuring/reporting/querying system",
  "08a996a2": "Semantic Parsing for Knowledge-Graph Question Answering",
  "29c12b88": "Query evaluation / answers specified in SQL (DB systems)",
  "522d8a26": "DBMS sophisticated analytics",
  "53a37751": "Question answering over web/search",
  "fa7895ab": "Data science insights from data",
};
// resolve 8-char prefixes -> full UUIDs via the earlier ground-truth dump
const gtRows = JSON.parse(readFileSync("/tmp/gt.json", "utf8"));
const prefixToFull = {};
for (const r of gtRows) prefixToFull[r.company_id.slice(0, 8)] = r.company_id;
const ids = Object.keys(GT).map(p => prefixToFull[p]).filter(Boolean);
const cr = await fetch(`${URL}/rest/v1/companies?select=id,display_name,org_type&id=in.(${ids.join(",")})`, { headers: H });
const names = new Map((await cr.json()).map(c => [c.id, c]));

console.log(`Query: "text to sql related research"  | retrieval cap match_count=25\n`);
console.log("GROUND-TRUTH RELEVANT GRANTS  →  retrieved?");
console.log("=".repeat(78));
for (const prefix of Object.keys(GT)) {
  const id = prefixToFull[prefix];
  if (!id) { console.log(`?? ${prefix} — not found in gt dump`); console.log(`   ${GT[prefix]}`); continue; }
  const c = names.get(id) || {};
  const inTop25 = top25ids.has(id);
  const deepRank = rankOf.get(id);
  const status = inTop25 ? `✓ RETRIEVED  (rank ${deepRank})` : (deepRank ? `✗ MISSED — ranks ${deepRank}, beyond cap of 25` : `✗ MISSED — not in top 200`);
  console.log(`${status}`);
  console.log(`   ${(c.display_name||id)} [${c.org_type||"?"}] — ${GT[prefix]}`);
}
