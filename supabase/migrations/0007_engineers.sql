-- 0007_engineers.sql
-- "Engineers" section: for a Canadian company already in the `companies` table,
-- a cached directory of its engineers sourced from the GitHub API (public org
-- members when the company has a resolvable GitHub org, otherwise users whose
-- GitHub profile lists the company). Replaces the LinkedIn-scraping /explore.
--
-- NOTE: this project applies schema directly via SUPABASE_DB_URL / the Supabase
-- dashboard (there is no migration runner wired up). Apply with:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0007_engineers.sql
--
-- The lib/engineers code treats these tables as a best-effort cache: until this
-- migration is applied it falls back to live GitHub calls on every request, so
-- the feature works before the schema lands and simply starts caching after.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- A cached directory of engineers for one Canadian company. Keyed by the
-- normalized company name so "Shopify" / "shopify " collapse to one row, and
-- pinned to the `companies` row it was resolved from.
create table if not exists engineer_directories (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references companies(id) on delete cascade,
  company_name    text not null,             -- display name, from the companies row
  company_norm    text not null,             -- lower(trim(company_name))
  -- 'org'    → listed from a GitHub org's public members
  -- 'search' → GitHub user search by the `company:` profile field
  source          text not null default 'search' check (source in ('org', 'search')),
  github_org      text,                      -- resolved org login, when source = 'org'
  status          text not null default 'pending'
                    check (status in ('pending', 'ready', 'failed')),
  engineer_count  int not null default 0,
  error           text,
  fetched_at      timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (company_norm)
);

-- One engineer in a directory. Only public GitHub profile fields are stored;
-- `raw` keeps the API payload for debugging but is never rendered to users.
create table if not exists engineers (
  id              uuid primary key default gen_random_uuid(),
  directory_id    uuid not null references engineer_directories(id) on delete cascade,
  github_id       bigint not null,           -- GitHub's numeric user id
  login           text not null,
  name            text,
  avatar_url      text,
  html_url        text,
  bio             text,
  company         text,                      -- the `company` field on their profile
  location        text,
  blog            text,
  followers       int not null default 0,
  public_repos    int not null default 0,
  top_languages   text[] not null default '{}',
  hireable        boolean,
  raw             jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists engineers_directory_idx on engineers (directory_id);

-- Per-IP rate limiting (mirrors compete_log). One row per directory lookup that
-- hit the GitHub API. GitHub is free but token-rate-limited, so the cap guards
-- the shared token rather than a dollar cost. Reset for testing:
--   delete from engineers_log where ip = '<the IP>';
create table if not exists engineers_log (
  id          uuid primary key default gen_random_uuid(),
  company     text,
  source      text,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists engineers_log_ip_idx on engineers_log (ip);
