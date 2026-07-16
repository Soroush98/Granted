# Defect log

Found by the QA pass of 2026-07-16 (rev `53b3b17`, local prod build
`next start` + production Supabase). Severity = impact, Priority = urgency.

---

## DEF-1 — Browse RPC is a scaling bottleneck; concurrent uncached renders trip the statement timeout

**Severity: S2 · Priority: P1 · Status: OPEN** — capacity/reliability finding.

Each uncached render of the browse ledger (`/search` with no `q`) costs a
**~2.5–3.0s** `browse_grants` RPC. Latency is flat across offset depth and
filter combination (page 0 ≈ page 450 ≈ 2.6–3.0s on an idle server), so the
cost is in the query itself, not OFFSET paging. Because the result is keyed by
the full filter/page URL and held only `cacheLife("minutes")`, a spread of
distinct filter combinations mostly misses the cache and lands on Postgres.

**Repro** (local prod build, against a non-prod DB): `k6 run
qa/load/browse-load.js`. Under the modeled concurrent uncached-browse load the
DB saturates — `browse_grants` begins returning `canceling statement due to
statement timeout` (server log), uncached p95 hits the timeout ceiling, and
because cached pages re-render through the same DB when their minutes-window
lapses, the cached mix's p95 degrades with it. Numbers and interpretation:
`qa/load/RESULTS.md`.

**Why it matters**: the browse ledger is the main un-gated growth surface and
its per-request DB cost sets the ceiling on how much organic/crawler read
traffic the shared Postgres absorbs before latency spreads to the rest of the
site. Headroom here is low.

**Suggested directions** (pick any subset): make `browse_grants` cheap — it
appears to sort the full corpus per call, so precompute/index the hot
sort+filter paths; lengthen `cacheLife` for the ledger (ingest already busts
the `search` tag, so minutes-freshness buys little); shrink the cache-key
space by clamping `page` (OBS-1) and canonicalizing filter combos; add a
lightweight edge rate-limit on `/search` without `q`. Coordinate the fix with
the site owner — do not exercise the saturating load against the live
deployment; the k6 script is for a staging/local DB.

**Regression test**: `qa/load/browse-load.js` thresholds (`uncached_browse
p(95)<3000`, `http_req_failed rate<0.01`) — currently failing, must pass after
the fix.

---

## DEF-2 — "AB testing" auto-filters to Alberta despite code comment claiming otherwise

**Severity: S3 · Priority: P3 · Status: OPEN**

`detectLocationFilter` (`apps/web/lib/locations.ts:104-111`) matches any
standalone uppercase 2-letter province code. The comment says this avoids
false positives "like 'AB testing'", but `"AB testing platforms"` returns
`{province: "AB"}` — a user searching A/B-testing tooling gets silently
scoped to Alberta (the auto-filter banner does disclose it, hence S3 not S2).
Same holds for e.g. "ON prem" written uppercase.

**Regression test**: `lib/__tests__/locations.test.ts` LC-08, marked
`it.fails` — flips to a hard failure (remove the `.fails`) when fixed.

---

## Observations (accepted risks / documented behavior — not defects yet)

- **OBS-1** — `readPage` has no upper bound: `?page=1000000000` flows to the
  RPC as a giant OFFSET (`lib/filters.ts:63`). Harmless alone (the RPC clamps
  at timeout), but it hands DEF-1 attackers an infinite URL space. Pinned by
  FL-16. Clamp to a sane max (e.g. 2,000) when touching DEF-1.
- **OBS-2** — date params pass through unvalidated (`min_date=not-a-date`
  reaches the RPC). Postgres rejects garbage safely today. Pinned by FL-15.
- **OBS-3** — a pasted *cover letter* ("Dear hiring manager… thanks for your
  time") trips the promo-spam gate (greeting + sign-off = 2 signals). Accepted:
  cover letters aren't search queries, and the block message explains itself.
  Pinned by SP-08 so any tuning is conscious.
- **OBS-4** — `normalize_org_name` maps suffix-only names ("The Tech Company
  Inc.") to `""`, so all such orgs share one entity-resolution key. Rare in
  practice; would over-merge if two exist. Pinned by NM-08.
- **OBS-5** — the single manual AI search (release smoke) took 9.2s wall vs the
  README's stated 4–6s. One cold sample, not load-tested by policy (real API
  spend); watch it, don't chase it.
