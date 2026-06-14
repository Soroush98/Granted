-- User profiles, populated on signup by a trigger on auth.users.
--
-- Captures DB state that had been applied out-of-band via the Supabase
-- "User Profiles & Roles with RLS" template. The template's TRIGGER + FUNCTION
-- existed in the live DB but the `profiles` TABLE did not, so every signup
-- failed with "Database error saving new user" — handle_new_user()'s insert hit
-- a missing relation and rolled back the auth.users insert. This migration makes
-- the whole setup authoritative in the repo (idempotent; safe to re-apply).

create table if not exists public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  full_name  text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Private by default: a user can see and edit only their own profile. The
-- trigger below is SECURITY DEFINER, so it inserts regardless of these policies.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);

-- Create a profile row for each new user. SECURITY DEFINER to bypass RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
