-- Sharing: people who open an invite link can view and edit that place
create table if not exists public.place_members (
  place_id uuid not null references public.places on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (place_id, user_id)
);
alter table public.place_members enable row level security;
create policy "my memberships" on public.place_members for select using (user_id = auth.uid());
create policy "leave a place" on public.place_members for delete using (user_id = auth.uid());
grant select, delete on public.place_members to authenticated;

alter table public.places add column if not exists share_code uuid unique;

-- owners do everything; members can read and edit, but not delete or change the owner
drop policy if exists "own rows" on public.places;
create policy "owner all" on public.places for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "members read" on public.places for select
  using (exists (select 1 from public.place_members m where m.place_id = id and m.user_id = auth.uid()));
create policy "members edit" on public.places for update
  using (exists (select 1 from public.place_members m where m.place_id = id and m.user_id = auth.uid()));
revoke update on public.places from authenticated;
grant update (name, doc, thumb, version, updated_at) on public.places to authenticated;

-- owner gets (or makes) the invite code for a place
create or replace function public.share_place(pid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  update places set share_code = coalesce(share_code, gen_random_uuid()) where id = pid and owner = auth.uid() returning share_code into c;
  return c;
end $$;

-- owner stops sharing: the link stops working and everyone else loses access
create or replace function public.unshare_place(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from places where id = pid and owner = auth.uid()) then
    update places set share_code = null where id = pid;
    delete from place_members where place_id = pid;
  end if;
end $$;

-- someone with the link joins the place
create or replace function public.join_place(code uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; own uuid;
begin
  select id, owner into pid, own from places where share_code = code;
  if pid is null then return null; end if;
  if own <> auth.uid() then insert into place_members (place_id, user_id) values (pid, auth.uid()) on conflict do nothing; end if;
  return pid;
end $$;

-- how many people a place is shared with (owner only)
create or replace function public.member_count(pid uuid) returns int
language sql security definer set search_path = public as $$
  select count(*)::int from place_members m join places p on p.id = m.place_id where m.place_id = pid and p.owner = auth.uid();
$$;

revoke execute on function public.share_place, public.unshare_place, public.join_place, public.member_count from public, anon;
grant execute on function public.share_place, public.unshare_place, public.join_place, public.member_count to authenticated;
