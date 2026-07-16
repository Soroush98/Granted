// k6 load test — QA-STRATEGY.md cases LT-01…LT-04.
//
// Shape: LOAD (expected traffic) + a short SPIKE, plus the REJECTION path.
// Deliberately excluded: /search?q=… and /finders/search — every request there
// spends real Voyage/Anthropic money; their gating logic is covered by unit
// and smoke tests instead. Do not add AI paths to this script.
//
// Run against a local production build:
//   pnpm --filter web build && pnpm --filter web start
//   k6 run qa/load/browse-load.js
// Optional: BASE_URL=... k6 run qa/load/browse-load.js
//
// Thresholds are the pass/fail contract — a run that misses them exits 99.
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

// Separate trends so cached-page latency doesn't mask uncached RPC latency.
const cachedPages = new Trend("cached_pages", true);
const uncachedTrend = new Trend("uncached_browse", true);
const rejection = new Trend("rejection_401", true);

export const options = {
  scenarios: {
    // LT-01: steady expected load on the cacheable surfaces.
    browse_load: {
      executor: "constant-arrival-rate",
      rate: 15,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 30,
      maxVUs: 120,
      exec: "browseMix",
    },
    // LT-02: cache-busting pagination — every request a distinct page/sort, so
    // each one exercises the browse RPC against Supabase (the DB-bound path).
    uncached_browse: {
      executor: "constant-arrival-rate",
      rate: 3,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 10,
      maxVUs: 40,
      exec: "uncachedBrowse",
    },
    // LT-03: spike on the hot page — sudden burst, does the cache hold?
    spike: {
      executor: "ramping-arrival-rate",
      startTime: "65s",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 60,
      maxVUs: 200,
      stages: [
        { target: 60, duration: "10s" },
        { target: 60, duration: "15s" },
        { target: 5, duration: "5s" },
      ],
      exec: "hotPage",
    },
    // LT-04: the rejection path must stay fast and cheap under pressure —
    // a slow 401 is itself a DoS vector.
    rejection: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "95s",
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: "rejectedRevalidate",
    },
  },
  thresholds: {
    // Local prod build + remote Supabase; see qa/load/RESULTS.md for context.
    http_req_failed: ["rate<0.01"],
    "cached_pages": ["p(95)<1500"],
    "uncached_browse": ["p(95)<3000"],
    "rejection_401": ["p(95)<200"],
    "checks": ["rate>0.99"],
  },
};

const BROWSE_PAGES = [
  "/",
  "/search",
  "/stats",
  "/about",
  "/search?sort=amount_desc",
  "/search?country=US",
  "/search?org=company",
];

export function browseMix() {
  const path = BROWSE_PAGES[Math.floor(Math.random() * BROWSE_PAGES.length)];
  const res = http.get(`${BASE}${path}`, { tags: { name: path } });
  cachedPages.add(res.timings.duration);
  check(res, {
    "browse 200": (r) => r.status === 200,
    "browse has body": (r) => (r.body?.length ?? 0) > 1000,
  });
}

export function uncachedBrowse() {
  // Distinct page numbers + jittered amount filter → cache miss → real RPC.
  const page = Math.floor(Math.random() * 500);
  const minAmount = 1000 + Math.floor(Math.random() * 5000);
  const res = http.get(
    `${BASE}/search?page=${page}&sort=recent&min_amount=${minAmount}`,
    { tags: { name: "/search?page=N (uncached)" } },
  );
  uncachedTrend.add(res.timings.duration);
  check(res, { "uncached browse 200": (r) => r.status === 200 });
}

export function hotPage() {
  const res = http.get(`${BASE}/`, { tags: { name: "/ (spike)" } });
  cachedPages.add(res.timings.duration);
  check(res, { "spike 200": (r) => r.status === 200 });
}

export function rejectedRevalidate() {
  const res = http.post(
    `${BASE}/api/revalidate`,
    JSON.stringify({ tags: ["search"] }),
    {
      headers: {
        "content-type": "application/json",
        authorization: "Bearer definitely-wrong",
      },
      tags: { name: "/api/revalidate (401)" },
      // 401 is the EXPECTED outcome here — keep it out of http_req_failed.
      responseCallback: http.expectedStatuses(401),
    },
  );
  rejection.add(res.timings.duration);
  check(res, { "rejected with 401": (r) => r.status === 401 });
}
