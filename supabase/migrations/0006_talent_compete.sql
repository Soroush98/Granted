-- 0006_talent_compete.sql
-- "Am I Competitive?" section: cohorts of LinkedIn-style profiles for a
-- (company, role) pair, used to benchmark a user's resume against the people
-- already in that role.
--
-- NOTE: this project applies schema directly via SUPABASE_DB_URL / the Supabase
-- dashboard (there is no migration runner wired up). Apply with:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0006_talent_compete.sql
--
-- Embeddings are stored as jsonb arrays (not pgvector) on purpose: cohorts are
-- tiny (~20 rows) so cosine similarity is computed in app code, and jsonb round-
-- trips back through supabase-js as a plain JS number[] with no vector-string
-- parsing. Add an HNSW pgvector column later if cohorts grow past ~50.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- A cached set of profiles for one (company, role). Keyed by normalized forms
-- so "Amii" / "amii" / "data engineer" / "Data Engineer " collapse to one row.
create table if not exists talent_cohorts (
  id                  uuid primary key default gen_random_uuid(),
  company_name        text not null,            -- display, as the user typed it
  company_norm        text not null,            -- lower(trim(company_name))
  company_linkedin_url text,
  role_query          text not null,            -- display, as the user typed it
  normalized_role     text not null,            -- lower(trim(role_query))
  source              text not null default 'apify',
  apify_run_id        text,
  status              text not null default 'pending'
                        check (status in ('pending', 'ready', 'failed')),
  profile_count       int not null default 0,
  error               text,
  fetched_at          timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (company_norm, normalized_role)
);

-- One person in a cohort. Only public profile fields are stored; `raw` keeps the
-- provider payload for debugging but is never rendered to users.
create table if not exists talent_profiles (
  id                uuid primary key default gen_random_uuid(),
  cohort_id         uuid not null references talent_cohorts(id) on delete cascade,
  full_name         text not null,
  headline          text,
  linkedin_url      text,
  location          text,
  current_title     text,
  current_company   text,
  summary           text,
  skills            text[] not null default '{}',
  experience        jsonb,
  education         jsonb,
  years_experience  numeric,
  embedding         jsonb,        -- number[] (Voyage voyage-3.5, 1024-dim)
  raw               jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists talent_profiles_cohort_idx
  on talent_profiles (cohort_id);

-- Analytics + per-IP rate limiting (mirrors search_log). One row per analysis.
create table if not exists compete_log (
  id          uuid primary key default gen_random_uuid(),
  company     text,
  role        text,
  verdict     text,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists compete_log_ip_idx on compete_log (ip);
