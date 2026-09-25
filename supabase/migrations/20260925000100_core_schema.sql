-- =============================================================================
-- Venue Radio — core schema (docs/ARCHITECTURE.md §5.1–5.3)
--
-- Enums, tables, checks, indexes, triggers and the service-role rate limiter.
-- Grants and RLS policies live in 20260925000200_access_control.sql; RLS is
-- already enabled here as each table is created, so no table is ever readable
-- through the Data API before its policies exist (deny by default).
--
-- Target: Postgres 15 (hosted Supabase). Run the migrations in filename order in
-- the Supabase SQL editor (or with the Supabase CLI).
-- =============================================================================

begin;

-- Trigger functions and RLS helpers live in `private`, which is NOT exposed by
-- the Data API. `gen_random_uuid()` is core since PG13, so no extension is needed.
create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.app_role as enum ('platform_admin', 'business_user');
create type public.announcement_status as enum ('draft', 'generating', 'ready', 'failed', 'active');
create type public.announcement_source as enum ('upload', 'tts');
create type public.announcement_placement as enum ('welcome', 'rotation', 'both');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text null check (full_name is null or char_length(full_name) <= 120),
  role public.app_role not null default 'business_user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (char_length(btrim(name)) >= 1 and char_length(name) <= 120),
  station_name text not null
    check (char_length(btrim(station_name)) >= 1 and char_length(station_name) <= 120),
  name_pronunciation text null
    check (name_pronunciation is null or char_length(name_pronunciation) <= 200),
  station_name_pronunciation text null
    check (station_name_pronunciation is null or char_length(station_name_pronunciation) <= 200),
  contact_email text null
    check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  announcement_language text not null default 'en'
    check (announcement_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  logo_path text null check (logo_path is null or char_length(logo_path) between 1 and 512),
  is_active boolean not null default false,
  announcement_every_n_tracks integer not null default 4
    check (announcement_every_n_tracks between 1 and 50),
  announcement_volume numeric(3, 2) not null default 1.00
    check (announcement_volume between 0.10 and 1.00),
  branding_version integer not null default 1 check (branding_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.businesses enable row level security;

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id),
  -- MVP: a user belongs to at most one business.
  constraint business_members_user_id_key unique (user_id)
);
alter table public.business_members enable row level security;

create table public.genres (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) >= 1 and char_length(name) <= 60),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text null check (description is null or char_length(description) <= 280),
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  available_to_all boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index genres_name_lower_key on public.genres (lower(name));
alter table public.genres enable row level security;

create table public.business_genre_access (
  business_id uuid not null references public.businesses (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, genre_id)
);
create index business_genre_access_genre_id_idx on public.business_genre_access (genre_id);
alter table public.business_genre_access enable row level security;

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) >= 1 and char_length(title) <= 200),
  artist text not null default 'Unknown Artist'
    check (char_length(btrim(artist)) >= 1 and char_length(artist) <= 200),
  duration_seconds numeric(8, 2) not null check (duration_seconds > 0),
  storage_path text not null unique check (char_length(storage_path) between 1 and 512),
  file_size_bytes bigint not null check (file_size_bytes > 0),
  mime_type text not null default 'audio/mpeg',
  bitrate_kbps integer null check (bitrate_kbps is null or bitrate_kbps > 0),
  sample_rate_hz integer null check (sample_rate_hz is null or sample_rate_hz > 0),
  original_filename text null check (original_filename is null or char_length(original_filename) <= 255),
  is_active boolean not null default true,
  removed_at timestamptz null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tracks_created_by_idx on public.tracks (created_by);
alter table public.tracks enable row level security;

create table public.track_genres (
  track_id uuid not null references public.tracks (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (track_id, genre_id)
);
create index track_genres_genre_id_idx on public.track_genres (genre_id);
alter table public.track_genres enable row level security;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  template_key text null check (template_key is null or char_length(template_key) between 1 and 64),
  placement public.announcement_placement not null default 'rotation',
  text text not null check (char_length(btrim(text)) >= 1 and char_length(text) <= 500),
  spoken_text text null check (spoken_text is null or char_length(spoken_text) <= 1000),
  language text not null default 'en' check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  status public.announcement_status not null default 'draft',
  source public.announcement_source null,
  audio_path text null check (audio_path is null or char_length(audio_path) between 1 and 512),
  audio_duration_seconds numeric(8, 2) null check (audio_duration_seconds is null or audio_duration_seconds > 0),
  audio_size_bytes bigint null check (audio_size_bytes is null or audio_size_bytes > 0),
  voice_id text null,
  voice_name text null,
  model_id text null,
  generation_hash text null,
  generation_started_at timestamptz null,
  generation_attempts integer not null default 0 check (generation_attempts >= 0),
  last_error text null check (last_error is null or char_length(last_error) <= 1000),
  needs_review boolean not null default false,
  review_reason text null,
  branding_version integer not null default 1 check (branding_version >= 1),
  approved_at timestamptz null,
  approved_by uuid null references public.profiles (id) on delete set null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Backstops for the state machine enforced by the server actions.
  constraint announcements_audio_required_check
    check (status not in ('ready', 'active') or audio_path is not null),
  constraint announcements_active_requires_approval_check
    check (status <> 'active' or approved_at is not null)
);
create index announcements_business_id_status_idx on public.announcements (business_id, status);
create index announcements_audio_path_idx on public.announcements (audio_path) where audio_path is not null;
create index announcements_approved_by_idx on public.announcements (approved_by);
create index announcements_created_by_idx on public.announcements (created_by);
alter table public.announcements enable row level security;

create table public.playback_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  genre_id uuid null references public.genres (id) on delete set null,
  volume numeric(4, 3) not null default 0.8 check (volume between 0 and 1),
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index playback_preferences_business_id_idx on public.playback_preferences (business_id);
create index playback_preferences_genre_id_idx on public.playback_preferences (genre_id);
alter table public.playback_preferences enable row level security;

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.genres
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tracks
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.announcements
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.playback_preferences
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- auth.users → profiles
-- -----------------------------------------------------------------------------

-- Deliberately trivial: a failing trigger here blocks every invite and sign-up.
-- The role is never taken from user metadata (users can edit raw_user_meta_data);
-- it always starts as the column default 'business_user'.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = coalesce(new.email, '')
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.sync_profile_email();

-- Belt and braces with the column-level UPDATE grant (full_name only): a role
-- change is accepted only from the service role or a database administrator
-- (SQL editor / migrations). SECURITY INVOKER on purpose, so current_user is the
-- role that issued the UPDATE.
create or replace function private.guard_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Changing a profile role is not allowed'
      using errcode = '42501',
            hint = 'Roles can only be changed with the service role or from the SQL editor.';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function private.guard_profile_role();

-- -----------------------------------------------------------------------------
-- Business branding
-- -----------------------------------------------------------------------------

-- branding_version is owned by this trigger: it is bumped when anything spoken
-- in announcements changes and cannot be set directly by an UPDATE.
create or replace function private.bump_branding_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.name, new.station_name, new.name_pronunciation, new.station_name_pronunciation)
     is distinct from
     (old.name, old.station_name, old.name_pronunciation, old.station_name_pronunciation) then
    new.branding_version := old.branding_version + 1;
  else
    new.branding_version := old.branding_version;
  end if;
  return new;
end;
$$;

create trigger businesses_branding_version
  before update on public.businesses
  for each row execute function private.bump_branding_version();

-- Every announcement of a business whose branding changed must be re-approved
-- (announcements are only playable at the current branding_version). SECURITY
-- DEFINER so the invariant holds whichever role updated the business.
create or replace function private.mark_announcements_for_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.announcements
     set needs_review = true,
         review_reason = case
           when new.station_name is distinct from old.station_name
             then format('Branding changed: "%s" → "%s"', old.station_name, new.station_name)
           else 'Branding changed: venue name or pronunciation updated'
         end
   where business_id = new.id;
  return null;
end;
$$;

create trigger businesses_mark_announcements_for_review
  after update on public.businesses
  for each row
  when (old.branding_version is distinct from new.branding_version)
  execute function private.mark_announcements_for_review();

-- -----------------------------------------------------------------------------
-- Rate limiting (service role only)
-- -----------------------------------------------------------------------------

create table public.rate_limit_buckets (
  key text primary key check (char_length(key) between 1 and 200),
  window_started_at timestamptz not null,
  count integer not null check (count >= 0)
);
-- RLS on and no policies: only roles with BYPASSRLS (service_role) can touch it.
alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;

-- Fixed-window limiter. Atomically counts one call against p_key and returns
-- whether it is allowed (at most p_max calls per p_window_seconds). The single
-- INSERT … ON CONFLICT takes the row lock, so concurrent calls serialise.
create or replace function public.consume_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 then
    raise exception 'p_key must be 1-200 characters' using errcode = '22023';
  end if;
  if p_max is null or p_max < 1 then
    raise exception 'p_max must be >= 1' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'p_window_seconds must be >= 1' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets as b (key, window_started_at, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_started_at = case
          when b.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
          else b.window_started_at
        end,
        -- Capped at p_max + 1: denied calls keep the bucket "full" without overflowing.
        count = case
          when b.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
          else least(b.count + 1, p_max + 1)
        end
  returning b.count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Trigger functions are never called directly.
revoke execute on function private.set_updated_at() from public;
revoke execute on function private.handle_new_user() from public;
revoke execute on function private.sync_profile_email() from public;
revoke execute on function private.guard_profile_role() from public;
revoke execute on function private.bump_branding_version() from public;
revoke execute on function private.mark_announcements_for_review() from public;

commit;
