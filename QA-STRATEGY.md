# QA Strategy — Granted

Scope: the web app (`apps/web`), the scraper's shared logic (`services/scraper`),
and the deployed serving path. Written 2026-07-16 against commit `53b3b17`.

## Product risks (likelihood × impact, tested in this order)

| # | Risk | L×I | Mitigation surface |
|---|------|-----|--------------------|
| R1 | **Cost blow-up**: bots loop the embed+rerank path, burning Voyage/Anthropic credits | H×H | spam heuristic (`lib/rag/spam.ts`), quota gates (`lib/ip.ts` + `consume_quota`), Turnstile, origin lock |
| R2 | **Silently-wrong results**: query cleaning / auto-filters / country mapping mangle intent (user sees plausible but wrong orgs) | M×H | `lib/rag/prepare-query.ts`, `lib/locations.ts`, `lib/countries.ts`, `lib/filters.ts` |
| R3 | **Data corruption at ingest**: entity resolution merges distinct orgs or fails to merge duplicates | M×H | `services/scraper/scraper/normalize.py` |
| R4 | **Broken links / filter drift**: /search, /stats, /companies share URL vocabulary; a param mismatch silently drops filters | M×M | `lib/filters.ts` round-trip |
| R5 | **Downtime / slow under load**: browse pages are the growth surface; Supabase RPC + Next cache must hold | M×M | load test (see `qa/load/`) |
| R6 | **Auth bypass on ops endpoints**: /api/revalidate, /finders/search | L×H | negative API tests |
| R7 | Cosmetic/UI regressions | M×L | not automated (below) |

## Test levels

- **Unit** (`apps/web/lib/__tests__`, vitest; `services/scraper/tests`, pytest):
  pure logic — country mapping, filter parsing, location/org detection, spam
  heuristic, query preparation, document normalization, org-name
  normalization. Run: `pnpm --filter web test` / `cd services/scraper && pytest`.
- **API / smoke** (`qa/smoke.sh`): the built app served locally
  (`next build && next start`), hitting real Supabase (read-only paths). Happy
  paths return 200 with expected content; negative paths (bad auth, malformed
  body, invalid params) return the right 4xx **fast** and leak nothing.
- **Non-functional** (`qa/load/`, k6): load + spike on the cheap browse
  surfaces, plus the rejection path (unauthorized POST). Thresholds encoded in
  the script — a run that misses them exits non-zero. Results committed to
  `qa/load/RESULTS.md` with date, revision, environment.

## Deliberately not automated (and why)

- **The AI search path end-to-end** (`/search?q=…`, `/finders/search` happy
  path): every request costs real Voyage + Anthropic money and the output is
  non-deterministic. Covered by unit tests up to the boundary (spam gate, query
  prep) and by one manual smoke request per release. Do not add it to CI or
  load scenarios.
- **Rate-limit windows against real Postgres** (`consume_quota`): lives in a
  migration, enforced atomically in the DB. Verified manually; a testcontainer
  harness is the right future home.
- **UI pixel/visual regressions**: solo project, changes reviewed by eye.

## Entry/exit criteria

- Merge to main: unit suites green (`vitest` + `pytest`), typecheck green.
- Release: smoke script green against a prod build; no open S1/S2 defects.
- Load test: on demand (before infra changes), not per-commit; thresholds in
  the k6 script are the pass/fail contract.

## Traceability matrix

Requirement → test case IDs. Test files reference the IDs in test names.

| Req | Requirement (from README / code contracts) | Cases |
|-----|--------------------------------------------|-------|
| RQ1 | Grant country inferred from program code; unknown → CA | CT-01…CT-06 |
| RQ2 | Country filter → program-code include list; CA = all minus foreign | CT-07…CT-10 |
| RQ3 | URL params ↔ SearchFilters round-trip losslessly across pages | FL-01…FL-12 |
| RQ4 | Page/sort params reject invalid input, never NaN or negative | FL-13…FL-16 |
| RQ5 | Province auto-filter: names, cities, accents, standalone 2-letter codes, first-mention-wins | LC-01…LC-10 |
| RQ6 | Org-type auto-filter: word list per type, first-mention-wins | LC-11…LC-15 |
| RQ7 | Promo spam blocked before any AI spend; resumes never false-positive | SP-01…SP-08 |
| RQ8 | Query cleaning: fillers stripped, abbreviations expanded, applied-filter words removed, never empties, background verbatim | PQ-01…PQ-08 |
| RQ9 | Document text: 4,000-char cap, control chars stripped, GOAL/BACKGROUND round-trip incl. legacy separator | RS-01…RS-08 |
| RQ10 | Client IP: header precedence CF → Vercel → XFF(first) → x-real-ip → null | IP-01…IP-05 |
| RQ11 | Org-name normalization dedupes spelling variants without over-merging | NM-01…NM-08 |
| RQ12 | /api/revalidate: 401 without/with-wrong bearer, tolerant of malformed JSON | SM-04, SM-05 |
| RQ13 | /finders/search: rejects missing turnstile/short input without AI spend | SM-06 |
| RQ14 | Browse surfaces hold expected load; rejections are fast | LT-01…LT-04 |

## Defect management

Defects found by these suites are filed in `qa/DEFECTS.md` (this repo has no
tracker) with severity/priority, repro, and — once fixed — the regression test
ID that covers them.
