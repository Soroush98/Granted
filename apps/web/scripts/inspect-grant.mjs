// One-off: for a query, find the top university grants and dump the FULL grant
// record (title, description, source_url, raw JSON keys) to see whether the
// principal investigator / supervisor name is anywhere in our stored data.
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
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

const query = process.argv.slice(2).join(" ") || "neuroradiology brain MRI imaging";

const er = await fetch("https://api.voyageai.com/v1/embeddings", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${env.VOYAGE_API_KEY}` },
  body: JSON.stringify({ input: [query], model: env.VOYAGE_EMBED_MODEL || "voyage-3.5", input_type: "query" }),
});
const embedding = (await er.json()).data[0].embedding;

const rr = await fetch(`${URL}/rest/v1/rpc/search_companies`, {
  method: "POST", headers,
  body: JSON.stringify({
    query_embedding: embedding, query_text: query, match_count: 3,
    org_filter: "university", province_filter: null, program_codes: null,
    min_start_date: null, max_start_date: null, min_amount: null, max_amount: null,
  }),
});
const hits = await rr.json();

for (const h of hits) {
  if (!h.best_grant_id) continue;
  const gr = await fetch(`${URL}/rest/v1/grants?select=id,title,description,source_url,award_id,raw&id=eq.${h.best_grant_id}`, { headers });
  const [g] = await gr.json();
  if (!g) continue;
  console.log("\n==================================================");
  console.log("TITLE      :", g.title);
  console.log("DESCRIPTION:", (g.description || "").slice(0, 200));
  console.log("AWARD_ID   :", g.award_id);
  console.log("SOURCE_URL :", g.source_url);
  console.log("RAW keys   :", g.raw && typeof g.raw === "object" ? Object.keys(g.raw) : typeof g.raw);
  // Print any raw fields that look like they could hold a person's name
  if (g.raw && typeof g.raw === "object") {
    for (const [k, v] of Object.entries(g.raw)) {
      if (/name|investigator|applicant|recipient|researcher|pi|holder|nom|chercheur|author|lead/i.test(k)) {
        console.log(`  raw.${k} =`, typeof v === "string" ? v.slice(0, 120) : v);
      }
    }
  }
}
