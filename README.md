# Granted

Find Canadian companies and labs actually doing the work you want to do — by indexing their federal R&D funding history and matching it against your background.

- **Web** (`apps/web`): Next.js 16 + React 19, App Router, `'use cache'` + cacheTag, PPR, Server Actions, React Compiler, Turbopack.
- **Scraper** (`services/scraper`): Python 3.12 + httpx + selectolax — ingests NSERC and Scale AI for v0.
- **AI**: 100% local via [Ollama](https://ollama.com) — `gemma2:2b` for rerank/classification, `nomic-embed-text` for embeddings. No API keys, no per-call cost.
- **Data** (`supabase/`): Postgres + pgvector(768) + tsvector, hybrid search RPC.

## Architecture

```
                  ┌──────────────────────┐
                  │  apps/web (Next 16)  │
                  │                      │
   user ───────►  │  /search ─► hybrid   │
                  │  search_companies    │
                  │      │               │
                  │      ▼               │
                  │  Ollama rerank (JSON)│
                  │  ◄── Ollama embed    │
                  └──────────┬───────────┘
                             │ reads (RLS, anon)
                             ▼
                  ┌──────────────────────┐
                  │  Supabase Postgres   │
                  │  + pgvector          │
                  └──────────▲───────────┘
                             │ writes (service role)
                             │
                  ┌──────────┴───────────┐
                  │  services/scraper    │
                  │                      │
                  │  NSERC awards CSV    │
                  │  Scale AI projects   │
                  │      │               │
                  │      ▼               │
                  │  Ollama embed   ────►│
                  └──────────────────────┘
```

## What's in the database

| Table | What it holds |
|---|---|
| `funding_programs` | NSERC Discovery / Alliance / CRD, Scale AI, IRAP, SIF, CFI. Seeded by the migration. |
| `companies` | Recipients + partners. `org_type` discriminates company / university / institute / etc. |
| `grants` | One row per disclosed award. `recipient_id` → companies; partners go in `grant_partners`. |
| `grant_partners` | Industry-partner / academic-partner attachments for Alliance + Scale AI grants. |
| `grant_chunks` | RAG corpus — title and description chunks with `vector(768)` embeddings and a tsvector index. |
| `search_log` | Fire-and-forget search audit trail. |

The search RPC is `public.search_companies(query_embedding, query_text, match_count, org_filter)` — same hybrid (vector + FTS) shape as the previous Proffinder schema, but it returns companies via their best matching chunk.

## Setup

### 0. Prereqs

- Node 20.18+, pnpm 9+
- Python 3.12+
- Supabase CLI (`brew install supabase/tap/supabase`) — optional, only if you want to run migrations via the CLI
- [Ollama](https://ollama.com) (`brew install ollama`)

```bash
# Start Ollama (Mac):
brew services start ollama

# Pull the local models.
ollama pull gemma2:2b               # rerank + classification
ollama pull nomic-embed-text        # 768-dim embeddings

# Sanity check:
curl http://localhost:11434/api/tags
```

### 1. Database

Apply the v0 migration to your Supabase project. The easiest path is the SQL editor in the Supabase dashboard — paste the contents of `supabase/migrations/0005_granted_v0.sql` and run it. This **drops** any Proffinder-era tables.

If you've got the Supabase CLI linked:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

The migration seeds the `funding_programs` table with NSERC, Scale AI, IRAP, SIF, and CFI.

### 2. Web app

```bash
cp .env.example apps/web/.env.local
# fill in NEXT_PUBLIC_SUPABASE_URL / *_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
pnpm install
pnpm dev
# http://localhost:3000
```

### 3. Ingest data

```bash
cd services/scraper
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REVALIDATE_SECRET

# Download the NSERC awards CSV(s) from open.canada.ca:
# https://open.canada.ca/data/en/dataset/c1b0f627-8c29-427c-ab73-33968ad9176e
# Save them anywhere. Then:
granted-scraper ingest-nserc ./nserc-awards-2024.csv --limit 1000

# Scale AI: provide a JSON list of project URLs:
echo '["https://www.scaleai.ca/projects/example-project/"]' > scaleai_urls.json
granted-scraper ingest-scaleai scaleai_urls.json

# Embed everything that hasn't been embedded yet:
granted-scraper embed-pending

# Bust the web app's cache:
granted-scraper revalidate search
```

## Latest Next.js 16 APIs in use

- **`'use cache'`** + `cacheLife()` + `cacheTag()` — `lib/rag/search.ts`, `app/companies/[id]/page.tsx`.
- **`cacheComponents: true`** in `next.config.ts` — modern cache model (PPR successor).
- **PPR** — `app/search/page.tsx` renders a static shell and streams `<Results>` via `<Suspense>`.
- **`<Form>` from `next/form`** — `app/page.tsx`, `app/search/page.tsx`.
- **`after()` from `next/server`** — `app/search/results.tsx` logs the query *after* streaming the response.
- **`async params` / `async searchParams`** — `/companies/[id]` and `/search`.
- **`revalidateTag`** webhook — `app/api/revalidate/route.ts` lets the scraper bust cache tags.
- **React Compiler** + **Turbopack** — both on by default in Next 16.

## How matching works

1. The user's free-text query (goal + optional PDF resume) is normalized and embedded with `nomic-embed-text`.
2. `public.search_companies` blends `embedding <=> query` (cosine) with `ts_rank_cd` over a tsvector → top 10 candidate organizations, each with their best-matching grant chunk.
3. `gemma2:2b` via Ollama (JSON mode) reranks the 10 down to 5 with a one-sentence rationale citing the actual overlap.

Per-search latency on Apple Silicon: ~2–4 seconds with a warm model. All inference is local.

## Known limitations

- **SR&ED tax credits — Canada's single biggest federal R&D channel ($4B+/year) — are confidential** and not in this dataset. Funding totals here are a lower bound.
- **Updates are quarterly at best.** Government open-data refreshes lag real announcements.
- **Entity resolution is crude** (lowercase + strip suffixes). "Cohere Inc." and "Cohere AI" will sometimes appear as separate companies until you backfill a manual merge.
- **Coverage gaps**: SIF, CFI, IRAP, and provincial programs are stubbed in the schema but not ingested in v0.

## Project layout

```
.
├── apps/web/                Next.js 16 app
│   ├── app/                 App Router
│   │   ├── companies/[id]   Company / org detail page
│   │   └── search           Search + results
│   ├── lib/
│   │   ├── ai/              Ollama embed + chat
│   │   ├── db/              Supabase clients + types
│   │   └── rag/             Hybrid search + rerank
│   └── next.config.ts
├── services/scraper/        Python ingestion
│   └── scraper/
│       ├── sources/
│       │   ├── nserc.py     NSERC awards CSV ingester
│       │   └── scaleai.py   Scale AI HTML scraper
│       ├── db.py
│       ├── ollama.py
│       ├── normalize.py     Entity-resolution helpers
│       └── cli.py
└── supabase/                Schema + seed
    └── migrations/
```

## License

MIT
