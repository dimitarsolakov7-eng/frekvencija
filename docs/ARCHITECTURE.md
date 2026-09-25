# Frekvencija — Architecture & Build Spec

> The platform is branded **Frekvencija** (frekvencija.online). The name is defined once in
> `src/config/platform.ts` (overridable with `NEXT_PUBLIC_PLATFORM_NAME`). Never hard-code it elsewhere.
> The project started under the placeholder name "Venue Radio"; older notes may still use it.

This document is the source of truth for the backend, security model and playback engine. The UI,
the final route list and the redesign additions are specified in [REDESIGN.md](REDESIGN.md), which
wins where the two disagree (notably §7 Routes and §10 UI below). Module-level APIs are recorded in
`docs/build-notes/*.md`; the verification record is [TESTING.md](TESTING.md).

## 1. Product summary

- Platform administrators manage a central MP3 catalogue organised into genres, manage businesses
  (venues), and manage each business's voice announcements.
- Business users log in, see their own station branding ("EmeraldBar Radio"), choose one of the
  genres assigned to them, press **Start Radio**, and hear continuous shuffled music. Between songs
  their *own* approved announcements play (welcome on first start, then one every N completed
  tracks, default 4).
- Announcements are saved MP3 files (uploaded, or generated once via server-side ElevenLabs TTS
  and stored). No TTS call happens during playback.

## 2. Stack (pinned)

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16.3.6 App Router, React 19.2.8, TypeScript (strict) |
| Styling | Tailwind CSS v4 (CSS-first `@theme` in `src/app/globals.css`), `lucide-react` icons |
| Backend | Next.js Route Handlers + Server Actions (Node runtime) |
| Auth / DB / Files | Supabase Auth, Postgres with RLS, private Supabase Storage (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.1) |
| Validation | `zod` 4 (server) + native constraints (client) |
| Audio validation | `music-metadata` 11 (server) |
| TTS | ElevenLabs REST API via `fetch` (server only, optional) |
| Tests | Vitest 5; DB/RLS tests on `@electric-sql/pglite` with Supabase shims |
| Scripts | `tsx` for `scripts/*.ts`; `@breezystack/lamejs` for demo MP3 generation |

Do **not** add dependencies without recording them here. Never run `npm install` from a parallel
build agent; report the need instead.

Research notes verified against current docs live in `docs/research/*.md` — read the relevant one
before writing code that touches Next.js 16 APIs, Supabase, ElevenLabs, or browser audio.

## 3. Environment variables

See `.env.example`. Read them only through `src/lib/env.ts`.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PLATFORM_NAME` | public | Optional platform display name (default "Venue Radio") |
| `NEXT_PUBLIC_SITE_URL` | public | Absolute base URL used for auth email redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable key (`sb_publishable_…`); legacy fallback `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_SECRET_KEY` | server | Secret key (`sb_secret_…`); legacy fallback `SUPABASE_SERVICE_ROLE_KEY`. Used only for Auth admin (invites), upload validation downloads, rate limiting, and HMAC upload tokens |
| `ELEVENLABS_API_KEY` | server | Optional. When absent, TTS UI shows "not configured"; uploads still work |
| `ELEVENLABS_DEFAULT_MODEL_ID` | server | Optional default model (e.g. `eleven_multilingual_v2`) |
| `MEDIA_URL_TTL_SECONDS` | server | Optional signed-URL lifetime, default `7200`, clamped 900–43200 |
| `UPLOAD_TOKEN_SECRET` | server | Optional HMAC secret for upload tokens; defaults to a key derived from `SUPABASE_SECRET_KEY` |
| `CLIENT_IP_HEADER` | server | Optional header the edge **overwrites** with the client IP (e.g. `x-real-ip`, `cf-connecting-ip`); auto `x-vercel-forwarded-for` on Vercel. Wins over `TRUSTED_PROXY_HOPS` |
| `TRUSTED_PROXY_HOPS` | server | Optional 0–10: trusted proxies that **append** to `X-Forwarded-For`; the client IP is that many entries from the right. Unset/0 = untrusted (per-IP limits still run; global caps protect the public forms) |

When Supabase public env vars are missing the app must render a friendly `/setup` page instead of
crashing (proxy redirects every non-static request to `/setup`).

## 4. Roles & tenancy

- `profiles.role`: `platform_admin` or `business_user` (default). Created by a trigger on
  `auth.users` insert — **never** derived from user metadata. Users cannot change their role
  (column privileges + guard trigger). First admin is promoted by `scripts/create-admin.ts` or the
  SQL snippet in `docs/SETUP.md`.
- `business_members`: links a user to exactly **one** business (MVP: `unique(user_id)`).
- The server **never** trusts a client-supplied business id for business users. The business is
  resolved from the session (`business_members`), and RLS enforces it again in the database.
- A business user of an **inactive** business can sign in but sees "This venue is not active";
  all content access (genres, tracks, announcements, media URLs) is denied by RLS.

## 5. Database (Postgres) — exact schema

Migrations live in `supabase/migrations/` (Supabase CLI naming `YYYYMMDDHHMMSS_name.sql`) and must be
runnable in order in the Supabase SQL editor. They must be idempotent-friendly where practical
(`create ... if not exists` for extensions/schemas), but it is fine for tables to use plain `create table`.

| file | contents |
| --- | --- |
| `20260925000100_core_schema.sql` | schema `private`, enums, tables (RLS enabled at creation), checks, indexes, triggers, `rate_limit_buckets` + `consume_rate_limit()` |
| `20260925000200_access_control.sql` | `private.*` helpers (5.4), explicit grants, RLS policies (5.5), RPCs (5.7) |
| `20260925000300_storage.sql` | buckets (upsert) + `storage.objects` policies (5.6); re-runnable |
| `20260926000100_frekvencija.sql` | Frekvencija redesign additions (5.8): `business_type` + `access_request_status` enums, `businesses.business_type`, `genres.cover_path`, `access_requests`, `platform_settings`, `private.genre_cover_accessible()`, grants/RLS, `genre-covers` bucket + policies (that last section is re-runnable) |

Each file is wrapped in `begin; … commit;`. No extension is required (`gen_random_uuid()` is core).
`src/types/database.ts` must match the SQL exactly: `tests/db/schema-contract.test.ts` type-checks a
column/enum/RPC contract against `Database` and compares it with the migrated catalog.

### 5.1 Enums (schema `public`)

```sql
app_role               = ('platform_admin', 'business_user')
announcement_status    = ('draft', 'generating', 'ready', 'failed', 'active')
announcement_source    = ('upload', 'tts')
announcement_placement = ('welcome', 'rotation', 'both')
```

### 5.2 Tables

All tables: `created_at timestamptz not null default now()`, and mutable tables also
`updated_at timestamptz not null default now()` maintained by a shared `set_updated_at()` trigger.
All ids `uuid primary key default gen_random_uuid()` unless stated.

**profiles**
| column | type | notes |
| --- | --- | --- |
| id | uuid PK | references `auth.users(id)` on delete cascade |
| email | text not null | synced from auth.users by trigger |
| full_name | text null | ≤ 120 chars |
| role | app_role not null default 'business_user' | only service role / SQL can change it |

**businesses**
| column | type | notes |
| --- | --- | --- |
| name | text not null | 1–120 chars (trimmed) |
| station_name | text not null | 1–120 chars, e.g. "EmeraldBar Radio" |
| name_pronunciation | text null | ≤ 200, spoken spelling of `name` for TTS (e.g. "Emerald Bar") |
| station_name_pronunciation | text null | ≤ 200, spoken spelling of `station_name` |
| contact_email | text null | basic email format check |
| announcement_language | text not null default 'en' | BCP-47-ish `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$` |
| logo_path | text null | object path in bucket `logos` |
| is_active | boolean not null default false | |
| announcement_every_n_tracks | integer not null default 4 | check 1–50 |
| announcement_volume | numeric(3,2) not null default 1.00 | check 0.10–1.00; gain applied to announcements (music plays at `MUSIC_GAIN = 0.85`) |
| branding_version | integer not null default 1 | bumped by trigger when name/station/pronunciations change |

**business_members** — `business_id uuid` → businesses (cascade), `user_id uuid` → profiles (cascade),
`created_at`; PK `(business_id, user_id)`; `unique (user_id)`.

**genres**
| column | type | notes |
| --- | --- | --- |
| name | text not null | 1–60; unique on `lower(name)` |
| slug | text not null unique | `^[a-z0-9]+(-[a-z0-9]+)*$` |
| description | text null | ≤ 280 |
| sort_order | integer not null default 0 | ascending display order |
| is_enabled | boolean not null default true | disabled genres are invisible to businesses |
| available_to_all | boolean not null default true | false ⇒ only businesses with an access row |

**business_genre_access** — `business_id` → businesses (cascade), `genre_id` → genres (cascade),
`created_at`; PK `(business_id, genre_id)`; index on `genre_id`.

A genre is **accessible** to business B ⇔ `genre.is_enabled AND (genre.available_to_all OR access row exists) AND B.is_active`.

**tracks**
| column | type | notes |
| --- | --- | --- |
| title | text not null | 1–200 |
| artist | text not null default 'Unknown Artist' | 1–200 |
| duration_seconds | numeric(8,2) not null | > 0 |
| storage_path | text not null unique | bucket `music`: `tracks/{track_id}/{random}.mp3` |
| file_size_bytes | bigint not null | > 0 |
| mime_type | text not null default 'audio/mpeg' | |
| bitrate_kbps | integer null | |
| sample_rate_hz | integer null | |
| original_filename | text null | ≤ 255 |
| is_active | boolean not null default true | admin enable/disable |
| removed_at | timestamptz null | soft removal from future playback |
| created_by | uuid null | → profiles on delete set null |

A track is **playable** ⇔ `is_active AND removed_at IS NULL`.

**track_genres** — `track_id` → tracks (cascade), `genre_id` → genres (cascade), `created_at`;
PK `(track_id, genre_id)`; index on `genre_id`.

**announcements**
| column | type | notes |
| --- | --- | --- |
| business_id | uuid not null | → businesses (cascade) |
| template_key | text null | key from `ANNOUNCEMENT_TEMPLATES` or null (custom) |
| placement | announcement_placement not null default 'rotation' | welcome / rotation / both |
| text | text not null | 1–500, display wording with real names |
| spoken_text | text null | ≤ 1000, wording sent to TTS (pronunciation spelling applied); null ⇒ use `text` |
| language | text not null default 'en' | same format as business language |
| status | announcement_status not null default 'draft' | |
| source | announcement_source null | set when audio is attached |
| audio_path | text null | bucket `announcements`: `{business_id}/{announcement_id}/{random}.mp3` |
| audio_duration_seconds | numeric(8,2) null | |
| audio_size_bytes | bigint null | |
| voice_id | text null | TTS voice used |
| voice_name | text null | |
| model_id | text null | TTS model used |
| generation_hash | text null | sha256 of the TTS request that produced current audio |
| generation_started_at | timestamptz null | generating-lock timestamp |
| generation_attempts | integer not null default 0 | |
| last_error | text null | ≤ 1000, honest failure message |
| needs_review | boolean not null default false | set when branding changes |
| review_reason | text null | |
| branding_version | integer not null default 1 | business branding version at approval/creation |
| approved_at | timestamptz null | |
| approved_by | uuid null | → profiles on delete set null |
| created_by | uuid null | → profiles on delete set null |

Checks: `status not in ('ready','active') or audio_path is not null`; `status <> 'active' or approved_at is not null`.
Index `(business_id, status)`.

An announcement is **playable** ⇔ `status = 'active' AND NOT needs_review AND audio_path IS NOT NULL AND branding_version = businesses.branding_version AND business is active`.

State machine (enforced by server actions; DB checks above are the backstop):

```
draft ──generate──▶ generating ──ok──▶ ready ──approve──▶ active
  ▲                     │                ▲  ◀──deactivate──┘
  │                     └──fail──▶ failed ─generate/upload─┘
  └── edit spoken wording/voice of a TTS announcement (audio invalidated → draft)
upload MP3 (from draft/failed/ready/active) ──▶ ready (needs approval again)
branding change ──▶ needs_review = true on every announcement of that business
approve (ready or needs_review active) ──▶ active, needs_review=false, branding_version=current
```

A `generating` lock older than 3 minutes is stale and may be retried.

**playback_preferences** — PK `(user_id, business_id)`; `user_id` → profiles (cascade),
`business_id` → businesses (cascade), `genre_id uuid null` → genres (on delete set null),
`volume numeric(4,3) not null default 0.8` (0–1), `muted boolean not null default false`, `updated_at`.

**rate_limit_buckets** — `key text PK`, `window_started_at timestamptz not null`, `count integer not null`.
RLS enabled with **no** policies. Function
`public.consume_rate_limit(p_key text, p_max integer, p_window_seconds integer) returns boolean`
(security definer, `set search_path = ''`, execute granted to `service_role` only) atomically
increments and returns whether the call is allowed. Fixed window: the first call after
`p_window_seconds` have elapsed starts a new window; the stored count is capped at `p_max + 1`.
Invalid arguments (empty key or key > 200 chars, `p_max < 1`, `p_window_seconds < 1`) raise `22023`.

### 5.3 Triggers

All trigger functions live in schema `private` (execute revoked from `public`).

- `on_auth_user_created` (after insert on `auth.users`, `private.handle_new_user()`): insert
  `profiles(id, email)` with the default role `business_user` (metadata is ignored; a null email is
  stored as `''` so phone sign-ups are never blocked). Security definer.
- `on_auth_user_email_updated` (after update of email, `private.sync_profile_email()`): sync `profiles.email`.
- `profiles_guard_role` (before update, `private.guard_profile_role()`, security invoker): raises
  `42501 'Changing a profile role is not allowed'` if `role` changes and `current_user` is not
  `service_role`, `postgres` or `supabase_admin`; belt-and-braces with the column grant.
- `businesses_branding_version` (before update, `private.bump_branding_version()`): if any of
  `name, station_name, name_pronunciation, station_name_pronunciation` is distinct,
  `branding_version = old + 1`; otherwise the old value is kept, so `branding_version` cannot be set
  by an UPDATE (it can be set on INSERT).
- `businesses_mark_announcements_for_review` (after update, when branding_version changed,
  `private.mark_announcements_for_review()`, security definer): set `needs_review = true` on all of
  that business's announcements with `review_reason = 'Branding changed: "<old station>" → "<new station>"'`
  when the station name changed, else `'Branding changed: venue name or pronunciation updated'`.
- `set_updated_at` (before update, `private.set_updated_at()`) on profiles, businesses, genres,
  tracks, announcements, playback_preferences.

### 5.4 Helper functions (schema `private`, not exposed via the Data API)

All `security definer`, `stable`, `set search_path = ''`, `language sql`, execute granted to
`authenticated` (and `usage on schema private`). Use `(select auth.uid())`.

| function | returns |
| --- | --- |
| `private.is_platform_admin()` | boolean |
| `private.member_business_id()` | uuid of the caller's business (any status) or null |
| `private.active_member_business_id()` | same, only when the business `is_active` |
| `private.genre_accessible(p_business_id uuid, p_genre_id uuid)` | boolean (rule in 5.2) |
| `private.track_accessible(p_track_id uuid)` | playable track linked to ≥1 genre accessible to `active_member_business_id()` |
| `private.track_object_accessible(p_name text)` | a track with `storage_path = p_name` is accessible |
| `private.announcement_object_accessible(p_name text)` | a playable announcement of `active_member_business_id()` has `audio_path = p_name` |
| `private.logo_object_accessible(p_name text)` | `businesses.logo_path = p_name` for `member_business_id()` |

Internal (used by the RPCs in 5.7, security invoker): `private.assert_platform_admin()` raises `42501`
unless the caller is a platform admin or `current_user = 'service_role'`;
`private.assert_uuid_set(uuid[], label)` rejects a null array/element (`22004`) and duplicates (`22023`).

### 5.5 RLS policies (role `authenticated`; `anon` gets nothing)

| table | select | insert/update/delete |
| --- | --- | --- |
| profiles | own row or admin | update own `full_name` only (column grant); nothing else |
| businesses | `id = member_business_id()` or admin | admin |
| business_members | `user_id = auth.uid()` or admin | admin |
| genres | admin or `genre_accessible(active_member_business_id(), id)` | admin |
| business_genre_access | admin or `business_id = member_business_id()` | admin |
| tracks | admin or `track_accessible(id)` | admin |
| track_genres | admin or (`track_accessible(track_id)` and `genre_accessible(active_member_business_id(), genre_id)`) | admin |
| announcements | admin or (`business_id = active_member_business_id()` and playable) | admin |
| playback_preferences | own (`user_id = auth.uid() and business_id = member_business_id()`) | own, `with check` also `genre_id is null or genre_accessible(business_id, genre_id)` |
| rate_limit_buckets | none | none |

### 5.6 Storage (all buckets **private**)

| bucket | size limit | MIME | object path |
| --- | --- | --- | --- |
| `music` | 50 MB | `audio/mpeg`, `audio/mp3` | `tracks/{track_id}/{random}.mp3` |
| `announcements` | 10 MB | `audio/mpeg`, `audio/mp3` | `{business_id}/{announcement_id}/{random}.mp3` |
| `logos` | 2 MB | `image/png`, `image/jpeg`, `image/webp` | `{business_id}/{random}.{png|jpg|webp}` |

Policies on `storage.objects`:
- admin: all operations on the three buckets.
- business user `select`: music ⇒ `private.track_object_accessible(name)`; announcements ⇒
  `(storage.foldername(name))[1] = private.active_member_business_id()::text and
  private.announcement_object_accessible(name)`; logos ⇒ `private.logo_object_accessible(name)`.
- no insert/update/delete for business users.

Signed URLs for business users are created **with the user's own Supabase client**, so storage RLS
is enforced a second time. Admin previews use the admin's own client (admin policy).

Policy names: `media: admin select|insert|update|delete`, `music: member read accessible tracks`,
`announcements: member read own playable`, `logos: member read own logo`. Deleting a business or track
row does **not** delete its objects; remove them with the Storage API (`remove([...])`).

### 5.7 RPCs (`public`, callable with `supabase.rpc(...)`)

All are `security invoker` with `set search_path = ''`, so the caller's grants and RLS still apply;
execute is granted to `authenticated` and `service_role` only (never `anon`). The admin-only ones
raise `42501 'Only platform admins can perform this action'` for anyone else (the service role is
allowed, for seed/maintenance scripts). Each call is one statement, so it is atomic.

| function | returns | behaviour | errors |
| --- | --- | --- | --- |
| `reorder_genres(p_genre_ids uuid[])` | void | admin only. `sort_order` = 1-based position in the array; genres not listed keep their relative order after the listed ones | `42501`; unknown id `23503`; duplicate `22023`; null `22004` |
| `set_business_genre_access(p_business_id uuid, p_genre_ids uuid[])` | void | admin only. Replaces the business's `business_genre_access` rows with exactly this set (empty array clears it) | `42501`; unknown business/genre `23503`; duplicate `22023`; null `22004` |
| `set_track_genres(p_track_id uuid, p_genre_ids uuid[])` | void | admin only. Replaces the track's `track_genres` rows with exactly this set | `42501`; unknown track/genre `23503`; duplicate `22023`; null `22004` |
| `genre_track_counts()` | `table(genre_id uuid, playable_count integer, total_count integer)` | one row per genre **visible to the caller** (genres without tracks included). `playable_count` = linked tracks with `is_active and removed_at is null`; `total_count` = all linked tracks the caller can see. Admins: whole catalogue. Business users: only accessible genres and playable tracks (so both counts are equal); inactive business ⇒ no rows | — |

`consume_rate_limit` (5.2) is also in `public` but executable by `service_role` only.

Typed call example: `await supabase.rpc("set_track_genres", { p_track_id, p_genre_ids })` — check
`error.code` (`"42501"`, `"23503"`, …) and map it to an `ApiErrorCode`.

### 5.8 Frekvencija additions (`20260926000100_frekvencija.sql`, docs/REDESIGN.md §3)

No RPC was added or changed; everything in 5.1–5.7 still holds. `src/types/database.ts` has the new
enums, columns and tables, plus the aliases `BusinessTypeEnum` and `AccessRequestStatusEnum`.

**Enums**

```sql
business_type          = ('cafe', 'restaurant', 'hotel', 'bar', 'other')
access_request_status  = ('new', 'contacted', 'approved', 'declined')
```

**New columns**

| table.column | type | notes |
| --- | --- | --- |
| `businesses.business_type` | business_type not null default 'other' | existing rows become `'other'`. Covered by the existing businesses grants and policies (members read it, admins write it). It is not part of the branding tracked by `bump_branding_version()`, so a change never flags announcements |
| `genres.cover_path` | text null | 1–512 chars. Object path in bucket `genre-covers`: `{genre_id}/{random}.{png|jpg|webp}`. Partial index `genres_cover_path_idx`. Visible to whoever can see the genre row |

**access_requests** (submissions from the public `/request-access` form; RLS enabled)

| column | type | notes |
| --- | --- | --- |
| id | uuid PK | `gen_random_uuid()` |
| business_name | text not null | 1–120 (trimmed) |
| business_type | business_type not null | no default |
| contact_name | text not null | 1–120 (trimmed) |
| email | text not null | ≤ 254, same basic format check as `businesses.contact_email` |
| phone | text null | ≤ 40 |
| message | text null | ≤ 1000 |
| status | access_request_status not null default 'new' | |
| admin_notes | text null | ≤ 2000 |
| handled_by | uuid null | → profiles on delete set null (`access_requests_handled_by_fkey`) |
| handled_at | timestamptz null | set by the admin action |
| created_at / updated_at | timestamptz not null default now() | `set_updated_at` trigger |

Indexes: unique `access_requests_open_email_key` on `lower(email)` where `status in ('new','contacted')`
(so there is at most one open request per email, case-insensitively). A duplicate insert, or re-opening an old
request while another is open, fails with `23505`, and the message names that index. The server action answers
"we already have your request". Once a request is `approved` or `declined`, the same email may submit again.
Also `access_requests_status_created_at_idx (status, created_at desc)`, `access_requests_created_at_idx
(created_at desc)`, `access_requests_handled_by_idx`.

**platform_settings** (singleton; RLS enabled)

| column | type | notes |
| --- | --- | --- |
| id | boolean PK default true | `check (id)`: the only possible row is `id = true` |
| contact_email | text null | ≤ 254, email format check |
| contact_phone | text null | ≤ 40 |
| privacy_policy | text null | ≤ 50 000 chars |
| terms_of_service | text null | ≤ 50 000 chars |
| default_announcement_every_n_tracks | integer not null default 4 | 1–50; the prefill for new venues (applied by the add-business action, not by the DB) |
| updated_at | timestamptz not null default now() | `set_updated_at` trigger |
| updated_by | uuid null | → profiles on delete set null (`platform_settings_updated_by_fkey`); set by the admin action |

The migration inserts the row (`insert … (id) values (true) on conflict do nothing`). This table has no
`created_at`, because the spec lists only `updated_at`/`updated_by`. Read it with `.select(...).eq("id", true).maybeSingle()`
and treat a missing row as "all defaults".

**Helper** (schema `private`, same conventions as 5.4, execute granted to `authenticated` and `service_role`)

| function | returns |
| --- | --- |
| `private.genre_cover_accessible(p_name text)` | a genre with `cover_path = p_name` is accessible (`genre_accessible`) to `active_member_business_id()`. False for inactive venues, users without a business, admins (they use their own policies), disabled or unassigned genres, and objects no genre references (for example a replaced cover) |

**Privileges and RLS**

| table | anon | authenticated (RLS) | service_role |
| --- | --- | --- | --- |
| access_requests | nothing | `select`/`update`/`delete` → policies "access_requests: admin select/update/delete" (admin only). **No insert privilege** for anyone but the service role | select, insert, update, delete |
| platform_settings | `select` (policy "platform_settings: read", `using (true)`) | `select` (same policy); `update` → "platform_settings: admin update" (admin only). No insert/delete | select, insert, update (no delete) |

`platform_settings` is the only table `anon` can touch. Every column in it is public content, including
`updated_by`, which is an admin's profile id and not sensitive. Business users get 0 rows from an
`access_requests` select and 0 affected rows from an update. Anon gets `42501 permission denied`.

**Storage**

| bucket | size limit | MIME | object path |
| --- | --- | --- | --- |
| `genre-covers` (private) | 3 MB (3145728) | `image/png`, `image/jpeg`, `image/webp` | `{genre_id}/{random}.{png|jpg|webp}` |

Policies on `storage.objects` (created only if missing; the existing `media: admin …` policies are left as
they are): `genre-covers: admin select|insert|update|delete` (bucket `genre-covers` and
`is_platform_admin()`), and `genre-covers: member read accessible covers` (select, bucket `genre-covers` and
`private.genre_cover_accessible(name)`). Business users cannot insert, update or delete there. Venue cover
URLs are signed with the user's own client, so RLS is enforced a second time, like music. Anon has no access,
so the public homepage must read enabled `available_to_all` genres and sign their covers with the secret-key
client (server-only), or fall back to `defaultGenreArtwork(slug)`. Replacing a cover: upload the new object,
point `cover_path` at it, then `remove()` the old one with the Storage API.

## 6. Server modules

| path | responsibility |
| --- | --- |
| `src/config/platform.ts` | `PLATFORM_NAME`, `PLATFORM_TAGLINE`, `MUSIC_GAIN` |
| `src/lib/env.ts` | typed env access: `getPublicEnv()`, `getServerEnv()`, `isSupabaseConfigured()`, `isTtsConfigured()` |
| `src/lib/supabase/server.ts` | `createSupabaseServerClient()` (async, cookie-bound, typed `Database`) |
| `src/lib/supabase/browser.ts` | `createSupabaseBrowserClient()` singleton |
| `src/lib/supabase/admin.ts` | `createSupabaseAdminClient()` — secret key, `import 'server-only'` |
| `src/lib/supabase/proxy.ts` | `updateSession(request)` for `src/proxy.ts` |
| `src/lib/auth/session.ts` | `getSessionContext()` (React `cache`), `requireAdminPage()`, `requireBusinessUserPage()`, `requireAdminApi()`, `requireBusinessUserApi()` |
| `src/lib/api/http.ts` | `jsonOk`, `jsonError(status, code, message)`, `readJson(request, schema)` |
| `src/lib/api/contracts.ts` | **shared request/response types** (already written — do not change shapes silently) |
| `src/lib/validation/*.ts` | zod schemas for every mutation |
| `src/lib/rate-limit.ts` | `consumeRateLimit({ key, max, windowSeconds, failClosed })` |
| `src/lib/media/signing.ts` | TTL policy + helpers to sign track/announcement/logo objects |
| `src/lib/audio/mp3.ts` | `validateMp3(bytes)` → ok + metadata, or a user-facing reason |
| `src/lib/uploads/token.ts` | HMAC-signed upload tokens binding kind/path/target/admin/expiry |
| `src/lib/uploads/client.ts` | browser `uploadWithProgress()` (XHR replica of `uploadToSignedUrl`) |
| `src/lib/tts/elevenlabs.ts` | `listVoices`, `listModels`, `synthesize` + typed errors |
| `src/lib/announcements/templates.ts` | `ANNOUNCEMENT_TEMPLATES`, `renderAnnouncement()` |
| `src/lib/data/*.ts` | server-only query helpers (player bootstrap, admin lists) |
| `src/types/database.ts` | hand-written `Database` type matching the migrations exactly |

`getSessionContext()` returns:

```ts
type SessionContext = {
  userId: string;
  email: string;
  role: 'platform_admin' | 'business_user';
  business: { id: string; name: string; stationName: string; isActive: boolean } | null; // from membership
} | null;
```

## 7. Routes

Final route list (see REDESIGN.md §2 for the per-screen behaviour):

```
/                          → public homepage (signed-in users see "Open radio" / "Admin workspace");
                             root-level email-link callbacks (?token_hash / ?code) are forwarded to /auth/confirm
/request-access            → public access-request form (stored in access_requests, never auto-approved)
/privacy, /terms           → owner-supplied text from platform_settings (honest "not published yet" state)
/setup                     → shown when Supabase env is missing
/login, /forgot-password   → (auth) group, split photo/form layout
/reset-password            → invite acceptance, password reset and voluntary change (needs a session);
                             /set-password permanently redirects here
/auth/confirm              → PAGE (not a GET handler): renders a "Continue" button whose Server Action calls
                             verifyOtp({type, token_hash}) (or exchangeCodeForSession for ?code=) then redirects to a
                             sanitised relative `next`. A page+button survives corporate email link scanners that
                             pre-fetch (and would otherwise consume) one-time tokens.
/auth/signout    (POST)    → signOut (scope local), 303 → /login (the venue client stops the player first)
/radio                     → (venue) group: the player (persistent player bar on every venue route)
/account, /help            → (venue) group: read-only venue details + password reset; help and owner contact
/admin                     → redirects to /admin/music
/admin/music               → library, selected-track editor, upload queue (?genre=<id> filter)
/admin/genres              → genre grid + editor, covers, drag / Move up-down ordering, availability
/admin/businesses[/id|/new]→ list + detail panel (Profile / Access / Announcements), add business + invite
/admin/businesses/requests → access-request inbox ("Create business from request")
/admin/announcements       → ?business=<id>: studio (generate voice / upload recording), approval, settings;
                             /admin/businesses/[id]/announcements permanently redirects here
/admin/settings            → platform contact, default announcement frequency, legal text, integration status
/dev/**                    → development only (404 in production): /dev/player-lab, /dev/preview/*, /dev/ui
```

API route handlers (all JSON, `Cache-Control: no-store`, error body `{ error: { code, message } }`):

```
GET  /api/player/genres/[genreId]/tracks     business user
GET  /api/player/announcements               business user
PUT  /api/player/preferences                 business user
POST /api/media/sign                         business user (track | announcement)
POST /api/admin/uploads/sign                 admin (track | track-replace | announcement | logo | genre-cover)
POST /api/admin/uploads/complete             admin
POST /api/admin/media/preview                admin (track | announcement)
GET  /api/admin/tts/options                  admin (?refresh=1 bypasses the 10-minute cache, rate-limited)
POST /api/admin/announcements/[id]/generate  admin
GET  /api/dev/audio/[id]                     development only (manifest id → supabase/seed/audio, Range support)
```

Business-user endpoints resolve the business from the session and ignore any business id in the
request. Admin CRUD (businesses, genres, track metadata, announcements text/approve/activate,
invites) uses **Server Actions** in `actions.ts` files next to the admin pages; every action calls
`requireAdmin*()` first and validates input with zod.

Error codes (`ApiErrorCode` in contracts): `unauthenticated`, `forbidden`, `no_business`,
`business_inactive`, `not_found`, `unavailable`, `invalid_request`, `rate_limited`, `conflict`,
`payload_too_large`, `unsupported_media`, `tts_not_configured`, `tts_failed`, `server_error`.

## 8. Uploads

1. Browser validates extension/type/size and calls `POST /api/admin/uploads/sign` with the target.
2. Server (`requireAdminApi`, rate limit 120/10 min) checks target exists, chooses the object path,
   calls `createSignedUploadUrl(path)` **with the admin's client**, and returns
   `{ uploadToken, bucket, path, signedUrl, token, maxBytes }`. `uploadToken` is an HMAC token
   binding `{kind, bucket, path, targetId, userId, exp(15 min)}`.
3. Browser uploads with `uploadWithProgress()` (XHR, progress events, abortable).
4. Browser calls `POST /api/admin/uploads/complete { uploadToken, metadata? }`. Server verifies the
   token, downloads the object with the admin client, validates it (`validateMp3` or image magic
   bytes), and then creates/updates the DB row. On validation failure it **deletes the object** and
   returns `unsupported_media` with a useful message. Replacement uploads delete the previous object
   only after the DB row points at the new one.

## 9. Playback engine (client)

`src/lib/player/` is framework-agnostic TypeScript, unit-tested with fakes. `src/components/player/PlayerProvider.tsx`
creates exactly one `PlayerEngine` per venue session (in the `(venue)` layout, so route changes do
not recreate it) and exposes it via `useSyncExternalStore`.

- **Single controller**: all playback decisions go through `PlayerEngine`. React components only
  call commands (`start`, `pause`, `resume`, `togglePlay`, `skip`, `selectGenre`, `setVolume`,
  `setMuted`, `retry`, `destroy`) and render `getSnapshot()`.
- **Statuses**: `idle | loading | playing | paused | buffering | blocked | empty | error`.
  `playing` is only reported after the media element fired `playing` and is not paused.
- **Element pool**: 3 reusable `HTMLAudioElement`s (current, next track, next announcement). At most
  one next track and one next announcement are preloaded (bounded prefetch). Before any `play()`
  the engine pauses every other pooled element (exclusivity invariant). A `playing` event from a
  non-current element immediately pauses it.
- **Cancellation**: a monotonically increasing `generation` number and an `AbortController` per
  genre session. Genre change / stop / destroy bumps the generation, aborts in-flight fetches,
  clears preloaded sources (`removeAttribute('src'); load()`), and every async continuation checks
  its captured generation before touching state.
- **Shuffle** (`shuffle.ts`, `ShuffleBag`): no repeats until the pool is exhausted; the first item
  of a new cycle differs from the last item of the previous cycle when the pool has >1 item;
  pool refresh removes ineligible ids and inserts new ids into the remaining cycle.
- **Announcements** (`announcements.ts`, `AnnouncementScheduler`): welcome once per browser session
  (sessionStorage key per user+business, cleared on logout or when another tab signs in as a different
  identity — **not** on unmount/`destroy()`); the first explicit Start marks it pending and it stays
  pending until it actually starts (a genre change or failed request defers it to the next transition;
  at most 3 failed attempts; a removed clip is not retried). Then after every `everyNTracks`
  **completed** tracks (natural `ended` only — skips/failures do not count), rotate playable rotation
  announcements (shuffle-bag, avoid immediate repeat; the rotation only advances when a clip actually
  starts, so a dropped preload stays next in line). If none are available, music continues and the
  counter stays due.
- **Skip is music-only**: while an announcement is current, loading or about to load,
  `snapshot.canSkip` is false (`snapshot.announcementInProgress` true) and `skip()` is a no-op; the UI
  keeps the control focusable but unavailable ("Skip is available during music").
- **Cross-tab identity** (`src/components/player/venue-session.ts`): each venue player announces its
  user+business on a BroadcastChannel; a tab that hears a different identity or a sign-out stops
  immediately, discards unsaved preference changes (`destroy({ savePreferences: false })`), clears its
  welcome flag and reloads. API responses do not carry the venue id yet, so other identity changes
  (e.g. an admin signing in in another tab) stop the player at its next failing request.
- **Eligibility**: before a preloaded track is promoted to current, the engine re-validates it with
  `POST /api/media/sign` (server re-checks it is still playable and accessible). Genre track lists
  are refreshed at most every 60 s at transitions and whenever the bag cycles, so new tracks become
  eligible and disabled/removed ones drop out, including the preloaded one.
- **URL expiry**: signed URLs carry `expiresAt`; a track is re-signed before start if
  `expiresAt - now < duration + 120 s`; a network media error mid-track re-signs and resumes at the
  same position.
- **Failures**: a track that fails to load retries (fresh URL) at most 2 times, then is excluded for
  the session and the engine advances. After `min(5, poolSize)` consecutive failures the engine
  stops in `error` (`catalogue_unavailable`) with a Retry action — no endless loops. Announcement
  failures skip straight to music. 401 ⇒ `auth_expired` (stop, ask to sign in). Offline/network
  ⇒ `error` (`network`) with bounded auto-retry and retry on the `online` event.
- **Buffering watchdog**: stalled > 15 s ⇒ re-sign and reload at position once; > 45 s ⇒ treat as a
  failure.
- **Autoplay**: `play()` rejection with `NotAllowedError` ⇒ `blocked` with a "Tap to resume your radio."
  button; `AbortError` from superseded plays is ignored.
- **Pause** pauses whichever item is current (music or announcement); a transition in flight while
  paused leaves the next item loaded but paused. Changing genre while paused stays paused.
- **Fades**: 250 ms fade-in at item start, 300 ms fade-out on skip/genre change, only when element
  volume is writable (feature-detected; iOS falls back to sequential playback) and the page is
  visible.
- **Volume**: element volume = `masterVolume × gain`, gain = `MUSIC_GAIN` (0.85) for music and
  `business.announcementVolume` for announcements. Mute applies to all.
- **Media Session**: metadata (title, artist, station) and play/pause/nexttrack handlers when available.
- **Logout**: `signOutOfVenue()` calls `destroy()` (stops audio, releases elements), clears the welcome/session
  keys (`clearPlayerSessionState()`), notifies other tabs, POSTs `/auth/signout`, then replaces the location with
  a sanitised destination (`safeNextPath`, default `/login`).

## 10. UI

- Dark charcoal background, restrained emerald accent, large controls, high contrast; the venue's
  logo and station name are the focus of the player. Minimal animation (respect
  `prefers-reduced-motion`).
- Primitive components in `src/components/ui/` (Button, IconButton, Input, Textarea, Label, Field,
  Select, Switch, Slider, Card, Badge, Alert, Spinner, EmptyState, Dialog, Tabs, ProgressBar, Toast).
- Accessibility: every control has a visible label or `aria-label`; player status in an
  `aria-live="polite"` region; keyboard shortcuts on the player page: Space/K play-pause, M mute,
  N skip (ignored while typing in inputs); focus rings visible.
- Responsive: designed for a laptop driving venue speakers; works on tablets and phones.

## 11. Seeds & scripts

- `npm run demo:audio` — generates labelled synthetic demo loops (not real music) and demo
  announcements into `supabase/seed/audio/` (spoken with Windows SAPI when available, otherwise
  clearly labelled chime placeholders).
- `npm run seed:dev` — refuses to run against production unless explicitly allowed; creates genres,
  the example businesses **EmeraldBar** and **Hotel Aurora**, users with random passwords printed
  once locally, demo tracks, and distinct demo announcements (approved) per business.
- `npm run admin:create -- <email>` — invites or promotes a platform admin.

## 12. Testing

- `npm test` runs Vitest: player engine/shuffle/scheduler (fakes, deterministic timers),
  server libs, route authorization (mocked Supabase), and DB/RLS tests on PGlite with Supabase
  auth/storage shims applying the real migrations.
- `docs/TESTING.md` lists which checks were executed and which still need real credentials or
  manual browser validation.

## 13. Verified implementation rules (from `docs/research/*.md`, 2026-09-25)

These override anything above that conflicts. Read the linked research note before coding the area.

**Next.js 16** (`docs/research/nextjs-16.md`)
- `src/proxy.ts` (not `middleware.ts`) exports `proxy` + static `config.matcher`; it refreshes the Supabase
  session (`getClaims()` right after `createServerClient`, copy `setAll`'s cookies **and** its `headers`
  argument onto the returned response). It never redirects `/api/*` (handlers return 401 JSON) and it
  redirects everything except `/setup` and static assets to `/setup` when Supabase env is missing.
- `cookies()`, `headers()`, `params`, `searchParams` are Promises — always `await`. Type pages/layouts/route
  handlers with the global `PageProps<'/route'>`, `LayoutProps<'/route'>`, `RouteContext<'/route'>` helpers.
- Authenticated layouts (`(venue)`, `admin`) and any page reading the session export
  `export const dynamic = "force-dynamic"`. Code using the secret key first calls `await connection()`.
- Route handlers must set `Cache-Control: private, no-store` (the `jsonOk/jsonError` helpers do this).
- `'use server'` files export **only async functions** (types are fine). Call `redirect()` outside
  `try/catch` and after `revalidatePath`. Zod 4: use `z.flattenError(error)` / `z.treeifyError`.
  React resets uncontrolled form fields after an action — return submitted values in the action state and
  use them as `defaultValue` so validation errors don't wipe input.
- Do not use `unauthorized()`/`forbidden()` (experimental). Pages: `redirect()`/`notFound()`; APIs: JSON errors.
- eslint-config-next 16 enforces React Compiler rules as errors: no `setState` synchronously inside
  `useEffect`, no reading `ref.current` during render, no `Date.now()`/`Math.random()` during render.
- Typecheck with `npm run typecheck` (`next typegen && tsc --noEmit`); lint with `npm run lint`.
  `next build` type-checks but does not lint.
- The player provider lives in `src/app/(venue)/layout.tsx` (never `template.tsx`); navigation inside the
  venue area must use `next/link`/router (a plain `<a>` reloads the page and stops audio).
- Uploads never go through Next (proxy truncates bodies at 10 MB, actions at 1 MB): signed upload URLs only.

**Supabase** (`docs/research/supabase.md`)
- Every migration explicitly `revoke all on <table> from anon, authenticated` then grants exactly what is
  needed to `authenticated` and `grant all ... to service_role` (new projects no longer auto-grant).
  Enable RLS on every table. `private` schema: `grant usage` + `grant execute` to `authenticated`.
- Use only SQL features available in Postgres 15 (production), even though PGlite tests run on PG 18.
- Never `ALTER TABLE storage.objects` (not owner on hosted Supabase); only `create policy ... on storage.objects`.
  Storage rows cannot be deleted with SQL — use the Storage API `remove()`.
- Admin (secret key) client = plain `createClient(url, secret, { auth: { persistSession:false,
  autoRefreshToken:false, detectSessionInUrl:false } })`, never the SSR client.
- `getClaims()` returns `{ data: null, error: null }` when signed out — check `data?.claims`.
- Business-user sign-out uses `signOut({ scope: "local" })` so other devices stay signed in.
- Invites: `inviteUserByEmail(email, { redirectTo: SITE_URL, data: { business_name } })`; existing confirmed
  email ⇒ 422 `email_exists`. Because Supabase's default SMTP only mails team members (2/h), the admin UI
  also offers **"Create one-time invite link"** via `auth.admin.generateLink({ type: 'invite' | 'recovery' })`
  building `${SITE_URL}/auth/confirm?token_hash=…&type=invite&next=/set-password`, shown once with a
  warning to deliver it privately. The admin never sees or sets a password.
- Signed upload: XHR `PUT` to `signedUrl` with `FormData` (`cacheControl`, `contentType`, then the file
  under the empty field name `""`); do not set Content-Type manually. Storage errors arrive as HTTP 400
  with the real code in the JSON body `statusCode` ('409','413','415','404').
- Signed download URLs support Range requests; expiry is checked on every request (lifetime must cover
  the whole track + buffering).

**Browser audio** (`docs/research/browser-audio.md` §12 checklist is mandatory for the engine)
- WebKit gates autoplay **per element**: create the 3-element pool up front and, synchronously inside the
  Start/Resume click handler, call `load()` (or play) on idle pooled elements to unlock them; reuse them for
  the whole session. Do slow work (re-signing) *before* the current item ends, not in the `ended` handler.
- `play()` rejection: switch on `err.name` (`NotAllowedError` ⇒ blocked, `AbortError` ⇒ re-check element
  state, `NotSupportedError` ⇒ source failed). Guard every `play()` with a timeout (a src-less play never settles).
- "Playing" = `playing` event, `!paused`, and `currentTime` advancing. `waiting` = buffering; `stalled` is
  unreliable. Mid-track network errors fire no `pause` event. At natural end `pause` fires before `ended`
  with `el.ended === true` — do not treat that `pause` as a user pause.
- Cancel downloads: `pause(); removeAttribute('src'); load()`. Never `src = ''`.
- Expired signed URL ⇒ `MEDIA_ERR_NETWORK` mid-track (or code 4 before metadata): re-sign, `src = url`,
  `currentTime = pos`, `play()`. Re-sign on resume after a long pause. Keep a preloaded element's URL when its
  expiry still covers `duration + 120 s` (swapping src discards the buffer).
- Fades: ramp `el.volume` with `setInterval` + wall-clock time (not rAF, not Web Audio, no `crossOrigin`).
  Never start from 0 (use ≥ 0.02). iOS: `volume` is read-only (detect asynchronously) ⇒ no fades/gain.
- Media Session: wrap each `setActionHandler` in try/catch; don't call `setPositionState` for radio.
- Keyboard: Space/K, M, N shortcuts with a visible on/off toggle (WCAG 2.1.4); ignore Space when a button
  or input has focus. Play/Pause button changes its label (no `aria-pressed`); Mute uses `aria-pressed`.
- `offline` is a hint only — do not stop; retry on `online` and on bounded backoff.

**Audio tooling / validation** (`docs/research/audio-tooling.md`)
- `src/lib/audio/mp3.ts` must NOT import `server-only`; load `music-metadata` with `await import()` inside the
  function. Validation = magic bytes (ID3 or frame sync) + own MPEG Layer III frame walk (≥3 consecutive
  frames, ≤2% non-audio bytes) + frame-derived duration ≥ 0.5 s + music-metadata codec check
  (`/^MPEG (1|2|2\.5) Layer 3$/`) for tags. Do not trust music-metadata duration or MIME sniffing alone.
- `scripts/` contains its own `package.json` with `{"type":"module"}` (root package.json stays CommonJS).
- Generated demo audio is loudness-normalised to −16 LUFS, −1 dBFS peak.

**ElevenLabs** (`docs/research/elevenlabs.md`)
- `xi-api-key` header; `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`; voices via
  `GET /v2/voices` (paginated); models via `GET /v1/models` (`can_do_text_to_speech`, `languages`,
  `maximum_text_length_per_request`). Never send `language_code` to `eleven_multilingual_v2`; for other models
  only when listed in that model's languages. Classify errors by status + `detail.code/status` (401 may be
  `quota_exceeded`). Apply `name_pronunciation` by plain respelling before the call.

**PGlite tests** (`docs/research/pglite-rls.md`)
- Build one migrated snapshot in Vitest global setup, restore once per test file, BEGIN/ROLLBACK per test.
  Every assertion runs through `asUser`/`asAnon` (the superuser bypasses RLS). Never call `db.transaction()`
  inside a manual BEGIN. Cast reused parameters (`$1::uuid`). Limit Vitest workers for DB files (~345 MB each).
