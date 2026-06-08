#!/usr/bin/env node
// Driver for the /api/crawl-people shard crawler.
//
// Walks a city × language × page grid against the deployed endpoint, which
// hydrates GitHub users into gh_people. The endpoint does the real work,
// self-paces against the GitHub core budget, and skips finished shards
// (gh_people_shards), so this driver just enumerates shards and honors the
// three response shapes it can return:
//
//   { skipped: true }              -> shard already crawled, move on
//   { paused, retryAfterSec }      -> core budget low; sleep and retry same page
//   { ...result, hasMore }         -> page done; stop the language when !hasMore
//
// Because the endpoint is idempotent and resumable, re-running this script
// after an interruption just fast-forwards over completed shards.
//
// Usage:
//   node scripts/crawl-people.mjs --base https://<prod-host> [options]
//
//   --base <url>     Deployed origin (or env CRAWL_BASE_URL). Required.
//   --secret <s>     REVALIDATE_SECRET (else read from apps/web/.env.local, else env).
//   --pages <n>      Max pages per (city,language). Default 5 (top ~500 by followers).
//   --cities a,b     Comma list to override the default 11.
//   --languages a,b  Comma list to override the default 12.
//   --map            After crawling, run mapping mode (?map=1) to link people to companies.
//   --map-only       Skip crawling; only run mapping.
//   --delay <ms>     Pause between page calls. Default 1500.
//   --dry            Print the shard plan and exit without calling anything.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- args ----
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && (i + 1 >= argv.length || argv[i + 1].startsWith("--"));
}
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}

const DEFAULT_CITIES = [
  "Vancouver", "Montreal", "Ottawa", "Calgary", "Victoria", "Waterloo",
  "Edmonton", "Québec", "Halifax", "Winnipeg", "Kitchener",
];
const DEFAULT_LANGUAGES = [
  "JavaScript", "Python", "TypeScript", "Java", "Go", "Rust",
  "C++", "C#", "Ruby", "Swift", "Kotlin", "PHP",
];

const cities = (opt("cities") ? opt("cities").split(",") : DEFAULT_CITIES).map((s) => s.trim()).filter(Boolean);
const languages = (opt("languages") ? opt("languages").split(",") : DEFAULT_LANGUAGES).map((s) => s.trim()).filter(Boolean);
const maxPages = Number(opt("pages", "5"));
const delayMs = Number(opt("delay", "1500"));
const doMap = flag("map") || flag("map-only");
const mapOnly = flag("map-only");
const dry = flag("dry");
const base = (opt("base") || process.env.CRAWL_BASE_URL || "").replace(/\/$/, "");
const secret = opt("secret") || readSecret();

function readSecret() {
  if (process.env.REVALIDATE_SECRET) return process.env.REVALIDATE_SECRET;
  try {
    const envFile = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
    const m = envFile.match(/^REVALIDATE_SECRET=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* ignore */
  }
  return "";
}

// ---- plan summary ----
const plan = [];
for (const city of cities) for (const language of languages) plan.push({ city, language });
console.log(
  `Plan: ${cities.length} cities × ${languages.length} languages = ${plan.length} shard-lines, ` +
    `up to ${maxPages} pages each (cap ${plan.length * maxPages} page-calls).`,
);
console.log(`Cities:    ${cities.join(", ")}`);
console.log(`Languages: ${languages.join(", ")}`);

if (dry) {
  console.log("\n--dry: no requests made.");
  process.exit(0);
}
if (!base) {
  console.error("\nERROR: --base <url> (or CRAWL_BASE_URL) is required, e.g. https://granted-web.vercel.app");
  process.exit(1);
}
if (!secret) {
  console.error("\nERROR: no REVALIDATE_SECRET found (pass --secret, set env, or keep it in apps/web/.env.local)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(params) {
  const u = new URL(`${base}/api/crawl-people`);
  u.searchParams.set("secret", secret);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { "user-agent": "granted-crawl-driver" } });
  const text = await res.text();
  // Fatal, non-retryable conditions — abort the whole run rather than spin.
  if (res.status === 401) throw new Fatal("401 unauthorized — REVALIDATE_SECRET mismatch");
  if (res.status === 404) {
    throw new Fatal(
      `404 — /api/crawl-people not found at ${base}. Is the route deployed to this host?`,
    );
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON response: ${text.slice(0, 200)}`);
  }
  return json;
}

// A fatal error stops the driver immediately (no per-page retry loop).
class Fatal extends Error {}

// ---- crawl ----
const stats = { pages: 0, skipped: 0, fetched: 0, paused: 0 };
const t0 = Date.now();

async function crawl() {
  for (const city of cities) {
    for (const language of languages) {
      for (let page = 1; page <= maxPages; page++) {
        let fails = 0; // consecutive transient failures on this page
        // Retry the same page while the endpoint is paused on the core budget.
        for (;;) {
          let r;
          try {
            r = await call({ city, language, page });
          } catch (e) {
            if (e instanceof Fatal) {
              console.error(`\nFATAL: ${e.message}`);
              process.exit(1);
            }
            // Transient (timeout / 5xx / network): retry the page a few times.
            fails++;
            console.error(`  ! ${city}/${language} p${page}: ${e.message} (retry ${fails}/4)`);
            if (fails >= 4) {
              console.error(`  ✗ giving up on ${city}/${language} p${page}, moving on`);
              fails = 0;
              break;
            }
            await sleep(5000);
            continue;
          }
          fails = 0;

          if (r.paused) {
            stats.paused++;
            const wait = Math.max(5, Number(r.retryAfterSec) || 30);
            console.log(`  … paused (core ${r.remaining}); sleeping ${wait}s`);
            await sleep(wait * 1000);
            continue; // retry same page
          }

          if (r.skipped) {
            stats.skipped++;
            console.log(`  ✓ ${city}/${language} p${page} skipped (done: ${r.found}/${r.total})`);
            // already-done page: if it was a full page, keep going; else stop language
            if (r.found === 100 && page < maxPages) break;
            page = maxPages; // exhausted/short — jump to next language
            break;
          }

          stats.pages++;
          stats.fetched += r.fetched ?? 0;
          console.log(
            `  ✓ ${city}/${language} p${page}: fetched ${r.fetched}/${r.total}` +
              `${r.hasMore ? " (more)" : " (last)"}`,
          );
          if (!r.hasMore) page = maxPages; // stop this language
          break;
        }
        await sleep(delayMs);
      }
    }
  }
}

async function map() {
  console.log("\nMapping people → companies (?map=1)…");
  for (;;) {
    const r = await call({ map: 1, batch: 200 });
    console.log(`  mapped ${r.mapped}/${r.distinctTried} strings → ${r.peopleUpdated} people updated`);
    if ((r.peopleUpdated ?? 0) === 0) break; // converged
    await sleep(delayMs);
  }
}

if (!mapOnly) await crawl();
if (doMap) await map();

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(
  `\nDone in ${mins} min — ${stats.pages} pages crawled, ${stats.fetched} people fetched, ` +
    `${stats.skipped} skipped, ${stats.paused} pauses.`,
);
