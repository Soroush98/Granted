-- Rate limiting for the AI search surfaces (/search, /jobs, /supervisors,
-- /research-pi). Each of these spends Voyage (embed) + Claude (rerank / spike
-- extraction) credits per run, so we cap usage per client and globally.
--
-- Design: a single fixed-window counter table plus an ATOMIC check-and-increment
-- function. The increment only fires when the window is under its cap, so the
-- "is it allowed?" check and the "+1" happen in one locked statement — no
-- read-then-write race (the flaw in the old search_log-row-counting approach,
-- which read the count, then wrote the row later in after()).
--
-- The app layers three buckets through this one function:
--   burst:<ip>  max 3   / 600s    -- stops tight loops from one address
--   day:<ip>    max 10  / 86400s  -- daily per-IP allowance
--   global      max 2000/ 86400s  -- circuit breaker on total daily spend
--
-- search_log (below) is kept PURELY for analytics now — it no longer governs
-- access. recent_search_count() is left in place but unused by the app.

create table if not exists public.rate_limit (
  bucket       text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket, window_start)
);

-- Lets a periodic job reclaim old windows: delete from rate_limit where window_start < now() - interval '2 days';
create index if not exists rate_limit_window_start_idx on public.rate_limit (window_start);

-- Atomically record one hit against (bucket, current window) and report whether
-- it is allowed. Returns the post-increment count and when the window resets.
create or replace function public.consume_quota(
  bucket_in   text,
  max_in      integer,
  window_secs integer
)
returns table (allowed boolean, used integer, reset_at timestamptz)
language plpgsql
as $$
declare
  w_start   timestamptz := to_timestamp(
    floor(extract(epoch from now()) / window_secs) * window_secs
  );
  new_count integer;
begin
  -- The WHERE on the conflict path means: only increment if still under the
  -- cap. When already at the cap, RETURNING yields no row and new_count stays
  -- NULL, which we read back as "not allowed".
  insert into public.rate_limit (bucket, window_start, count)
  values (bucket_in, w_start, 1)
  on conflict (bucket, window_start)
    do update set count = public.rate_limit.count + 1
    where public.rate_limit.count < max_in
  returning count into new_count;

  if new_count is null then
    select count into new_count
    from public.rate_limit
    where bucket = bucket_in and window_start = w_start;
    return query select false, new_count, w_start + make_interval(secs => window_secs);
  else
    return query select true, new_count, w_start + make_interval(secs => window_secs);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics log (already exists in the live project; captured here so the
-- schema is versioned). Created only if missing — never drops existing data.
create table if not exists public.search_log (
  id           uuid        primary key default gen_random_uuid(),
  query        text        not null,
  org_filter   text,
  result_count integer,
  ip           text,
  created_at   timestamptz not null default now()
);
create index if not exists search_log_created_at_idx on public.search_log (created_at);
