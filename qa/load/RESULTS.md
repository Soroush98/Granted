# Load-test results

Newest first. Every run records date, revision, environment, numbers, and an
interpretation — a result without analysis doesn't count.

---

## 2026-07-16 — rev `53b3b17` — **FAIL** (thresholds crossed → DEF-1)

**Environment**: local production build (`next build && next start`, single
Node process) on an Apple-silicon dev machine, against the **production**
Supabase project (network round-trip included). k6 v(local), script
`qa/load/browse-load.js` @ this commit. Caveat: k6 and the server shared one
machine; that inflates tails under saturation but does not explain 30s+
medians (single-request baselines below were taken on an idle server).

**Shapes run**: load (15 rps cached mix, 60s) + cache-busting load (3 rps
distinct browse URLs, 60s) + spike (5→60 rps on `/`, 30s) + rejection
(10 rps bad-auth POST, 95s).

| Metric | Result | Threshold | Verdict |
|---|---|---|---|
| Rejection 401 p95 | **8.12 ms** | < 200 ms | ✅ pass |
| Cached pages median | 5.5 ms | — | (healthy) |
| Cached pages p95 | **40.7 s** | < 1.5 s | ❌ fail |
| Uncached browse median / p95 | **30.6 s / 60 s (timeout)** | p95 < 3 s | ❌ fail |
| http_req_failed | 35.8% raw / **~2.6% corrected**¹ | < 1% | ❌ fail |
| checks succeeded | 97.8% | > 99% | ❌ fail |
| Dropped iterations | 507 (VU pool exhausted waiting on 30–60s responses) | — | symptom |

¹ This run's script counted the rejection scenario's *intentional* 401s
(950 requests) as failures; corrected rate excludes them. Fixed in the script
via `responseCallback: expectedStatuses(401)` immediately after this run —
the corrected ~2.6% (69 browse 5xx/timeouts + 5 uncached) still fails the 1%
threshold on its own.

**Single-request baselines** (idle server, sequential, uncached):
`/search` ≈ 2.79s · `?page=4` ≈ 2.78s · `?page=450` ≈ 3.04s ·
`?min_amount=9999` ≈ 2.53s · `?page=450&min_amount=8888` ≈ 2.69s.
Flat across offset depth and filters → the `browse_grants` RPC costs ~2.5–3s
per call, period.

**Interpretation**: the failure is real and architectural, not an artifact.
Under the modeled concurrent uncached-browse load, DB work arrives faster than
one Postgres can retire it (~2.5–3s per `browse_grants` call). The DB
saturates, `browse_grants` starts returning `canceling statement due to
statement timeout` (server log), and latency contagion spreads to the cached
mix — its p95 rose from ~6ms to 40s as the handful of `cacheLife("minutes")`
entries lapsed and re-rendered through the same saturated DB. The spike
scenario couldn't finish its last iteration. The rejection path holding 8ms
p95 throughout shows the protection layer itself is sound; the reliability
ceiling is the per-request cost of the browse query. Filed as **DEF-1**
(S2/P1) in `qa/DEFECTS.md` with fix directions. These thresholds are the
regression gate — re-run against a staging/local DB after the fix and append
the run here. Do not run the saturating scenarios against the live
deployment.

**Deliberately not tested**: `/search?q=…` and `/finders/search` (real
Voyage/Anthropic spend per request; gating covered by unit + smoke suites).
One manual AI search that day: 9.2s end-to-end, results + rationales rendered
(OBS-5).
