-- =============================================================================
-- Venue Radio — private Storage buckets and storage.objects policies
-- (docs/ARCHITECTURE.md §5.6)
--
-- Re-runnable: buckets are upserted and each policy is created only when it is
-- missing. storage.objects is owned by supabase_storage_admin on hosted
-- Supabase (with RLS already enabled), so this file never ALTERs or DROPs
-- anything on it — it only creates policies.
--
-- Signed download URLs are created with the *user's* client, so the SELECT
-- policies below are enforced a second time when a business user signs media.
-- Signed upload URLs are created with the admin's client (admin INSERT policy).
-- =============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('music',         'music',         false, 52428800, array['audio/mpeg', 'audio/mp3']),
  ('announcements', 'announcements', false, 10485760, array['audio/mpeg', 'audio/mp3']),
  ('logos',         'logos',         false,  2097152, array['image/png', 'image/jpeg', 'image/webp'])
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
  -- Platform admins: every operation on the three buckets. -------------------
  if not ('media: admin select' = any (v_existing)) then
    create policy "media: admin select" on storage.objects
      for select to authenticated
      using (
        bucket_id in ('music', 'announcements', 'logos')
        and (select private.is_platform_admin())
      );
  end if;

  if not ('media: admin insert' = any (v_existing)) then
    create policy "media: admin insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id in ('music', 'announcements', 'logos')
        and (select private.is_platform_admin())
      );
  end if;

  if not ('media: admin update' = any (v_existing)) then
    create policy "media: admin update" on storage.objects
      for update to authenticated
      using (
        bucket_id in ('music', 'announcements', 'logos')
        and (select private.is_platform_admin())
      )
      with check (
        bucket_id in ('music', 'announcements', 'logos')
        and (select private.is_platform_admin())
      );
  end if;

  if not ('media: admin delete' = any (v_existing)) then
    create policy "media: admin delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id in ('music', 'announcements', 'logos')
        and (select private.is_platform_admin())
      );
  end if;

  -- Business users: read-only, and only what they may currently play or show.
  if not ('music: member read accessible tracks' = any (v_existing)) then
    create policy "music: member read accessible tracks" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'music'
        and private.track_object_accessible(name)
      );
  end if;

  if not ('announcements: member read own playable' = any (v_existing)) then
    create policy "announcements: member read own playable" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'announcements'
        and (storage.foldername(name))[1] = (select private.active_member_business_id())::text
        and private.announcement_object_accessible(name)
      );
  end if;

  if not ('logos: member read own logo' = any (v_existing)) then
    create policy "logos: member read own logo" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'logos'
        and private.logo_object_accessible(name)
      );
  end if;
end;
$$;

-- No INSERT/UPDATE/DELETE policies for business users: with RLS enabled on
-- storage.objects, the absence of a policy denies those operations.

commit;
