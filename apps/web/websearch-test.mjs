import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const env = {};
for (const line of readFileSync(".env.local","utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,"").trim();
}
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const query = "anomaly detection in IoT";
const RESULT_SHAPE = `{"companies":[{"name":<string>,"location":<string|null>,"whatTheyDo":<string>,"sourceUrl":<string>,"sourceTitle":<string|null>}]}`;
const system =
  `You find real, currently-operating Canadian companies working on a given topic, using web search. ` +
  `Rules: name SPECIFIC companies, not directories, listicles, or aggregators. ` +
  `Only include companies with a clear Canadian presence (HQ or office). ` +
  `For each company, record what they do in one sentence and the source URL you found it on. ` +
  `Aim for 5-10 strong matches. When finished searching, reply with ONLY a JSON object of this exact shape and no other text: ${RESULT_SHAPE}`;

const tools = [{
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
  user_location: { type: "approximate", city: "Toronto", region: "Ontario", country: "CA", timezone: "America/Toronto" },
}];

const messages = [{ role: "user", content: `Find Canadian companies working on: ${query}` }];

try {
  let message = null;
  for (let i = 0; i <= 3; i++) {
    console.log(`[turn ${i}] calling claude-sonnet-4-6 with web_search…`);
    message = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 4096, system, messages, tools });
    console.log(`  stop_reason=${message.stop_reason}  web_search_requests=${message.usage?.server_tool_use?.web_search_requests ?? 0}`);
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }
  const text = message.content.filter(b => b.type === "text").map(b => b.text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  let companies = [];
  if (start !== -1 && end > start) { try { companies = (JSON.parse(text.slice(start,end+1)).companies)||[]; } catch {} }
  console.log(`\n=== PARSED ${companies.length} COMPANIES ===`);
  for (const c of companies) console.log(` • ${c.name} (${c.location||"?"}) — ${c.whatTheyDo}\n     ${c.sourceUrl}`);
  console.log(`\nfinal usage:`, JSON.stringify(message.usage));
} catch (e) {
  console.log("\n!!! ERROR:", e?.status || "", e?.message || e);
  if (e?.error) console.log(JSON.stringify(e.error));
}
