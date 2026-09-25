-- =====================================================================
-- Supabase compatibility shim for PGlite (PostgreSQL 18.3 / PGlite 0.5.8)
-- Mirrors: supabase/postgres init-scripts (roles), supabase/auth migrations
-- (auth.uid/role/email/jwt), supabase/storage tenant migrations (buckets,
-- objects, foldername/filename/extension, protect_delete trigger).
-- Run ONCE as the default PGlite superuser (postgres) BEFORE your migrations.
-- =====================================================================

-- ---------- roles (supabase/postgres 00000000000000-initial-schema.sql) ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit createrole;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to postgres, anon, authenticated, service_role;

-- NOTE: Supabase removed the automatic "grant all on new public tables to
-- anon/authenticated/service_role" default privileges (new projects since
-- 2026-05-30, all existing projects on 2026-10-30). We deliberately do NOT
-- add those default privileges, so tests fail with "permission denied for
-- table" if a migration forgets its explicit GRANTs -- exactly like prod.

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- ---------- auth schema (supabase/postgres 00000000000001 + supabase/auth) ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
-- REQUIRED: FK checks (e.g. profiles.id -> auth.users.id) run as the OWNER of
-- auth.users; without schema usage they fail with "permission denied for schema auth".
grant all on schema auth to supabase_auth_admin;

create table if not exists auth.users (
  instance_id uuid null,
  id uuid not null primary key,
  aud varchar(255) null,
  role varchar(255) null,
  email varchar(255) null,
  encrypted_password varchar(255) null,
  email_confirmed_at timestamptz null,
  invited_at timestamptz null,
  confirmation_token varchar(255) null,
  confirmation_sent_at timestamptz null,
  recovery_token varchar(255) null,
  recovery_sent_at timestamptz null,
  email_change varchar(255) null,
  last_sign_in_at timestamptz null,
  raw_app_meta_data jsonb null default '{}'::jsonb,
  raw_user_meta_data jsonb null default '{}'::jsonb,
  is_super_admin bool null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  phone text null unique default null,
  phone_confirmed_at timestamptz null,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  banned_until timestamptz null,
  deleted_at timestamptz null,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);
create unique index if not exists users_email_partial_key on auth.users (email) where (is_sso_user = false);
alter table auth.users enable row level security;
alter table auth.users owner to supabase_auth_admin;
-- anon/authenticated get NO privileges on auth.users (same as hosted Supabase).
grant all on auth.users to postgres, service_role;

-- supabase/auth 20220224000811_update_auth_functions.up.sql
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

-- supabase/auth 20220531120530_add_auth_jwt_function.up.sql
create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

-- ---------- storage schema (supabase/storage migrations/tenant, as of 0073) ----------
create schema if not exists storage;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on schema storage to supabase_storage_admin;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'storage' and t.typname = 'buckettype') then
    create type storage.buckettype as enum ('STANDARD', 'ANALYTICS', 'VECTOR');
  end if;
end $$;

create table if not exists storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,                       -- deprecated, use owner_id
  owner_id text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint default null,        -- bytes
  allowed_mime_types text[] default null,
  type storage.buckettype not null default 'STANDARD'
);
create unique index if not exists bname on storage.buckets using btree (name);

create table if not exists storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,                       -- deprecated, use owner_id
  owner_id text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text default null,
  user_metadata jsonb null
);
create unique index if not exists objects_bucket_id_name_key on storage.objects (bucket_id, name collate "C");
create index if not exists name_prefix_search on storage.objects (name text_pattern_ops);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- 0046 + 0073: all DML to API roles (RLS decides), no truncate/references/trigger for anon/authenticated
grant all on storage.buckets, storage.objects to postgres, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated;

-- 0060 / 0061 (current definitions, IMMUTABLE)
create or replace function storage.foldername(name text)
    returns text[]
    language plpgsql
    immutable
as $function$
declare
    _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[1 : array_length(_parts,1) - 1];
end
$function$;

create or replace function storage.filename(name text)
    returns text
    language plpgsql
    immutable
as $function$
declare
    _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[array_length(_parts, 1)];
end
$function$;

create or replace function storage.extension(name text)
    returns text
    language plpgsql
    immutable
as $function$
declare
    _parts text[];
    _filename text;
begin
    select string_to_array(name, '/') into _parts;
    select _parts[array_length(_parts, 1)] into _filename;
    return reverse(split_part(reverse(_filename), '.', 1));
end
$function$;

-- 0037: bucket name length
create or replace function storage.enforce_bucket_name_length()
returns trigger as $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$ language plpgsql;
drop trigger if exists enforce_bucket_name_length_trigger on storage.buckets;
create trigger enforce_bucket_name_length_trigger
before insert or update of name on storage.buckets
for each row execute function storage.enforce_bucket_name_length();

-- 0055: direct SQL DELETE on storage tables is blocked unless the Storage API
-- (which sets storage.allow_delete_query = 'true' per transaction) does it.
create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
        raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            using hint = 'This prevents accidental data loss from orphaned objects.',
                  errcode = '42501';
    end if;
    return null;
end;
$$;
drop trigger if exists protect_buckets_delete on storage.buckets;
create trigger protect_buckets_delete before delete on storage.buckets
    for each statement execute function storage.protect_delete();
drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
