-- Toe to Toe: initial schema.
-- Safe to re-run where practical (if not exists / drop-then-create).
-- No `combos` table yet: it is planned for later and will arrive as a new migration (see docs/SUPABASE.md).
--
-- Access model: owner-only everywhere. Anonymous sign-in users have the
-- `authenticated` role in Supabase, so granting to `authenticated` covers guests.
-- The `anon` role (no sign-in at all) gets nothing.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Holds only a display name.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- puppets: a name plus the storage paths of three PNG drawings.
-- Object naming: <user id>/<puppet id>/head.png, sock.png, sword.png
-- ---------------------------------------------------------------------------
create table if not exists public.puppets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 32),
  head_path text not null,
  sock_path text not null,
  sword_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists puppets_owner_idx on public.puppets (owner);

-- Keep updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists puppets_set_updated_at on public.puppets;
create trigger puppets_set_updated_at
  before update on public.puppets
  for each row execute function public.set_updated_at();

-- Limit each owner to 50 puppets.
create or replace function public.enforce_puppet_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.puppets where owner = new.owner) >= 50 then
    raise exception 'Puppet limit reached (50 per account)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists puppets_limit on public.puppets;
create trigger puppets_limit
  before insert on public.puppets
  for each row execute function public.enforce_puppet_limit();

-- ---------------------------------------------------------------------------
-- Row-level security and grants for the tables.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.puppets enable row level security;

-- Supabase may grant default privileges to anon; remove them explicitly.
revoke all on public.profiles from anon;
revoke all on public.puppets from anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.puppets to authenticated;

-- (select auth.uid()) lets Postgres evaluate it once per query rather than per row.
drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "profiles delete own" on public.profiles;
create policy "profiles delete own" on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

drop policy if exists "puppets select own" on public.puppets;
create policy "puppets select own" on public.puppets
  for select to authenticated using ((select auth.uid()) = owner);

drop policy if exists "puppets insert own" on public.puppets;
create policy "puppets insert own" on public.puppets
  for insert to authenticated with check ((select auth.uid()) = owner);

drop policy if exists "puppets update own" on public.puppets;
create policy "puppets update own" on public.puppets
  for update to authenticated
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

drop policy if exists "puppets delete own" on public.puppets;
create policy "puppets delete own" on public.puppets
  for delete to authenticated using ((select auth.uid()) = owner);

-- ---------------------------------------------------------------------------
-- Storage: private bucket `puppets`, PNG only, 512 KB per file.
-- CHECK IN THE DASHBOARD (Storage > puppets): bucket is private, limit shows
-- 512 KB, allowed type is image/png. Column names on storage.buckets
-- (file_size_limit, allowed_mime_types) are current as far as I know.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('puppets', 'puppets', false, 524288, array['image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 524288,
      allowed_mime_types = array['image/png'];

-- Owner-only: the first folder of the object name must be the user's id.
-- storage.objects already has RLS enabled by Supabase (check in the dashboard
-- if the policies below seem not to apply).
drop policy if exists "puppets bucket select own" on storage.objects;
create policy "puppets bucket select own" on storage.objects
  for select to authenticated
  using (bucket_id = 'puppets' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "puppets bucket insert own" on storage.objects;
create policy "puppets bucket insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'puppets' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "puppets bucket update own" on storage.objects;
create policy "puppets bucket update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'puppets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'puppets' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "puppets bucket delete own" on storage.objects;
create policy "puppets bucket delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'puppets' and (storage.foldername(name))[1] = (select auth.uid())::text);
