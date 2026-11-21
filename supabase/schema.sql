-- One row per place; each signed-in person only sees their own rows
create table public.places (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  doc jsonb not null,
  thumb text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.places enable row level security;
create policy "own rows" on public.places for all
  using (owner = auth.uid()) with check (owner = auth.uid());
-- Newer Supabase projects don't grant table access automatically
grant select, insert, update, delete on public.places to authenticated;

-- Then run 002_sharing.sql for invite-link sharing
