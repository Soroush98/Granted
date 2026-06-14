# `search_companies` performance findings

Surfaced by the golden-set eval ([eval-finders.mjs](./eval-finders.mjs)) and then
diagnosed directly against the live DB with `EXPLAIN`. This is the **DB-level**
root cause behind the finder slowness/timeouts. The app-level workaround is
already shipped (see [lib/njf/find.ts](../lib/njf/find.ts)); this note is the deeper fix —
which needs a maintenance window, so it is documented, not yet applied.

## Symptom

`search_companies` is fast unfiltered (~2s) but slow or times out once a
`program_codes` or `org_filter` is applied. Measured (service_role, real query):

| filter | time |
| --- | --- |
| none (unfiltered) | ~2s |
| `codes=["UKRI"]` / `["ARC",…]` | 9–11s |
| `org="university"` | 9–13s |
| `org="company"` + `codes=["NSF","NIH"]` | ~17–20s |
| `codes=["NSF","NIH"]`, `org=null` | **>70s — statement timeout** |

## Root cause (confirmed via `EXPLAIN`)

It is **not** an iterative-scan tuning problem. The wrapper already does the right
things — `hnsw.ef_search=200`, `hnsw.iterative_scan='strict_order'` for filtered
queries, `statement_timeout=30s`, separate `_search_companies_filtered` /
`_search_companies_unfiltered` helpers. The problem is two facts about the data +
query shape:

1. **The filters are non-selective** — they match the *majority* of the corpus:

   | | chunks | % of corpus |
   | --- | --- | --- |
   | total | 336,740 | 100% |
   | `funder ∈ {NSF, NIH}` | 189,352 | **56%** |
   | `org_type = 'university'` | 282,761 | **84%** |

2. **The filters live on JOINED tables** (`funding_programs.code` via
   `grant_chunks→grants→funding_programs`; `companies.org_type` via
   `grant_chunks→companies`). The planner therefore can't push them into the HNSW
   index scan. Its plan for a filtered query is:

   ```
   Limit → Sort (key: embedding <=> query)        ← brute-force sort
     → Nested Loop (funding_programs → grants → grant_chunks)
   ```

   i.e. it **ignores the HNSW index**, joins to find the ~189k–282k matching
   chunks, computes `embedding <=> query` for **all of them**, and sorts. With
   189k–282k 1024-dim vectors (~0.75–1.1 GB of embeddings) to read and score, that
   is the 20s→timeout. `iterative_scan` never engages because HNSW is never entered.

The unfiltered path is fast because, with no filter, the planner *does* use the
HNSW index (reads only ~`ef_search` vectors).

## The real fix: denormalize the filter columns onto `grant_chunks`

If `org_type` and the funder `program_code` (and optionally `province`,
`start_date`, `amount_cad`) are **columns on `grant_chunks`**, the filtered query
becomes a single nearest-neighbor query the planner *can* drive from HNSW:

```sql
SELECT ... FROM grant_chunks gc
WHERE gc.embedding IS NOT NULL
  AND (program_codes IS NULL OR gc.program_code = ANY(program_codes))
  AND (org_filter    IS NULL OR gc.org_type     = org_filter)
ORDER BY gc.embedding <=> query_embedding
LIMIT match_count;
```

With `hnsw.iterative_scan` on, the filter is applied during the index walk — and
because the filters are **non-selective** (most rows pass), the scan barely
over-fetches. Expected: the 20s/timeout cases drop to roughly the ~2s unfiltered
baseline, **with full recall**. This would also let us retire the JS-filter split
in `find.ts` and route every finder through one fast filtered search.

### Why it needs a maintenance window (not a plain migration)

`grant_chunks` has an HNSW index on `embedding`. **Updating any column on that
table re-inserts the row's vector into the HNSW index — measured at ~60 ms/row.**
A full in-place backfill of 336,740 rows would take **5+ hours**. So the rollout
must avoid per-row index churn:

```text
1. BEGIN maintenance window (filtered finder search degraded; unfiltered also
   degraded only during the index rebuild in step 4).
2. ALTER TABLE grant_chunks ADD COLUMN org_type org_type, ADD COLUMN program_code text
   (+ province / start_date / amount_cad if the /search page filters should be fast too).
3. DROP the HNSW index on grant_chunks.embedding.          ← so the backfill is cheap
4. Backfill the new columns from the joins (one UPDATE … FROM; fast without the index).
5. CREATE the HNSW index again (minutes for 336k vectors; CONCURRENTLY to avoid locks).
6. Add a BEFORE INSERT/UPDATE trigger on grant_chunks that fills the denormalized
   columns from companies/grants/funding_programs, so ingest stays correct with NO
   code change to the scraper.
7. CREATE OR REPLACE _search_companies_filtered to filter on the gc.* columns
   directly (drop the joins from the vector_raw / fts_raw CTEs).
8. EXPLAIN ANALYZE the NSF/NIH + university cases to confirm HNSW is used and they
   run in low single digits; re-run the golden set for recall.
9. Simplify find.ts: route all finders through the now-fast filtered search.
```

pgvector is **0.8** (confirmed), so iterative scan is available. The HNSW rebuild
in step 5 is the only real-downtime piece; size it / schedule for low traffic, or
use `CREATE INDEX CONCURRENTLY`.

## Interim state (already shipped, no DB change)

`findBySpikes` ([lib/njf/find.ts](../lib/njf/find.ts)) avoids the brute-force path where it
can, so **nothing times out today**:

- **research-pi (PI mode)** and **"anywhere"** retrieve **unfiltered** (the fast
  HNSW path) and filter by country / org / PI in JS — safe on depth because
  PIs/universities dominate the corpus.
- **single-country /jobs & /supervisors** still use the DB-filtered search
  (brute-force, but it completes in ~9–17s and preserves depth for sparse
  companies). These are the searches the maintenance-window fix above would make
  fast.
