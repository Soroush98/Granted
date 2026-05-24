# Granted

Find Canadian organizations actually doing the work you care about — by indexing
their public R&D funding history and matching it against your query, resume, or
research paper.

```
                  ┌──────────────────────────┐
                  │   apps/web (Next.js 16)  │
                  │                          │
   user ─────►    │   /search ─► hybrid SQL  │
   (free-text     │     (vector + FTS RPC)   │
   + optional     │           │              │
    PDF)          │           ▼              │
                  │   Claude Haiku rerank    │
                  │       (JSON output)      │
                  └──────────┬───────────────┘
                             │ reads (RLS, anon)
                             ▼
                  ┌──────────────────────────┐
                  │   Supabase Postgres      │
                  │   + pgvector + pg_trgm   │
                  └──────────▲───────────────┘
                             │ writes (service role)
                             │
                  ┌──────────┴───────────────┐
                  │   services/scraper       │
                  │                          │
                  │   NSERC  · IRAP · SIF    │
                  │   FRQ · CFI · Scale AI   │
                  │   Alberta · Proactive    │
                  │           │              │
                  │           ▼              │
                  │   Voyage embed  ────────►│
                  └──────────────────────────┘
```

## What's actually indexed

Snapshot after the most recent ingest + entity-resolution cleanup:

| Source | Program codes | Grants | Date coverage |
|---|---|---:|---|
| Federal Proactive Disclosure (all departments — ACOA, FedDev, CED, IRAP, SIF, etc.) | `FEDERAL_OTHER`, `IRAP`, `SIF` | 17,632 | 2024-05-24 → 2026-04-28 |
| NSERC awards (Discovery, Alliance, CRD, Other) | `NSERC_*` | 22,510 | Fiscal year 2024 (FY2025 not yet published) |
| Quebec FRQ (Santé / Nature et technologies / Société et culture) | `FRQS`, `FRQNT`, `FRQSC` | 6,959 | FY2023-24 (latest FRQ publishes) |
| Canada Foundation for Innovation funded-projects | `CFI` | 817 | Calendar 2024–2025 |
| Alberta Innovates + Emissions Reduction Alberta | `PROVINCIAL_OTHER` | 879 | 2024–2025 (dates sparse) |
| Scale AI funded projects | `SCALE_AI` | 167 | No per-project dates |

**Totals**: 48,952 grants · 14,759 organizations · 93,002 indexed text chunks
(each chunk has a 1024-dim Voyage embedding + a tsvector for FTS).

Browse the live data at `/browse`, aggregate totals at `/stats`, and read the
honest limitations at `/about`.

## Tech stack

- **Web** (`apps/web`): Next.js 16, React 19, App Router with `'use cache'` +
  `cacheTag` + PPR, Server Actions, Turbopack, React Compiler.
- **Scraper** (`services/scraper`): Python 3.12, `httpx`, `selectolax`,
  `openpyxl`, `psycopg`. Streams CSVs and XLSX dumps directly into Postgres.
- **Embeddings**: Voyage AI `voyage-3.5` (1024-dim). Called from both the
  scraper (ingest-time) and the web app (query-time).
- **Reranker**: Claude Haiku 4.5 via the Anthropic API. Takes the top-10
  hybrid candidates and returns the top-5 with a one-sentence rationale.
  Uses `output_config.format` for strict JSON shape.
- **Data**: Supabase Postgres with `pgvector` (HNSW index, `m=16`,
  `ef_construction=64`), `pg_trgm` (GIN trigram on company names), and
  `tsvector` GIN FTS.

## How matching works

1. The user types a goal and optionally uploads a PDF (resume or paper). The
   PDF is parsed in-process via `unpdf`, capped at 4,000 chars, and
   concatenated as `GOAL: …\n\nBACKGROUND: …`.
2. **Query cleaning**: filter-words ("alberta", "labs", "doing") are stripped,
   common abbreviations are expanded (`ml` → `machine learning`, `ai` →
   `artificial intelligence`, etc.).
3. **Auto-filter detection**: a place mention (`Toronto`, `Quebec City`,
   `Atlantic Canada`) becomes a hard `province` filter; an org-type word
   (`companies`, `universities`, `research institutes`) becomes an `org_type`
   filter. The user can override either via the Advanced Filters panel.
4. **Name lookup**: an independent `pg_trgm` query against `companies.display_name`
   runs in parallel. If the query looks like an org name (e.g. "Wedge
   Networks") and the top hit is ≥40% similar, it appears as a "Did you mean?"
   banner above the ranked results.
5. **Hybrid retrieval**: the cleaned text is embedded with Voyage, then the
   `search_companies` RPC pulls the top-200×K candidates from HNSW (vector)
   and from GIN FTS (keyword), dedups one-chunk-per-company in each pool,
   joins to apply structured filters, and blends the two via
   `0.7 × vector + 0.3 × FTS`.
6. **Rerank**: Claude Haiku 4.5 ranks the top-10 against the user's intent and
   writes a short rationale per surviving match. The schema is enforced via
   `output_config.format`.

Per-search latency: ~4–6 s end-to-end (Voyage embed ≈ 200ms, RPC ≈ 200ms,
Haiku rerank ≈ 4 s).

## Features

- **`/`** — hero + upload + free-text query. Live-dot stats pill, glass-card
  form, ink-to-accent gradient.
- **`/search`** — Suspense-streamed results with "Did you mean?" name-match
  banner, auto-filter indicator, collapsible Advanced Filters panel
  (province, program, date range, amount, org type).
- **`/browse`** — paginated list of every grant in the index, sortable by
  recency / largest / smallest amount, sharing the same filter schema as
  `/search`.
- **`/stats`** — three SVG bar charts: total $ by program, grants per
  province, grants per year. Honors the same date-window URL params.
- **`/companies/[id]`** — full grant list per organization, 25-per-page
  pagination, sortable, in-page text search across that org's titles +
  descriptions.
- **Rate limit** — 10 searches per IP, lifetime. Enforced before the
  expensive embed + rerank step so over-quota requests cost nothing on the
  Claude side.

## Setup (local dev)

### 0. Prereqs

- Node 20.18+, pnpm 9+
- Python 3.12+
- A Supabase project (the schema is documented in `services/scraper/scraper/db.py`
  and the web app's `lib/db/types.ts` — see "Schema bootstrap" below)
- API keys: [Voyage AI](https://voyageai.com), [Anthropic](https://console.anthropic.com)

### 1. Web app

```bash
cp .env.example apps/web/.env.local
# fill in the four required keys (Supabase URL + anon + service-role,
# Voyage, Anthropic). See .env.example for the full list.

pnpm install
pnpm --filter web dev
# http://localhost:3000
```

### 2. Scraper / ingest

```bash
cd services/scraper
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
# VOYAGE_API_KEY, REVALIDATE_SECRET

# Each ingester pulls from a public source. Examples:
granted-scraper ingest-nserc        ./nserc_data/NSERC_FY2024_Expenditures.csv
granted-scraper ingest-federal-recent ./proactive_data/grants.csv
granted-scraper ingest-frq          ./frq_data/frqs_2023_2024.csv  --program FRQS
granted-scraper ingest-cfi          --year 2024 --year 2025
granted-scraper ingest-abinnovates
granted-scraper ingest-era
granted-scraper ingest-scaleai      ./scaleai_urls.json

# Fill in any chunks that don't have an embedding yet:
granted-scraper embed-pending

# Bust the web app's 'use cache' tags:
granted-scraper revalidate search
```

Download URLs for each CSV are documented in the corresponding
`services/scraper/scraper/sources/*.py` file. The `*_data/` folders are
gitignored — you bring your own.

### Schema bootstrap

The repo no longer ships migrations (we squashed the history when going
public). The schema is reproducible from the code, but if you want a clean
init script for a fresh Supabase project, the tables and RPCs you need are:

- Extensions: `vector`, `pg_trgm`, `unaccent`, `pg_stat_statements`
- Tables: `funding_programs`, `companies`, `grants`, `grant_partners`,
  `grant_chunks`, `search_log` (see `apps/web/lib/db/types.ts` for the exact
  shape used by the TypeScript layer)
- Indexes: HNSW on `grant_chunks.embedding`, GIN trigram on
  `companies.display_name`, GIN on `grant_chunks.fts`, btree on common FK /
  filter columns
- RPCs: `search_companies`, `search_companies_by_name`, `browse_grants`,
  `list_filter_facets`, `stats_by_program`, `stats_by_province`,
  `stats_by_year`, `apply_chunk_embeddings`, `recent_search_count`,
  `company_totals`

If you want the actual SQL, open an issue or ask — happy to share an init
snapshot. The schema isn't a secret; it just doesn't make sense to publish
as a history of 14 corrective migrations.

## Project layout

```
.
├── apps/web/                          Next.js 16 app
│   ├── app/
│   │   ├── _components/               Logo, AdvancedFilters, ResumeInput
│   │   ├── about/                     Honest limitations page
│   │   ├── browse/                    Filtered + sortable grant list
│   │   ├── companies/[id]/            Per-org page (paginated + searchable)
│   │   ├── search/                    Hybrid + rerank results
│   │   └── stats/                     SVG charts
│   ├── lib/
│   │   ├── ai/                        Voyage embed + Claude chat
│   │   ├── db/                        Supabase clients + hand-typed schema
│   │   ├── rag/                       search.ts, browse.ts, prepare-query.ts
│   │   ├── filters.ts                 URL ↔ SearchFilters helpers
│   │   ├── ip.ts                      Rate-limit IP + constants
│   │   ├── locations.ts               Province + org-type auto-detect
│   │   └── resume.ts                  PDF text + GOAL/BACKGROUND splitter
│   └── next.config.ts
├── services/scraper/                  Python ingestion
│   └── scraper/
│       ├── sources/
│       │   ├── nserc.py               NSERC awards CSV
│       │   ├── proactive.py           Federal proactive disclosure CSV
│       │   ├── frq.py                 Quebec FRQ CSV (S / NT / SC)
│       │   ├── cfi.py                 CFI funded-projects HTML scraper
│       │   ├── abinnovates.py         Alberta Innovates sitemap scraper
│       │   ├── era.py                 ERA Alberta sitemap scraper
│       │   └── scaleai.py             Scale AI press-release scraper
│       ├── db.py                      Supabase client + retry/bulk helpers
│       ├── voyage.py                  Voyage REST wrapper
│       ├── normalize.py               Entity-resolution helpers
│       └── cli.py                     Typer commands (ingest-*, embed-pending)
└── supabase/                          Supabase project config (no migrations)
    └── config.toml
```

## Known limitations

- **SR&ED tax credits are confidential.** The single largest federal R&D
  channel in Canada (>$4B/year) is legally not disclosable per recipient.
  Treat totals here as a *lower bound*.
- **NSERC is one year behind.** Only FY2024 (April 2024 – March 2025) is
  available. FY2025 lands around late 2026. NSERC rows also lack
  `start_date` (only `fiscal_year`), so date-range filters don't narrow
  NSERC.
- **Quebec FRQ is pre-window.** Latest FRQ data on donneesquebec.ca is
  FY2023-24 — strictly before the 2-year recency window. Still included
  because it's the only Quebec research-funding signal available.
- **Provincial coverage is uneven.** Alberta is well-covered (AB Innovates +
  ERA). Ontario, BC, and Atlantic provinces are covered only through whatever
  federal funds flowed to them — no provincial agency feeds yet for
  OCI / FedDev / Innovate BC / ACOA-only programs.
- **No researcher search.** NSERC + FRQ contain ~26k investigator names, but
  they live in `grants.raw` JSONB and aren't indexed. Searching
  "<professor name>" won't find their grants today.
- **CFI lacks project descriptions** — only fund-type, field of research,
  institution, year, and team members. Semantic match is coarser there.
- **Entity resolution is good, not perfect.** ~649 obvious duplicates were
  merged in a recent cleanup pass; subsidiaries and regional campuses may
  still split.
- **Not real-time.** Federal proactive disclosure refreshes quarterly.
  Re-ingestion is manual.
- **Not a job board.** Granted shows you which organizations are credibly
  building real tech with public R&D money. You still apply through their
  own channels.

## License

MIT
