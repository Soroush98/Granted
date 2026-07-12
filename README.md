# Granted

**Live site: [www.grantedjobs.com](https://www.grantedjobs.com)**

Find organizations actually doing the work you care about — across **Canada, the
United States, the United Kingdom, and Australia**. It indexes their public R&D
funding history and matches it against your query, resume, or research paper.

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
                             │ reads (service role)
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
                  │  CA: Federal Proactive   │
                  │  (NSERC·SSHRC·IRAP·SIF)  │
                  │      CIHR·FRQ·CFI        │
                  │  Clusters: NGen·DIGITAL  │
                  │   PIC·Ocean·Genome·Mitacs│
                  │  US: NSF · NIH           │
                  │  UK: UKRI                │
                  │  AU: ARC · GrantConnect  │
                  │           │              │
                  │           ▼              │
                  │   Voyage embed  ────────►│
                  └──────────────────────────┘
```

The corpus has no `country` column — a grant's country is inferred from its
funding program (`lib/countries.ts`): each non-Canadian country owns a fixed set
of program codes, and everything else is Canadian.

## What's actually indexed

Here's what's in the index after the latest data refresh:

| Country | Source | Program codes | Grants | Date coverage |
|---|---|---|---:|---|
| 🇨🇦 | Federal Proactive Disclosure (ACOA, FedDev, CED, IRAP, SIF, SSHRC, ESDC, …) | `FEDERAL_OTHER`, `IRAP`, `SIF` | 103,653 | 2024-05-24 → 2026 (FY2025-26 Q4) |
| 🇨🇦 | NSERC (FY2024 awards snapshot + quarterly proactive researcher rows) | `NSERC_*` | 34,283 | FY2024 snapshot; proactive → FY2025-26 Q4 |
| 🇨🇦 | Mitacs (industry-partnered research projects; recipient = partner company) | `MITACS` | 4,000 | No per-project dates |
| 🇨🇦 | CIHR Grants & Awards (with abstracts) | `CIHR` | 7,398 | FY2025-26 |
| 🇨🇦 | Quebec FRQ (Santé / Nature et technologies / Société et culture) | `FRQS`, `FRQNT`, `FRQSC` | 6,947 | FY2023-24 (latest FRQ publishes) |
| 🇨🇦 | Alberta Innovates + Emissions Reduction Alberta | `PROVINCIAL_OTHER` | 879 | 2024 to 2025 (dates sparse) |
| 🇨🇦 | Canada Foundation for Innovation funded-projects | `CFI` | 817 | Calendar 2024 to 2025 |
| 🇨🇦 | Genome Canada funded research (PIs + institutions, with abstracts) | `GENOME_CANADA` | 585 | No per-project dates |
| 🇨🇦 | Scale AI funded projects | `SCALE_AI` | 167 | No per-project dates |
| 🇨🇦 | Ocean Supercluster funded projects | `OCEAN_SC` | 109 | Dates sparse |
| 🇨🇦 | Protein Industries Canada funded projects | `PIC` | 101 | 2020 → 2026 |
| 🇨🇦 | NGen (advanced-manufacturing) funded projects | `NGEN` | 84 | Dates sparse |
| 🇨🇦 | DIGITAL Technology Supercluster funded projects | `DIGITAL` | 74 | Dates sparse |
| 🇺🇸 | NIH RePORTER (medical research, with abstracts) | `NIH` | 72,941 | ~2 years (award notice 2024-06 →) |
| 🇺🇸 | NSF Awards (science & engineering, incl. SBIR/STTR) | `NSF` | 17,422 | ~2 years (2024-06 →) |
| 🇬🇧 | UKRI Gateway to Research (7 councils + Innovate UK) | `UKRI` | 8,881 | ~2 years (fund start 2024-06 →) |
| 🇦🇺 | ARC National Competitive Grants (non-medical research) | `ARC` | 12,510 | Commencing 2016 → |
| 🇦🇺 | GrantConnect (federal grants, R&D/industry-filtered) | `GRANTCONNECT` | 10,844 | ~2 years (publish 2024-06 →) |

**Totals**: 281,695 grants, 78,329 organizations, 517,613 indexed text chunks.
Each chunk has a 1024-dim Voyage embedding and a tsvector for full-text search.
(The homepage/stats pages now render these totals live, so they don't go stale.)

Browse the live data at `/search`, see totals at `/stats`, and read the
limitations at `/about`.

## Tech stack

- **Web** (`apps/web`): Next.js 16, React 19, App Router with `'use cache'` +
  `cacheTag` + PPR, Server Actions, Turbopack, React Compiler.
- **Scraper** (`services/scraper`): Python 3.12, `httpx`, `selectolax`,
  `openpyxl`, `psycopg`. Streams CSVs and XLSX dumps straight into Postgres.
- **Embeddings**: Voyage AI `voyage-3.5` (1024-dim). Called from both the
  scraper (at ingest time) and the web app (at query time).
- **Reranker**: Claude Haiku 4.5 via the Anthropic API. Takes the top 10
  hybrid candidates and returns the top 5 with a one-sentence reason.
  Uses `output_config.format` for a strict JSON shape.
- **Data**: Supabase Postgres with `pgvector` (HNSW index, `m=16`,
  `ef_construction=64`), `pg_trgm` (GIN trigram on company names), and
  `tsvector` GIN FTS.

## How matching works

1. The user types a goal and can optionally upload a PDF (resume or paper).
   The PDF gets parsed in-process via `unpdf`, capped at 4,000 chars, and
   joined as `GOAL: …\n\nBACKGROUND: …`.
2. **Query cleaning**: common words like "alberta", "labs", "doing" are
   removed, and short forms are expanded (`ml` → `machine learning`, `ai` →
   `artificial intelligence`, etc.).
3. **Auto-filter detection**: a place name (`Toronto`, `Quebec City`,
   `Atlantic Canada`) turns into a strict `province` filter, and an org-type
   word (`companies`, `universities`, `research institutes`, `labs`) turns
   into an `org_type` filter. The user can override either one — or pick a
   **country** (CA/US/UK/AU) — in the Advanced Filters panel. The country
   filter resolves to its program codes at query time (Canada = every program
   code minus the foreign ones, derived from the live facet list).
4. **Name lookup**: a separate `pg_trgm` query against
   `companies.display_name` runs in parallel. If the query looks like an org
   name (e.g. "Wedge Networks") and the top hit is at least 40% similar, it
   shows up as a "Did you mean?" banner above the ranked results.
5. **Hybrid retrieval**: the cleaned text is embedded with Voyage, then the
   `search_companies` RPC pulls the top 200×K candidates from HNSW (vector)
   and from GIN FTS (keyword), keeps one chunk per company in each pool,
   joins to apply structured filters, and combines the two via
   `0.7 × vector + 0.3 × FTS`.
6. **Rerank**: Claude Haiku 4.5 ranks the top 10 based on what the user is
   looking for and writes a short reason per surviving match. The shape is
   enforced via `output_config.format`.

Time per search: about 4 to 6 seconds end-to-end (Voyage embed ≈ 200ms, RPC ≈
200ms, Haiku rerank ≈ 4s).

## Features

- **`/`**: hero, upload, and free-text query. Live-dot stats pill, glass-card
  form, ink-to-accent gradient.
- **`/search`**: Suspense-streamed results with a "Did you mean?" name-match
  banner, an auto-filter indicator, and a collapsible Advanced Filters panel
  (**country**, org type, region (province/state), program, date range, amount).
  With no query it becomes the browsable grant ledger (paginated, sortable by
  recency / largest / smallest amount).
- **`/jobs`, `/supervisors`, `/research-pi`**: the spike finders, each with a
  country selector (CA/US/UK/AU/Anywhere). `/research-pi` also has an optional
  live web search for labs that look like they're recruiting.
- **`/stats`**: three SVG bar charts: total $ by program (with a mixed-currency
  caveat), grants per region (province/state), grants per year. Honors the same
  date-window URL params.
- **`/companies/[id]`**: full grant list for one organization, 25 per page,
  sortable, with in-page text search across that org's titles and
  descriptions.
- **Abuse controls**: AI searches are rate-limited per client and capped
  globally, and gated behind a bot challenge at the edge — all enforced before
  the expensive embed and rerank step, so blocked requests cost nothing on the
  Claude side. A zero-cost heuristic (`lib/rag/spam.ts`) also bounces
  promo-spam pasted into the /search box (bots pitching SEO/Instagram services
  mention the site's own domain and cold-outreach phrasing) before the quota
  gate, the embed, the rerank, and the analytics log.

## Setup (local dev)

### 0. Prereqs

- Node 20.18+, pnpm 9+
- Python 3.12+
- A Supabase project. The schema is documented in
  `services/scraper/scraper/db.py` and the web app's `lib/db/types.ts`. See
  "Schema bootstrap" below.
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

# Each ingester pulls from a public source. CA (CSV/scrape):
granted-scraper ingest-federal-recent ./proactive_data/grants.csv
granted-scraper ingest-cihr         ./cihr_data/cihr_2025_2026.xlsx
granted-scraper ingest-frq          ./frq_data/frqs_2023_2024.csv  --program FRQS
granted-scraper ingest-cfi          --year 2024 --year 2025
granted-scraper ingest-abinnovates
granted-scraper ingest-era
granted-scraper ingest-scaleai      ./scaleai_urls.json

# Re-granting bodies (Global Innovation Clusters, Genome Canada, Mitacs) — the
# federal feed only discloses the lump payment to these orgs, not who they
# re-fund, so we scrape each one's public funded-project directory:
granted-scraper ingest-ngen         # NGen (advanced manufacturing)
granted-scraper ingest-digital      # DIGITAL Technology Supercluster
granted-scraper ingest-pic          # Protein Industries Canada
granted-scraper ingest-ocean        # Canada's Ocean Supercluster
granted-scraper ingest-genome       # Genome Canada (research PIs + abstracts)
granted-scraper ingest-mitacs       # Mitacs (~4k industry-partnered projects)

# US / UK / AU (live public APIs — no file needed; default to a ~2-year window):
granted-scraper ingest-nsf          # NSF Awards API
granted-scraper ingest-nih          # NIH RePORTER API
granted-scraper ingest-ukri         # UKRI Gateway to Research (long scan)
granted-scraper ingest-arc          # ARC Data Portal API
granted-scraper ingest-grantconnect # AU GrantConnect (R&D/industry-filtered; --all for everything)

# Fill in any chunks that don't have an embedding yet:
granted-scraper embed-pending

# Bust the web app's 'use cache' tags:
granted-scraper revalidate search
```

Download URLs for each CSV are documented in the matching
`services/scraper/scraper/sources/*.py` file. The `*_data/` folders are
gitignored, so you bring your own.

### Schema bootstrap

The repo doesn't ship database migrations. You can rebuild the schema from the
code, but if you want a clean init script for a fresh Supabase project, the
tables and RPCs you need are:

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

If you want the actual SQL, open an issue or ask. Happy to share an init
snapshot. The schema isn't a secret, it just doesn't make sense to publish as
a history of 14 fix-up migrations.

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
│   │   ├── ai/                        Voyage embed + Claude chat + web search
│   │   ├── db/                        Supabase clients + hand-typed schema
│   │   ├── njf/                       spike finders (find.ts) + access/usage
│   │   ├── rag/                       search.ts, browse.ts, prepare-query.ts
│   │   ├── countries.ts               Country ↔ funding-source mapping (shared)
│   │   ├── filters.ts                 URL ↔ SearchFilters helpers
│   │   ├── ip.ts                      Rate-limit IP + constants
│   │   ├── locations.ts               Province + org-type auto-detect
│   │   └── resume.ts                  PDF text + GOAL/BACKGROUND splitter
│   └── next.config.ts
├── services/scraper/                  Python ingestion
│   └── scraper/
│       ├── sources/
│       │   ├── proactive.py           🇨🇦 Federal proactive disclosure CSV
│       │   │                             (incl. NSERC/SSHRC researcher rows)
│       │   ├── cihr.py                🇨🇦 CIHR Grants & Awards XLSX (abstracts)
│       │   ├── frq.py                 🇨🇦 Quebec FRQ CSV (S / NT / SC)
│       │   ├── cfi.py                 🇨🇦 CFI funded-projects HTML scraper
│       │   ├── abinnovates.py         🇨🇦 Alberta Innovates sitemap scraper
│       │   ├── era.py                 🇨🇦 ERA Alberta sitemap scraper
│       │   ├── scaleai.py             🇨🇦 Scale AI press-release scraper
│       │   ├── ngen.py                🇨🇦 NGen manufacturing directory scraper
│       │   ├── digital.py             🇨🇦 DIGITAL Supercluster scraper
│       │   ├── pic.py                 🇨🇦 Protein Industries Canada scraper
│       │   ├── ocean.py               🇨🇦 Ocean Supercluster scraper
│       │   ├── genome.py              🇨🇦 Genome Canada scraper (PIs+abstracts)
│       │   ├── mitacs.py              🇨🇦 Mitacs project scraper
│       │   ├── nsf.py                 🇺🇸 NSF Awards API
│       │   ├── nih.py                 🇺🇸 NIH RePORTER API
│       │   ├── ukri.py                🇬🇧 UKRI Gateway to Research API
│       │   ├── arc.py                 🇦🇺 ARC Data Portal API
│       │   └── grantconnect.py        🇦🇺 GrantConnect (R&D/industry-filtered)
│       ├── db.py                      Supabase client + retry/bulk helpers
│       ├── voyage.py                  Voyage REST wrapper
│       ├── normalize.py               Entity-resolution helpers
│       └── cli.py                     Typer commands (ingest-*, embed-pending)
└── supabase/                          Supabase project config (no migrations)
    └── config.toml
```

## Known limitations

- **Coverage depth is uneven across countries.** Canada is deep but partly
  lagging (FRQ pre-window); the US, UK, and Australia (GrantConnect)
  are the **last ~2 years** by design; ARC goes back to 2016. So "covered" means
  different time depths per country.
- **Amounts mix currencies.** Every grant's value sits in `amount_cad`
  regardless of currency (CAD/USD/GBP/AUD), so cross-country `$` totals (e.g. on
  `/stats`) are indicative only, not converted. A real fix needs a `currency`
  column + FX.
- **The region filter mixes provinces and states.** Canadian provinces and US
  state codes share one field; UK and Australian sources report no sub-national
  region, so they fall under "(unknown)".
- **Australian company coverage is GrantConnect-only and partial.** ARC funds
  university research only (no companies) and NHMRC couldn't be ingested
  (bot-protected). GrantConnect supplies AU companies but is R&D/industry-
  *filtered* from an all-of-government feed, and 8 high-volume months were
  truncated at a page cap — so AU `/jobs` coverage is real but thinner than
  CA/US/UK, and Australia's largest industry program (the R&D Tax Incentive)
  is excluded because it publishes no project descriptions.
- **SR&ED tax credits are confidential.** The biggest federal R&D channel in
  Canada (>$4B/year) is legally not disclosable per recipient. Treat the
  totals here as a *lower bound*.
- **Re-granting bodies are scraped, not complete.** Federal proactive disclosure
  only itemizes the lump payment to a Global Innovation Cluster / Genome Canada /
  Mitacs, not who they re-fund — so those sub-grants come from scraping each
  org's public project directory. Covered: NGen, DIGITAL, Protein Industries,
  Ocean Supercluster, Genome Canada, Mitacs (and Scale AI). Caveats: **DIGITAL
  only yields ~74 of 178 listed projects** (the rest are feasibility studies with
  no named funded partner); **Mitacs and Genome publish no per-project dollar
  amount** (so they don't narrow amount filters); the clusters mostly lack clean
  per-project dates. Still missing: the other clusters have no separate feed
  beyond this, and re-granters like the remaining Global Innovation Clusters'
  ecosystem streams aren't itemized anywhere public.
- **Fresh NSERC/SSHRC rows carry no project text.** NSERC's own awards
  dataset (real project titles + summaries) stops at FY2024, and its
  ingester has been retired — that FY2024 snapshot stays in the index as-is
  (those rows have no `start_date`, only `fiscal_year`). Newer NSERC and
  SSHRC coverage comes from the quarterly proactive disclosure feed, which
  names the researcher, program, university, amount, and dates — but no
  project title or abstract, so semantic matching on those rows leans on
  researcher + program + institution only.
- **Quebec FRQ is pre-window.** The latest FRQ data on donneesquebec.ca is
  FY2023-24, which is before the 2-year recency window. Still included
  because it's the only Quebec research-funding signal available.
- **Provincial coverage is uneven.** Alberta is well-covered (AB Innovates +
  ERA). Ontario, BC, and Atlantic provinces are covered only through
  whatever federal funds flowed to them. There are no provincial agency
  feeds yet for OCI, FedDev, Innovate BC, or ACOA-only programs.
- **Researcher search is partial.** NSERC/SSHRC proactive rows (2024-05 →)
  put the researcher's name in the indexed grant title, so searching a
  professor's name finds their recent grants. But the ~26k investigator
  names in the FY2024 NSERC snapshot and in FRQ live only in `grants.raw`
  JSONB and aren't indexed.
- **CFI lacks project descriptions.** Only fund-type, field of research,
  institution, year, and team members. Semantic match is rougher there.
- **Entity resolution is good, not perfect.** About 649 obvious duplicates
  were merged in a recent cleanup pass. Subsidiaries and regional campuses
  may still show up as separate entries.
- **Not real-time.** Federal proactive disclosure refreshes quarterly.
  Re-ingestion is manual.
- **Not a job board.** Granted shows you which organizations are actually
  building real tech with public R&D money. You still apply through their
  own channels.
