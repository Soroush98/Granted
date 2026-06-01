-- 0009_gh_people.sql
-- Bounded "high-value pool" of Canadian developers on GitHub, crawled
-- person-first (location:<city> language:<lang>, sorted by followers) rather
-- than company-first. Each person carries their self-reported `company` field,
-- which is fuzzy-mapped to the companies table so the intro/engineers features
-- can surface a referral target even when a company has no public GitHub org.
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0009_gh_people.sql

create table if not exists gh_people (
  github_id         bigint primary key,        -- GitHub numeric user id
  login             text not null,
  name              text,
  avatar_url        text,
  html_url          text,
  bio               text,
  company           text,                       -- raw GitHub `company` field
  company_norm      text,                       -- lower(trim), '@' stripped
  mapped_company_id uuid references companies(id) on delete set null,
  location          text,
  blog              text,
  followers         int not null default 0,
  public_repos      int not null default 0,
  top_languages     text[] not null default '{}',
  hireable          boolean,
  source_shard      text,                       -- "city|language" that surfaced them
  fetched_at        timestamptz not null default now()
);

create index if not exists gh_people_company_norm_idx on gh_people (company_norm);
create index if not exists gh_people_mapped_idx on gh_people (mapped_company_id);
create index if not exists gh_people_followers_idx on gh_people (followers desc);

-- Per-(city,language,page) crawl progress, so the sharded crawl is resumable:
-- a finished page drops out and repeated driver runs converge.
create table if not exists gh_people_shards (
  shard       text primary key,                -- "city|language|page"
  city        text,
  language    text,
  page        int,
  total_count int,                             -- GitHub total_count for the shard
  found       int,                             -- logins returned on this page
  done_at     timestamptz not null default now()
);
