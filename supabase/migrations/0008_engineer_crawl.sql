-- 0008_engineer_crawl.sql
-- Batch driver for warming the engineer_directories cache across the
-- top-funded Canadian companies. next_engineer_crawl_batch returns the next
-- slice of the top `max_companies` companies (ranked by recipient grant
-- funding) that still need crawling — i.e. that have no directory yet, or whose
-- directory is a stale 'ready' (expired) or a 'failed' row worth retrying.
-- 'ready' rows with a future expires_at (including empty 0-engineer results)
-- drop out, so repeated calls converge and the crawl is resumable.
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0008_engineer_crawl.sql

create or replace function next_engineer_crawl_batch(
  max_companies int default 300,
  batch_size    int default 6
)
returns table (
  id           uuid,
  display_name text,
  province     text,
  city         text,
  website      text
)
language sql
stable
as $$
  with ranked as (
    select c.id, c.display_name, c.province, c.city, c.website,
           sum(g.amount_cad) as total
    from companies c
    join grants g on g.recipient_id = c.id
    -- Universities fragment across dozens of dept/club orgs and government
    -- bodies have no engineering org — both only produced false positives, so
    -- skip them to raise yield-per-call and precision.
    where c.org_type not in ('university', 'government')
    group by c.id, c.display_name, c.province, c.city, c.website
    order by sum(g.amount_cad) desc nulls last
    limit max_companies
  )
  select r.id, r.display_name, r.province, r.city, r.website
  from ranked r
  left join engineer_directories d
    on d.company_norm = lower(btrim(regexp_replace(r.display_name, '\s+', ' ', 'g')))
  where d.id is null
     or (d.status = 'ready' and (d.expires_at is null or d.expires_at < now()))
     or d.status = 'failed'
  order by r.total desc nulls last
  limit batch_size;
$$;
