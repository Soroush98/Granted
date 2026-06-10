-- Accounts + 30-Day Job Hunt Pass.
--
-- Search access moves from purely per-IP to per-identity:
--   anonymous  → consume_quota('anon:<ip>', …)     (small free taste)
--   free acct  → consume_quota('free:<userId>', …)  (full free allowance)
--   active pass→ consume_pass_credit(userId, cost)  (credits ledger, below)
-- The pass needs a CREDITS LEDGER rather than consume_quota's fixed calendar
-- windows, because a 30-day pass starts at purchase time, not a calendar edge.

-- One row per buyer; a re-purchase tops the same row back up (see webhook).
create table if not exists public.passes (
  user_id           uuid        primary key references auth.users (id) on delete cascade,
  status            text        not null default 'active',  -- 'active' | 'expired'
  expires_at        timestamptz not null,
  credits_remaining integer     not null default 0,
  stripe_session_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.passes enable row level security;

-- Owners may read their own pass (to show "credits left"); all writes are
-- service-role only (the webhook + the gating function run as service role,
-- which bypasses RLS — so no write policy is granted to authenticated users).
drop policy if exists passes_select_own on public.passes;
create policy passes_select_own on public.passes
  for select using (auth.uid() = user_id);

-- Atomically spend `cost_in` credits from an active, unexpired pass. Returns
-- whether it was allowed and the remaining balance. Mirrors the locked
-- single-statement pattern of consume_quota (no read-then-write race).
create or replace function public.consume_pass_credit(user_id_in uuid, cost_in integer)
returns table (allowed boolean, remaining integer)
language plpgsql
as $$
declare
  new_remaining integer;
begin
  update public.passes
     set credits_remaining = credits_remaining - cost_in,
         updated_at = now()
   where user_id = user_id_in
     and status = 'active'
     and expires_at > now()
     and credits_remaining >= cost_in
  returning credits_remaining into new_remaining;

  if new_remaining is null then
    -- Not spendable (no pass / expired / insufficient). Report the current
    -- balance if a row exists, else 0.
    select coalesce(p.credits_remaining, 0) into new_remaining
      from public.passes p where p.user_id = user_id_in;
    return query select false, coalesce(new_remaining, 0);
  else
    return query select true, new_remaining;
  end if;
end;
$$;

-- Webhook idempotency: each Stripe event id is processed at most once.
create table if not exists public.stripe_events (
  id         text        primary key,
  created_at timestamptz not null default now()
);

-- Analytics: attribute a logged-in user's searches (nullable for anonymous).
alter table public.search_log add column if not exists user_id uuid;
