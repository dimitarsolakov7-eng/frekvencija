-- =============================================================================
-- Frekvencija redesign — data model additions (docs/REDESIGN.md §3,
-- docs/ARCHITECTURE.md §5.8)
--
-- 1. business_type enum + businesses.business_type
-- 2. genres.cover_path (object in the new private bucket `genre-covers`)
-- 3. access_request_status enum + access_requests (public "Request access" form)
-- 4. platform_settings singleton (contact details, policies, defaults)
-- 5. private.genre_cover_accessible(text) helper
-- 6. Explicit table privileges (Supabase no longer auto-grants new tables)
-- 7. RLS policies
-- 8. `genre-covers` bucket + storage.objects policies (re-runnable section)
--
-- Apply after 20260925000100_core_schema.sql, 20260925000200_access_control.sql
-- and 20260925000300_storage.sql. Target: Postgres 15 (hosted Supabase).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Venue category
-- -----------------------------------------------------------------------------

create type public.business_type as enum ('cafe', 'restaurant', 'hotel', 'bar', 'other');

-- A constant default: existing rows get 'other' without a table rewrite. The
-- existing table-level grants and policies on businesses cover the new column,
-- and it is not part of the branding that bump_branding_version() tracks.
alter table public.businesses
  add column business_type public.business_type not null default 'other';

-- -----------------------------------------------------------------------------
-- 2. Genre covers
-- -----------------------------------------------------------------------------

-- Object path in bucket `genre-covers`: {genre_id}/{random}.{png|jpg|webp}.
alter table public.genres
  add column cover_path text null
    check (cover_path is null or char_length(cover_path) between 1 and 512);

-- Looked up by the storage policy (private.genre_cover_accessible).
create index genres_cover_path_idx on public.genres (cover_path) where cover_path is not null;

-- -----------------------------------------------------------------------------
-- 3. Access requests (submitted from the public /request-access page)
-- -----------------------------------------------------------------------------

create type public.access_request_status as enum ('new', 'contacted', 'approved', 'declined');

-- Rows are inserted ONLY by the server action with the secret key, after
-- validation and rate limiting; anon/authenticated have no INSERT privilege.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  business_name text not null
    check (char_length(btrim(business_name)) >= 1 and char_length(business_name) <= 120),
  business_type public.business_type not null,
  contact_name text not null
    check (char_length(btrim(contact_name)) >= 1 and char_length(contact_name) <= 120),
  email text not null
    check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text null check (phone is null or char_length(phone) <= 40),
  message text null check (message is null or char_length(message) <= 1000),
  status public.access_request_status not null default 'new',
  admin_notes text null check (admin_notes is null or char_length(admin_notes) <= 2000),
  handled_by uuid null references public.profiles (id) on delete set null,
  handled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;

-- At most one OPEN request per email (case-insensitive). A duplicate submission
-- fails with 23505 on this index; the action answers "we already have your
-- request". Once a request is approved/declined the same email may ask again.
create unique index access_requests_open_email_key
  on public.access_requests (lower(email))
  where status in ('new', 'contacted');
create index access_requests_status_created_at_idx on public.access_requests (status, created_at desc);
create index access_requests_created_at_idx on public.access_requests (created_at desc);
create index access_requests_handled_by_idx on public.access_requests (handled_by);

create trigger set_updated_at before update on public.access_requests
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Platform settings (single row)
-- -----------------------------------------------------------------------------

create table public.platform_settings (
  -- Singleton: the only allowed key is `true`.
  id boolean primary key default true check (id),
  contact_email text null
    check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  contact_phone text null check (contact_phone is null or char_length(contact_phone) <= 40),
  privacy_policy text null check (privacy_policy is null or char_length(privacy_policy) <= 50000),
  terms_of_service text null check (terms_of_service is null or char_length(terms_of_service) <= 50000),
  default_announcement_every_n_tracks integer not null default 4
    check (default_announcement_every_n_tracks between 1 and 50),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles (id) on delete set null
);
alter table public.platform_settings enable row level security;
create index platform_settings_updated_by_idx on public.platform_settings (updated_by);

create trigger set_updated_at before update on public.platform_settings
  for each row execute function private.set_updated_at();

insert into public.platform_settings (id) values (true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Helper for the genre-covers storage policy
-- -----------------------------------------------------------------------------

-- A genre whose cover is stored at p_name is accessible to the caller's ACTIVE
-- business (enabled, and available to all or assigned). Inactive venues, users
-- without a business, disabled genres and unreferenced objects ⇒ false.
create or replace function private.genre_cover_accessible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.genres g
     where g.cover_path = p_name
       and private.genre_accessible((select private.active_member_business_id()), g.id)
  );
$$;

revoke execute on function private.genre_cover_accessible(text) from public, anon;
grant execute on function private.genre_cover_accessible(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Table privileges (RLS decides which rows; these decide which statements)
-- -----------------------------------------------------------------------------

revoke all on table public.access_requests, public.platform_settings from public, anon, authenticated;

-- access_requests: admins read/triage/delete through RLS; nobody but the
-- service role (secret key) may insert.
grant select, update, delete on table public.access_requests to authenticated;
grant select, insert, update, delete on table public.access_requests to service_role;

-- platform_settings: public content (contact details, privacy/terms text) is
-- readable without a session; only admins may update (RLS). The single row is
-- created above, so API roles never insert or delete it.
grant select on table public.platform_settings to anon, authenticated;
grant update on table public.platform_settings to authenticated;
grant select, insert, update on table public.platform_settings to service_role;

-- -----------------------------------------------------------------------------
-- 7. Policies
-- -----------------------------------------------------------------------------

-- access_requests (no INSERT policy: authenticated has no INSERT privilege) ---
create policy "access_requests: admin select" on public.access_requests
  for select to authenticated
  using ((select private.is_platform_admin()));

create policy "access_requests: admin update" on public.access_requests
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy "access_requests: admin delete" on public.access_requests
  for delete to authenticated
  using ((select private.is_platform_admin()));

-- platform_settings -------------------------------------------------------------
-- Readable by everyone (it only holds content shown on public pages).
create policy "platform_settings: read" on public.platform_settings
  for select to anon, authenticated
  using (true);

create policy "platform_settings: admin update" on public.platform_settings
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 8. Storage: `genre-covers` bucket and storage.objects policies
--    Re-runnable on its own (bucket upsert + create-if-missing policies). Never
--    ALTERs or DROPs anything on storage.objects (owned by
--    supabase_storage_admin on hosted Supabase). The "media: admin …" policies
--    of 20260925000300 stay untouched; the new bucket gets its own policies.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('genre-covers', 'genre-covers', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  v_existing text[] := array(
    select policyname::text from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
  );
begin
  -- Platform admins: every operation on genre covers. --------------------------
  if not ('genre-covers: admin select' = any (v_existing)) then
    create policy "genre-covers: admin select" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'genre-covers'
        and (select private.is_platform_admin())
      );
  end if;

  if not ('genre-covers: admin insert' = any (v_existing)) then
    create policy "genre-covers: admin insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'genre-covers'
        and (select private.is_platform_admin())
      );
  end if;

  if not ('genre-covers: admin update' = any (v_existing)) then
    create policy "genre-covers: admin update" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'genre-covers'
        and (select private.is_platform_admin())
      )
      with check (
        bucket_id = 'genre-covers'
        and (select private.is_platform_admin())
      );
  end if;

  if not ('genre-covers: admin delete' = any (v_existing)) then
    create policy "genre-covers: admin delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'genre-covers'
        and (select private.is_platform_admin())
      );
  end if;

  -- Business users: read-only, covers of genres their active venue may play. --
  if not ('genre-covers: member read accessible covers' = any (v_existing)) then
    create policy "genre-covers: member read accessible covers" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'genre-covers'
        and private.genre_cover_accessible(name)
      );
  end if;
end;
$$;

-- No INSERT/UPDATE/DELETE policies for business users on genre-covers: with
-- RLS enabled on storage.objects, the absence of a policy denies them.

commit;
