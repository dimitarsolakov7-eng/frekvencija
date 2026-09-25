-- =============================================================================
-- Venue Radio — access control (docs/ARCHITECTURE.md §5.4, §5.5, §5.7)
--
-- 1. private.* helper functions used by the RLS policies (SECURITY DEFINER,
--    so they read membership/catalogue tables without recursing into RLS).
-- 2. Explicit table privileges. Supabase no longer auto-grants new public
--    tables to anon/authenticated/service_role, so every grant is spelled out
--    and `anon` gets nothing.
-- 3. RLS policies (RLS itself was enabled in 20260925000100 at table creation).
-- 4. RPCs for admin writes that must be atomic, plus genre track counts.
--
-- Policies wrap row-independent calls in (select …) so Postgres evaluates them
-- once per statement (InitPlan) instead of once per row.
-- =============================================================================

begin;

grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'platform_admin'
  );
$$;

-- The caller's business, whatever its status (business_members.user_id is unique).
create or replace function private.member_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
    from public.business_members m
   where m.user_id = (select auth.uid());
$$;

-- The caller's business only while it is active; null otherwise. Every content
-- policy (genres, tracks, announcements, media) goes through this, which is how
-- an inactive venue loses access to everything but its own business row.
create or replace function private.active_member_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
    from public.business_members m
    join public.businesses b on b.id = m.business_id
   where m.user_id = (select auth.uid())
     and b.is_active;
$$;

-- Accessible ⇔ genre enabled AND (available to all OR access row) AND business active.
create or replace function private.genre_accessible(p_business_id uuid, p_genre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.genres g
      join public.businesses b on b.id = p_business_id
     where g.id = p_genre_id
       and g.is_enabled
       and b.is_active
       and (
         g.available_to_all
         or exists (
           select 1
             from public.business_genre_access a
            where a.business_id = p_business_id
              and a.genre_id = p_genre_id
         )
       )
  );
$$;

-- A playable track linked to at least one genre accessible to the caller's active business.
create or replace function private.track_accessible(p_track_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tracks t
      join public.track_genres tg on tg.track_id = t.id
     where t.id = p_track_id
       and t.is_active
       and t.removed_at is null
       and private.genre_accessible((select private.active_member_business_id()), tg.genre_id)
  );
$$;

create or replace function private.track_object_accessible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tracks t
     where t.storage_path = p_name
       and private.track_accessible(t.id)
  );
$$;

-- A playable announcement of the caller's active business stores its audio at p_name.
-- Playable ⇔ active, not awaiting review, has audio, approved at the current branding version.
create or replace function private.announcement_object_accessible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.announcements a
      join public.businesses b on b.id = a.business_id
     where a.audio_path = p_name
       and a.business_id = (select private.active_member_business_id())
       and a.status = 'active'
       and not a.needs_review
       and a.branding_version = b.branding_version
       and b.is_active
  );
$$;

create or replace function private.logo_object_accessible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.businesses b
     where b.id = (select private.member_business_id())
       and b.logo_path = p_name
  );
$$;

-- Functions are executable by PUBLIC by default; restrict to the API roles that
-- evaluate policies. `private` is not an exposed schema, so these are not RPCs.
revoke execute on function private.is_platform_admin() from public, anon;
revoke execute on function private.member_business_id() from public, anon;
revoke execute on function private.active_member_business_id() from public, anon;
revoke execute on function private.genre_accessible(uuid, uuid) from public, anon;
revoke execute on function private.track_accessible(uuid) from public, anon;
revoke execute on function private.track_object_accessible(text) from public, anon;
revoke execute on function private.announcement_object_accessible(text) from public, anon;
revoke execute on function private.logo_object_accessible(text) from public, anon;

grant execute on function private.is_platform_admin() to authenticated, service_role;
grant execute on function private.member_business_id() to authenticated, service_role;
grant execute on function private.active_member_business_id() to authenticated, service_role;
grant execute on function private.genre_accessible(uuid, uuid) to authenticated, service_role;
grant execute on function private.track_accessible(uuid) to authenticated, service_role;
grant execute on function private.track_object_accessible(text) to authenticated, service_role;
grant execute on function private.announcement_object_accessible(text) to authenticated, service_role;
grant execute on function private.logo_object_accessible(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Table privileges (RLS decides which rows; these decide which statements)
-- -----------------------------------------------------------------------------

revoke all on table
  public.profiles,
  public.businesses,
  public.business_members,
  public.genres,
  public.business_genre_access,
  public.tracks,
  public.track_genres,
  public.announcements,
  public.playback_preferences
from public, anon, authenticated;

-- profiles: readable; only full_name is writable by the user (role/email are not).
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

-- Admin-managed tables: DML allowed, policies restrict writes to platform admins.
grant select, insert, update, delete on table
  public.businesses,
  public.business_members,
  public.genres,
  public.business_genre_access,
  public.tracks,
  public.track_genres,
  public.announcements,
  public.playback_preferences
to authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.businesses,
  public.business_members,
  public.genres,
  public.business_genre_access,
  public.tracks,
  public.track_genres,
  public.announcements,
  public.playback_preferences
to service_role;

-- -----------------------------------------------------------------------------
-- 3. Policies (role authenticated only; anon has no privileges at all)
-- -----------------------------------------------------------------------------

-- profiles --------------------------------------------------------------------
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_platform_admin()));

-- Column grant limits this to full_name; the guard trigger backs up the role column.
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- businesses ------------------------------------------------------------------
create policy "businesses: read own or admin" on public.businesses
  for select to authenticated
  using (id = (select private.member_business_id()) or (select private.is_platform_admin()));

create policy "businesses: admin insert" on public.businesses
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "businesses: admin update" on public.businesses
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "businesses: admin delete" on public.businesses
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- business_members ------------------------------------------------------------
create policy "business_members: read own or admin" on public.business_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

create policy "business_members: admin insert" on public.business_members
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "business_members: admin update" on public.business_members
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "business_members: admin delete" on public.business_members
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- genres ----------------------------------------------------------------------
create policy "genres: read accessible or admin" on public.genres
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or private.genre_accessible((select private.active_member_business_id()), id)
  );

create policy "genres: admin insert" on public.genres
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "genres: admin update" on public.genres
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "genres: admin delete" on public.genres
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- business_genre_access -------------------------------------------------------
create policy "business_genre_access: read own or admin" on public.business_genre_access
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or business_id = (select private.member_business_id())
  );

create policy "business_genre_access: admin insert" on public.business_genre_access
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "business_genre_access: admin update" on public.business_genre_access
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "business_genre_access: admin delete" on public.business_genre_access
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- tracks ----------------------------------------------------------------------
create policy "tracks: read accessible or admin" on public.tracks
  for select to authenticated
  using ((select private.is_platform_admin()) or private.track_accessible(id));

create policy "tracks: admin insert" on public.tracks
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "tracks: admin update" on public.tracks
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "tracks: admin delete" on public.tracks
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- track_genres ----------------------------------------------------------------
create policy "track_genres: read accessible or admin" on public.track_genres
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or (
      private.genre_accessible((select private.active_member_business_id()), genre_id)
      and private.track_accessible(track_id)
    )
  );

create policy "track_genres: admin insert" on public.track_genres
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "track_genres: admin update" on public.track_genres
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "track_genres: admin delete" on public.track_genres
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- announcements ---------------------------------------------------------------
-- Business users see only their own *playable* announcements (§5.2).
create policy "announcements: read playable own or admin" on public.announcements
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or (
      business_id = (select private.active_member_business_id())
      and status = 'active'
      and not needs_review
      and audio_path is not null
      and branding_version = (
        select b.branding_version
          from public.businesses b
         where b.id = (select private.active_member_business_id())
      )
    )
  );

create policy "announcements: admin insert" on public.announcements
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy "announcements: admin update" on public.announcements
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "announcements: admin delete" on public.announcements
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- playback_preferences --------------------------------------------------------
create policy "playback_preferences: read own" on public.playback_preferences
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and business_id = (select private.member_business_id())
  );

create policy "playback_preferences: insert own" on public.playback_preferences
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and business_id = (select private.member_business_id())
    and (genre_id is null or private.genre_accessible(business_id, genre_id))
  );

create policy "playback_preferences: update own" on public.playback_preferences
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and business_id = (select private.member_business_id())
  )
  with check (
    user_id = (select auth.uid())
    and business_id = (select private.member_business_id())
    and (genre_id is null or private.genre_accessible(business_id, genre_id))
  );

create policy "playback_preferences: delete own" on public.playback_preferences
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and business_id = (select private.member_business_id())
  );

-- rate_limit_buckets: RLS enabled, deliberately no policies (see 20260925000100).

-- -----------------------------------------------------------------------------
-- 4. RPCs (SECURITY INVOKER: the caller's grants and RLS still apply)
-- -----------------------------------------------------------------------------

-- Raises 42501 unless the caller is a platform admin or the service role
-- (seed/maintenance scripts using the secret key).
create or replace function private.assert_platform_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and not coalesce(private.is_platform_admin(), false) then
    raise exception 'Only platform admins can perform this action'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.assert_platform_admin() from public, anon;
grant execute on function private.assert_platform_admin() to authenticated, service_role;

-- Rejects null arrays, null elements and duplicates (22004 / 22023).
create or replace function private.assert_uuid_set(p_ids uuid[], p_label text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_ids is null then
    raise exception '% must not be null', p_label using errcode = '22004';
  end if;
  if array_position(p_ids, null) is not null then
    raise exception '% must not contain null', p_label using errcode = '22004';
  end if;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) as u(x)) then
    raise exception '% must not contain duplicates', p_label using errcode = '22023';
  end if;
end;
$$;

revoke execute on function private.assert_uuid_set(uuid[], text) from public, anon;
grant execute on function private.assert_uuid_set(uuid[], text) to authenticated, service_role;

-- Sets genres.sort_order to the 1-based position in p_genre_ids. Genres that are
-- not listed (e.g. created meanwhile by another admin) keep their relative order
-- and are placed after the listed ones, so the ordering is always total.
create or replace function public.reorder_genres(p_genre_ids uuid[])
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_missing uuid;
begin
  perform private.assert_platform_admin();
  perform private.assert_uuid_set(p_genre_ids, 'p_genre_ids');

  select u.id into v_missing
    from unnest(p_genre_ids) as u(id)
   where not exists (select 1 from public.genres g where g.id = u.id)
   limit 1;
  if v_missing is not null then
    raise exception 'Genre % does not exist', v_missing using errcode = '23503';
  end if;

  with listed as (
    select u.id, u.ord::integer as position
      from unnest(p_genre_ids) with ordinality as u(id, ord)
  ),
  unlisted as (
    select g.id,
           (cardinality(p_genre_ids) + row_number() over (order by g.sort_order, lower(g.name), g.id))::integer as position
      from public.genres g
     where g.id <> all (p_genre_ids)
  ),
  target as (
    select id, position from listed
    union all
    select id, position from unlisted
  )
  update public.genres g
     set sort_order = t.position
    from target t
   where g.id = t.id
     and g.sort_order is distinct from t.position;
end;
$$;

-- Replaces the set of exclusive genres assigned to a business.
create or replace function public.set_business_genre_access(p_business_id uuid, p_genre_ids uuid[])
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  if p_business_id is null then
    raise exception 'p_business_id must not be null' using errcode = '22004';
  end if;
  perform private.assert_uuid_set(p_genre_ids, 'p_genre_ids');
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Business % does not exist', p_business_id using errcode = '23503';
  end if;

  delete from public.business_genre_access a
   where a.business_id = p_business_id
     and a.genre_id <> all (p_genre_ids);

  -- Unknown genre ids fail the foreign key (23503) and roll the whole call back.
  insert into public.business_genre_access (business_id, genre_id)
  select p_business_id, u.id
    from unnest(p_genre_ids) as u(id)
  on conflict (business_id, genre_id) do nothing;
end;
$$;

-- Replaces the set of genres a track belongs to.
create or replace function public.set_track_genres(p_track_id uuid, p_genre_ids uuid[])
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  if p_track_id is null then
    raise exception 'p_track_id must not be null' using errcode = '22004';
  end if;
  perform private.assert_uuid_set(p_genre_ids, 'p_genre_ids');
  if not exists (select 1 from public.tracks t where t.id = p_track_id) then
    raise exception 'Track % does not exist', p_track_id using errcode = '23503';
  end if;

  delete from public.track_genres tg
   where tg.track_id = p_track_id
     and tg.genre_id <> all (p_genre_ids);

  insert into public.track_genres (track_id, genre_id)
  select p_track_id, u.id
    from unnest(p_genre_ids) as u(id)
  on conflict (track_id, genre_id) do nothing;
end;
$$;

-- Per visible genre: playable tracks (active, not removed) and all linked tracks.
-- SECURITY INVOKER, so it only counts rows the caller can see: admins get the
-- whole catalogue; business users only see accessible genres and playable tracks.
create or replace function public.genre_track_counts()
returns table (genre_id uuid, playable_count integer, total_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.id,
         (count(t.id) filter (where t.is_active and t.removed_at is null))::integer,
         count(t.id)::integer
    from public.genres g
    left join public.track_genres tg on tg.genre_id = g.id
    left join public.tracks t on t.id = tg.track_id
   group by g.id;
$$;

revoke execute on function public.reorder_genres(uuid[]) from public, anon;
revoke execute on function public.set_business_genre_access(uuid, uuid[]) from public, anon;
revoke execute on function public.set_track_genres(uuid, uuid[]) from public, anon;
revoke execute on function public.genre_track_counts() from public, anon;

grant execute on function public.reorder_genres(uuid[]) to authenticated, service_role;
grant execute on function public.set_business_genre_access(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.set_track_genres(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.genre_track_counts() to authenticated, service_role;

commit;
