# Redesign wave 1 notes (build notes)

Generated from the redesign wave-1 agents' reports (2026-09-25).

## db-v2

### Public API

DATABASE: the new migration is supabase/migrations/20260926000100_frekvencija.sql. It runs after the three existing files, is wrapped in begin/commit, and only its final storage section can be re-run. No RPC was added or changed; genre_track_counts, reorder_genres, set_business_genre_access, set_track_genres and consume_rate_limit behave as before. The details are recorded in docs/ARCHITECTURE.md §5.8, and the migrations file table in §5 has the new row.

TYPES (import type { Database, Tables, TablesInsert, TablesUpdate, Enums, BusinessTypeEnum, AccessRequestStatusEnum } from "@/types/database"):
- Enums: business_type = "cafe"|"restaurant"|"hotel"|"bar"|"other"; access_request_status = "new"|"contacted"|"approved"|"declined". The aliases are BusinessTypeEnum and AccessRequestStatusEnum. Both match contracts.ts BusinessType.
- businesses.business_type: business_type, not null, default 'other' (optional on Insert). Existing rows become 'other'. Members can read it and only admins can write it, through the existing policies. Changing it does NOT bump branding_version or flag announcements.
- genres.cover_path: string | null, 1–512 chars. It is the object path in bucket "genre-covers": `{genre_id}/{random}.{png|jpg|webp}`.
- Table access_requests has these columns:
  - id
  - business_name (1–120 trimmed)
  - business_type (not null, no default)
  - contact_name (1–120 trimmed)
  - email (≤254, basic email check)
  - phone (≤40 | null)
  - message (≤1000 | null)
  - status (default 'new')
  - admin_notes (≤2000 | null)
  - handled_by → profiles (set null, FK access_requests_handled_by_fkey)
  - handled_at
  - created_at, updated_at (updated_at maintained by the set_updated_at trigger)
- access_requests has a unique index `access_requests_open_email_key` on lower(email) where status in ('new','contacted'). A duplicate open request raises Postgres 23505, and the message contains "access_requests_open_email_key". Map that to "we already have your request". After a request is approved or declined, the same email may submit again.
- Table platform_settings is a singleton. The only row has id = true (check (id)) and is inserted by the migration. Columns:
  - contact_email (email check, ≤254 | null)
  - contact_phone (≤40 | null)
  - privacy_policy (≤50000 | null)
  - terms_of_service (≤50000 | null)
  - default_announcement_every_n_tracks (1–50, default 4)
  - updated_at (trigger)
  - updated_by → profiles (set null, FK platform_settings_updated_by_fkey)
  - There is no created_at.
  - Read it with `.from("platform_settings").select(...).eq("id", true).maybeSingle()`.
  - Update it with `.update({..., updated_by: ctx.userId}).eq("id", true)`.

PRIVILEGES AND RLS:
- access_requests:
  - anon: nothing (42501).
  - authenticated: select, update and delete, admin-only through the policies "access_requests: admin select/update/delete". A non-admin gets 0 rows.
  - Nobody except service_role can INSERT. The public action must insert with createSupabaseAdminClient() after validation and rate limiting.
- platform_settings:
  - anon and authenticated: SELECT, with policy "platform_settings: read" using (true).
  - authenticated: UPDATE, admin only ("platform_settings: admin update").
  - No insert or delete for anon or authenticated.
  - service_role: select, insert, update, but no delete.

HELPER: private.genre_cover_accessible(p_name text) returns boolean. It is security definer, stable, with search_path ''. It is true when a genre with cover_path = p_name is genre_accessible to active_member_business_id(). Execute is granted to authenticated and service_role only.

STORAGE:
- New private bucket "genre-covers": 3145728 bytes, image/png, image/jpeg, image/webp. It is created with insert … on conflict do update.
- New policies (the existing "media: admin …" policies are untouched):
  - "genre-covers: admin select|insert|update|delete"
  - "genre-covers: member read accessible covers": select where bucket_id = 'genre-covers' and private.genre_cover_accessible(name)
- Business users can sign covers of their accessible genres with their own client. Anon cannot read covers.

TEST HARNESS: fixtures.ts `Bucket` now includes "genre-covers"; putObject gives it an image mimetype.

### Cross-module requests

- tests/admin/businesses/helpers.test.ts line 186 (admin businesses owner): the full `Tables<'businesses'>` row mock needs `business_type: "other"` (or another enum value). Without it, tsc raises TS2741.
- src/lib/supabase/types.ts (platform-core owner): add "genre-covers" to `StorageBucket` (= "music" | "announcements" | "logos" | "genre-covers").
- src/lib/validation/limits.ts (uploads owner): add `UPLOAD_RULES['genre-cover'] = { bucket: 'genre-covers', maxBytes: 3145728 /* 3 MB, matches the bucket limit */, label: 'Genre cover', media: 'image' }` and a MAX_GENRE_COVER_BYTES constant. The object path must be `${genreId}/${random}.${ext}`. On complete, set genres.cover_path, and only then `remove()` the old object with the Storage API.
- Request-access server action owner: insert with createSupabaseAdminClient(), because anon and authenticated have no INSERT privilege on access_requests. Treat error.code === '23505' (message contains 'access_requests_open_email_key') as 'we already have your request'. Keep zod limits within the DB checks: business_name/contact_name 1–120 trimmed, email ≤254 lowercased (the unique index uses lower(email)), phone ≤40, message ≤1000. Blank optional fields should become null.
- Admin access-requests UI owner: update status, admin_notes (≤2000), handled_by = ctx.userId and handled_at = now() with the admin's own client (RLS is admin-only). Re-opening a closed request to new/contacted while another open request exists for that email raises 23505.
- Admin settings / public pages owner: platform_settings is one row with id = true. Read it with `.select(...).eq('id', true).maybeSingle()` using any client; anon can read it, so /privacy and /terms work without a session. Update it with the admin's client via `.update({...}).eq('id', true)` and set updated_by: ctx.userId. DB limits: contact_email ≤254 plus email format, contact_phone ≤40, privacy_policy/terms_of_service ≤50000, default_announcement_every_n_tracks 1–50. Treat a missing row as all-null defaults with frequency 4.
- Add-business action owner: businesses.business_type defaults to 'other' in the DB. Prefill announcement_every_n_tracks from platform_settings.default_announcement_every_n_tracks; the DB does not apply that default.
- Public homepage owner: anon has no access to genres or genre-covers objects. Read enabled available_to_all genres and sign their cover_path from 'genre-covers' with the secret-key client (server-only, after `await connection()`), or use defaultGenreArtwork(slug).
- Player bootstrap owner (src/lib/data/player.ts): select genres.cover_path and sign it from bucket 'genre-covers' with the business user's own client. Storage RLS allows exactly the covers of accessible genres. Use null or fallback artwork when cover_path is null or signing fails. Also select businesses.business_type for PlayerBusiness.type.
- docs/SETUP.md owner: apply supabase/migrations/20260926000100_frekvencija.sql after the three 20260925 files, in the SQL editor or with the CLI.

### Open issues

- Not verified on hosted Supabase or PG15; the tests run on PGlite PG 18.3. Only PG15 features are used. As with 000300, the storage policies are created inside a DO block as the SQL-editor postgres role, and nothing on storage.objects is altered or dropped.
- Choices beyond the spec wording:
- Added a 1–512 length check on genres.cover_path and a partial index on it.
- Added contact_phone ≤ 40 on platform_settings (the spec gave no length) and the same email format check as businesses.contact_email.
- service_role gets select/insert/update on platform_settings but no delete, so the singleton cannot be removed through the API.
- Added FK indexes access_requests_handled_by_idx and platform_settings_updated_by_idx.
- access_requests uses table-level UPDATE for admins, so admins could also edit submitted fields; I did not add column grants.
- updated_by and handled_by are set by the admin actions; no trigger stamps them from auth.uid(). updated_at is maintained by the shared set_updated_at trigger.
- platform_settings.updated_by (an admin profile uuid) is readable by anon along with the rest of the row. This is intentional so `select *` works; profiles themselves stay protected by RLS.
- The remaining tsc errors are outside my owned paths: one Database-related test mock (reported above) and the contract-adoption errors owned by the player, uploads and dev-lab agents.

## player-backend-v2

### Public API

ENGINE (@/lib/player/engine)
- PlayerSnapshot.upcoming: UpcomingTrack[] ({id,title,artist,durationSeconds}). It is read-only, holds at most UPCOMING_LIMIT (3, exported) tracks, and lists the next tracks in play order: first the track a running transition is validating or loading, then a still-eligible preloaded track, then the ShuffleBag order.
  - The list stops at the current track or at a repeat. That makes it an exact prefix of what plays next (announcements are not listed) until the genre list refreshes with changes or a track fails.
  - Titles, artists and durations come from the loaded genre list, so removed tracks never appear after a refresh.
  - A single-track genre shows its track repeating (one entry). It is [] when status is idle, empty or error, and when no genre list is loaded.
  - It is republished immediately when a preload fails or a preloaded element errors.
  - The array identity is kept while its content is unchanged; the snapshot is still a new object only on change.
- No command or signature changes. Internal loadAnnouncement and preloadAnnouncement now take Pick<AnnouncementSummary,'id'|'durationSeconds'>.

SHUFFLE (@/lib/player/shuffle)
- ShuffleBag.peek(count: number): string[]. It never consumes, reorders or draws randomness, and returns the ids the next next() calls will return, in order. It covers the rest of the current cycle plus the planned next cycle, so it can return fewer than count for tiny pools. It returns [] for an empty bag or when count is ≤0 or NaN.
- The bag now plans the next cycle ahead. setPool and exclude keep the plan consistent: removed ids drop out, new ids are inserted at random positions, and the no-back-to-back rule at cycle boundaries is kept. Setting the same ids again changes nothing. All existing members are unchanged.

API CLIENT (@/lib/player/api-client)
- parseAnnouncements now requires a string `text` on every announcement. A missing or non-string text makes the response invalid (PlayerApiError 'server'). Only id, placement, durationSeconds and text are kept. The scheduler passes text through and ignores it.

DATA (@/lib/data/player, server-only)
- loadPlayerBootstrap(supabase, ctx) now also returns:
  - business.type: BusinessType, from businesses.business_type (unknown → 'other').
  - genres[].coverUrl: string|null. genres.cover_path objects are signed from bucket 'genre-covers' with the user's client in ONE createSignedUrls call, TTL mediaTtlFor(null). The value is null on a missing path, a per-object error or a batch failure, and signing never throws.
  - announcements: AnnouncementSummary[] with text. These are the venue's own playable clips, oldest first, using exactly the same rule as the announcements route. announcementCounts is derived from the same list.
  - support: {email, phone}, read from platform_settings (eq id true). Values are trimmed; blank becomes null. The result is null/null when the row is missing or the query fails, and it never throws.
- New exports:
  - loadSupportContact(supabase): Promise<SupportContact>
  - signGenreCoverUrls(client, paths): Promise<Map<path,url>>
  - GENRE_COVER_BUCKET = 'genre-covers'
  - BUSINESS_TYPES
  - EMPTY_SUPPORT_CONTACT
  - type StorageBatchSigningClient
- loadAnnouncementPlayback now returns announcements with text.

ROUTES
- GET /api/player/announcements: each announcement now includes `text` (display wording only). spoken_text, audio paths and review state never leave the server. Other routes are unchanged.

For the station-voice Preview in the venue UI: sign the clip with createPlayerApi().signMedia({kind:'announcement', id}) (POST /api/media/sign) and play it in a separate audio element. The engine's counter is never touched.

### Cross-module requests

- src/components/player/player-view.ts (venue-ui): createIdleSnapshot() must add `upcoming: []` (current TS2741). Render snapshot.upcoming as the read-only 'Coming up' list, using item.id as the key; ids are unique within the list.
- src/app/dev/player-lab/lab-api.ts: AnnouncementSummary now requires `text` (use the manifest entry's `text`). src/app/dev/player-lab/lab-catalog.ts: PlayerGenre now requires `coverUrl` (null). The fake PlayerApi there must return `text` for each announcement, because the real api-client parser rejects announcements without it.
- tests/player-ui/player-view.test.ts and tests/player-ui/ssr-render.test.ts fixtures: add business.type, genres[].coverUrl, and bootstrap.announcements / bootstrap.support.
- src/lib/supabase/types.ts (platform-core): add 'genre-covers' to StorageBucket. src/lib/media/signing.ts: optionally add a batch helper, signStorageObjects(client, bucket, paths, ttl) using createSignedUrls, plus signGenreCoverObject(client, path). src/lib/data/player.ts can then delegate to them; today it calls createSignedUrls directly with mediaTtlFor(null) via its own structural StorageBatchSigningClient.
- Venue UI / ui-foundation CoverImage: genre cover and logo URLs are signed with the baseline TTL (MEDIA_URL_TTL_SECONDS, default 2 h). The (venue) layout bootstrap persists across client navigations, so a re-mounted image can hit an expired URL. CoverImage must fall back to defaultGenreArtwork(slug) on image load error, as StationLogo does. If next/image optimisation is used for signed Supabase URLs, next.config remotePatterns must allow the Supabase host, or the image should be rendered unoptimized.
- Venue UI 'Your station voice' Preview: take the clips from bootstrap.announcements (they carry text), sign them with createPlayerApi().signMedia({kind:'announcement', id}), and play them in a separate <audio>. Call engine.pause() first and offer 'Resume radio'. Never feed the preview into the engine, so the song counter is untouched.
- docs/ARCHITECTURE.md §9 and docs/build-notes (docs owner), please record the following. (a) ShuffleBag plans the next cycle ahead and peek(n) is pure. (b) PlayerSnapshot.upcoming semantics, as in publicApi, plus UPCOMING_LIMIT. (c) AnnouncementSummary.text is required by the api-client parser. (d) The loadPlayerBootstrap additions: business.type, coverUrl via one batch sign on genre-covers, announcements, and support from platform_settings (never throws). (e) The new data/player exports.

### Open issues

- Not verified against live Supabase, only against the in-memory fake: (1) Storage createSignedUrls on bucket 'genre-covers' with the business user's JWT. I rely on per-path error entries (signedURL null) for objects hidden by RLS, as documented by the storage-js 2.117.1 typings and implementation; a whole-batch error is handled as all-null covers. (2) platform_settings read with .eq('id', true).maybeSingle() under the new anon/authenticated select policy.
- Signed cover URLs expire after the baseline TTL (default 2 h, same policy as logos). A long-running /radio page keeps the bootstrap from its first load, so the UI must fall back to default artwork on image error (see crossModuleRequests). The URLs are fresh after router.refresh or a reload.
- The upcoming preview is exact until one of these happens: a list refresh that changes the genre, a track that turns out ineligible or fails at play time, or a preload that fails. In that last case the engine still drops that pick for the current cycle (unchanged behaviour: it plays in a later cycle), and the preview is republished at once. Announcements are intentionally not listed.
- The ShuffleBag now draws randomness at different moments (when a cycle is planned rather than when it starts), and the random source is shared with the announcement scheduler. Behaviour and distribution are unchanged, and no existing test depended on specific seeded orders, but exact seeded sequences differ from before.
- src/types/database.ts from the db agent already had business_type, cover_path and platform_settings when I typechecked, so nothing is pending on that side for my code.

## ui-foundation-v2

### Public API

DESIGN SYSTEM (src/app/globals.css, Tailwind v4 CSS-first)
- Tokens: the existing ones plus `bg-control` (#101A16, the input/select/search well). `bg-sidebar` is used for the shell sidebar and the mobile top/bottom bars.
- Utilities (size/weight only, never colour; add e.g. `text-fg-muted` yourself):
  - `eyebrow`: 12px uppercase, 0.14em tracking. Write the text in sentence case.
  - `page-title`: 30/36/42px, bold.
  - `hero-title`: 40/56/72px.
  - `section-title`: 20/24px.
  - `px-page`: 16/24/32px gutter that also clears the notch.
  - `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`.
- CSS vars: `--page-gutter`, `--shell-sidebar-w` (15rem). `--shell-header-h` and `--shell-bottom-h` are measured by AppShell and set on <html>; html gets scroll-padding from them.
- Animations: `animate-menu-in`, `animate-drawer-in-{right,left,bottom}` (all motion-safe).

ROOT LAYOUT (src/app/layout.tsx)
- `metadataBase` = resolveSiteOrigin(NEXT_PUBLIC_SITE_URL), fallback http://localhost:3000.
- openGraph (website, siteName, title, description, locale) and a twitter summary_large_image card.
- Default title "Frekvencija · Your place. Your sound. Your radio."; description "Music for your atmosphere. A station with your name."
- viewport: `viewportFit: "cover"`.
- not-found, error and global-error are restyled with BrandLogo; they still use `retry()`.

UTILS: `@/lib/utils`
- `stableHash(s)` (FNV-1a/32)
- `normalizeKey(k)`
- `pickByKey(key, options)`
- `seededRandom(seed)`: mulberry32
- `resolveSiteOrigin(raw, fallback?)`: never throws
- `DEV_SITE_ORIGIN`

UI: `@/components/ui` barrel. All existing exports are unchanged; new props are additive.
- Restyled: 44px controls, 10px radius, 12px cards, primary = emerald with dark text, quiet secondary/outline buttons, font-semibold. Tables look like screen 05 (sentence-case muted header, 48px header row, roomy rows). Badges are now bordered pills. Breadcrumbs use "/" separators. PageHeader has the new title sizes.
- New optional props:
  - `Select`: `leading?: ReactNode` (decorative dot).
  - `Checkbox`: `variant?: 'plain'|'tile'`.
  - `Card`: `variant?: 'default'|'selected'|'inset'`.
  - `TR`: `selected?: boolean` (sets data-selected + emerald tint).
  - `Tabs`: `variant?: 'underline'|'segmented'`, `listClassName?`; `TabItem.icon?`.
  - `PageHeader`: `eyebrow?`, `as?: 'h1'|'h2'`, `titleId?`.
  - `Dialog` and `ConfirmDialog`: `returnFocusRef?`.
- Dialog fix: focus now returns to the opener even when the Dialog is unmounted while open. This lives in `internal/use-modal-dialog.ts` (a layout-effect cleanup) and Drawer shares it.
- New primitives:
  - `Avatar {name; initials?; src?|imageUrl?; size?: xs|sm|md|lg|xl; shape?: circle|rounded; tone?: accent|neutral|auto; decorative?}` [client]. Falls back to initials if the image fails. `avatarAutoToneClasses(name)` and `AVATAR_AUTO_TONES` are exported.
  - `StatusPill {tone?: success|warning|neutral|danger|info; label? or children; size?: sm|md}`.
  - `GenreChip {name? or children; genreKey?; tone?; size?: sm|md}`, plus `GenreDot {genreKey?; tone?}`, `genreChipTone(key)` and `GENRE_CHIP_TONES`. The tone is deterministic and ignores case and whitespace; pass the slug or id as `genreKey`.
  - `DropdownMenu {label (trigger accessible name); items; trigger?; triggerVariant?; triggerSize?: sm|md; triggerClassName?; align?: start|end; side?: bottom|top; header?; disabled?}` [client].
    - Items are `{label, icon?, description?, onSelect?, href?, action? (hidden form POST), tone?: danger, disabled?, key?}` or `{type:'separator'}`.
    - Keyboard: ↓/↑/Home/End, typeahead, Escape (does not close an enclosing dialog) and Tab. Clicking outside closes it.
    - The menu is a top-layer popover, so tables never clip it.
    - onSelect runs after focus is back on the trigger, so a dialog opened from a menu item returns focus to the "…" button.
  - `Drawer {open; onClose; title; hideTitle?; description?; children; footer?; side?: right|left|bottom; size?: sm|md|lg; dismissible?; initialFocusRef?; returnFocusRef?}` [client].
  - `SearchInput {label? (default 'Search'); onValueChange?; onClear?; inputClassName?}` plus input props [client]. `className` goes on the wrapper. Works controlled or uncontrolled and shows a clear button.
  - `SegmentedTabs`: same props as Tabs.
  - `PasswordInput {toggleLabel? ('Show password')}` plus input props [client]. The toggle has aria-pressed and aria-controls={id}.
  - `CoverImage {src?; artworkKey?; fallbackSrc?; alt? (''); sizes?; priority?; overlay?: true|'bottom'|'left'|'full'; className (frame); imageClassName?; children}` [client]. It uses next/image `fill`; remote/signed src is `unoptimized`; a broken src falls back to defaultGenreArtwork(artworkKey), or to the venue photo.
  - `Waveform {bars?; seed?; progress?; tone?: accent|muted; className}`: decorative and aria-hidden. `waveformHeights(count, seed)` is exported.
  - `Accordion {items?: {id?, title, content, defaultOpen?}[]; exclusive?; children?}` and `AccordionItem {title; children; defaultOpen?; name?}`: details/summary, works in Server Components.
  - Helpers: `computeMenuPosition`, `renderIcon`, `IconLike`.

SHELL: `@/components/shell` (docs/REDESIGN §5)
- These components render on the server. Only the link state (`ShellNavLink`), UserMenu's DropdownMenu and ShellMetrics run on the client. So you can pass lucide icon components (`icon: Music`) straight from Server Components; elements (`<Music/>`) work too.
- `AppShell {sidebar; mobileHeader; mobileNav?; playerBar?; topBar? (desktop-only right-aligned row, e.g. UserMenu); children; contentClassName?}`
  - Layout: a fixed 240px sidebar at ≥1024px; a sticky safe-area-aware header below that; SkipLink; `<main id="main-content" tabIndex={-1}>` with px-page and a content wrapper up to 1600px.
  - `playerBar` and `mobileNav` form one sticky bottom stack at the end of the main column, so content is never hidden behind it (verified at 1440 and 375). Render playerBar as a card; the shell supplies the outer gutter.
- `SidebarBrand {href (required); eyebrow?}`
- `SidebarNav {label; items: {href, label, icon?, match?: 'exact'|'prefix' (default prefix)}[]}`: the current page gets aria-current="page", a nested page's section gets "true", and both get the emerald pill.
- `SidebarSection {children; position?: 'bottom' (default, pinned) | 'flow'; label? (makes it a nav)}`
- `SidebarButton {label; icon?; href?+match? | onClick? | action? (form POST) ; type?; tone?: danger; disabled?}`
- `SidebarIdentity {name; initials?; imageUrl?; subtitle?}`
- `MobileTopBar {right?; href? ('/')}`
- `MobileTabBar {items: {href,label,icon?,match?}[]; label? ('Main')}`
- `UserMenu {name; email?; initials?; imageUrl?; items: {label, href?|onSelect?|action?, icon?, tone?}[]; compact?}`: the trigger is named `${name}, account menu`.
- `PageHeading`: same as PageHeader `{title; eyebrow?; description?; actions?; breadcrumbs?; children?; as?; titleId?}`.
- `navItemState(pathname, href, match)`, `normalizePath`, `ariaCurrentFor`.

ADMIN SHELL: `@/components/admin/shell`
- `AdminShell {email; children}` builds on AppShell:
  - Sidebar: logo + "Admin workspace"; Music library /admin/music, Genres /admin/genres, Businesses /admin/businesses, Announcements /admin/announcements; bottom Settings /admin/settings and Sign out (form POST /auth/signout).
  - Top-right UserMenu "Administrator" with the email, Settings, Change password (/reset-password) and Sign out (POST).
  - Below 1024px: MobileTopBar with `AdminMobileMenu`, a left Drawer holding the same navigation plus the account actions. It closes on navigation.
- Also exported: `ADMIN_NAV_ITEMS`, `ADMIN_SECONDARY_NAV_ITEMS`, `ADMIN_HOME_PATH` ('/admin/music'), `adminNavItemState`, `ADMIN_SIGN_OUT_ACTION`, `ADMIN_CHANGE_PASSWORD_PATH`, `SignOutForm`.

ADMIN ROUTES
- `/admin/layout.tsx`: requireAdminPage + force-dynamic, then AdminShell. Pages render only their content; the shell supplies padding and width.
- `/admin` → redirect('/admin/music').
- `/admin/loading.tsx`: skeleton shaped like heading, then list card and editor panel.
- `/admin/error.tsx`: client boundary inside the shell with an Alert, Try again (retry()), the digest, and a link to the music library.

DEV
- `/dev/ui` is the gallery of every primitive and shell piece.
- `/dev/ui/shell?player=0|1&tabs=0|1&topbar=0|1&long=0|1` is a live AppShell for checking overlap at 1440/768/390.

### Cross-module requests

- Venue layout owner (src/app/(venue)/layout.tsx):
- Compose `<AppShell sidebar={<><SidebarBrand href="/radio"/><SidebarIdentity name={business.name} imageUrl={logoUrl}/><SidebarNav label="Main" items={[{href:'/radio',label:'Your radio',icon:Radio},{href:'/account',label:'Account',icon:User}]}/><SidebarSection>…Help…Sign out…</SidebarSection></>} mobileHeader={<MobileTopBar href="/radio" right={<Avatar …/>}/>} mobileNav={<MobileTabBar items=[Radio,Account]/>} playerBar={<MiniPlayer/>}>` inside PlayerProvider.
- The venue Sign out must run signOutOfVenue(). SidebarButton/UserMenu `onSelect`/`onClick` only work from a Client Component, so wrap them in a small client component.
- Render the player bar as a card (rounded-card border bg-surface) without outer margins; AppShell supplies the gutter and bottom spacing.
- Do not render another SkipLink or <main>; AppShell provides both.
- Auth UI owner (src/app/(auth)/_components/PasswordInput.tsx): you can switch to `PasswordInput` from `@/components/ui`, which has the same contract: aria-label="Show password" + aria-pressed + aria-controls={id}, and it accepts the props <Field> injects. After switching, the local copy can be deleted.
- Admin page owners (music, genres, businesses, announcements, settings):
- Render only content, starting with `<PageHeading title description actions/>` from `@/components/shell`. The shell already supplies the 16/24/32px padding and the 1600px max width.
- Use `SearchInput`, `StatusPill`, `GenreChip genreKey={slug}`, `DropdownMenu` for row "…" actions, `Drawer` for mobile editors, `TR selected`, `Card variant="selected"`, `Checkbox variant="tile"`, `SegmentedTabs`, `CoverImage artworkKey={slug} src={coverUrl}` and `Waveform`.
- The Settings link targets /admin/settings, so that page must exist.
- Admin routes (not owned: src/app/admin/not-found.tsx): please add a not-found.tsx under /admin so that notFound() in admin pages keeps the admin shell. Today it falls through to the root not-found, which replaces the shell.
- Auth/reset owner: the Administrator account menu and the mobile drawer link "Change password" to /reset-password (ADMIN_CHANGE_PASSWORD_PATH). Per REDESIGN §2 that page must accept already signed-in users.
- Tests/data owner: src/lib/data/admin/overview.ts is no longer used by the app, because /admin now redirects to /admin/music. It is kept only because tests/auth/admin-overview.test.ts imports it. Delete both together if you agree.
- Docs owner (docs/ARCHITECTURE.md §10, docs/build-notes): please record the shell and primitive APIs from this report. Key facts: `@/components/shell` components render on the server, so lucide icon components may be passed from Server Components; the new tokens and utilities are bg-control, eyebrow, page-title, hero-title, section-title, px-page and *-safe; AppShell publishes --shell-header-h and --shell-bottom-h on <html>; the Dialog focus-return fix is in place.

### Open issues

- No real-browser interaction test was possible: next dev/build were off-limits and the static preview has no hydration. These are covered only by unit/SSR tests and code review:
- DropdownMenu keyboard handling and top-layer popover positioning
- Drawer slide-in
- Dialog focus return after unmount (the demo is at /dev/ui 'Dialog unmounted while open')
- AdminMobileMenu closing on navigation
- ShellMetrics ResizeObserver
- the CoverImage/Avatar broken-image fallback
Please run a quick check at /dev/ui and /dev/ui/shell in Chrome and Safari.
- DropdownMenu needs the Popover API (Chrome 114+, Safari 17+, Firefox 125+). Without it the menu still works as a fixed-position element but is not in the top layer. Menus that use `action` items render a hidden <form>, so do not put such a menu inside another <form>.
- Genre chip colours come from a hash of the key (slug/id recommended), so they will not match the mock's exact House=green / Jazz=blue pairing. Pass `tone` explicitly if a fixed mapping is wanted.
- useModalDialog re-runs its open effect if initialFocusRef/returnFocusRef change identity. Pass stable useRef objects, never inline `{ current }` objects.
- The static visual QA used the system font (Inter is not loaded outside Next) and dark default artwork, so final type metrics should be re-checked in the running app.
- The shared scratchpad is used by parallel agents: another agent's files (scratchpad/site/*, build-css.cjs) share the directory. My preview tooling is kept in scratchpad/uif-tools and scratchpad/uif. A static preview server (node, port 4517) was started in the background for QA and ends with this session.

## public-auth-v2

### Public API

ROUTES
- `/` = src/app/(public)/page.tsx (force-dynamic). Public for everyone, including signed-in users and setup mode. The old session redirects are gone. It still forwards auth email callbacks that land on the root (`?token_hash` / `?code` / `?error(_code)`) to `/auth/confirm` via confirmForwardQuery. Section order: Hero → AudienceRow → HowItWorks (#how-it-works) → GenreCollection (#genres) → FeatureSection → Faq (#faq) → CtaBand.
- `(public)/layout.tsx` (force-dynamic): SkipLink, `<PublicHeader viewerRole>`, `<main id="main-content" tabIndex={-1}>`, `<PublicFooter/>`.
- `/request-access`: public form. Server action `requestAccess(prev: RequestAccessState, fd)` in src/app/(public)/request-access/actions.ts. Steps, in order:
  - zod validation (schema in `_lib/schema.ts`) → field errors, with the typed values echoed back.
  - honeypot field `frk_hp`: if filled, answers `sent` and stores nothing.
  - `canStoreAccessRequests()`: if false, answers "Requests can’t be sent yet: the service is not configured…".
  - `await connection()`.
  - rate limits via consumeRateLimit: `access-request:ip:{ip}` 5 per 3600 s, then `access-request:email:{email}` 3 per 86400 s. Both fail closed. Keys go through rateLimitKey, so they stay ≤200 chars.
  - insert into `access_requests` with createSupabaseAdminClient. Only business_name, business_type, contact_name, email (lower-cased), phone|null and message|null are written; status keeps its 'new' default and nothing is auto-approved.
  - results: success → `{ok:true, outcome:'sent'}`; 23505 → `{ok:true, outcome:'duplicate'}` (friendly, not an error); anything else → `{ok:false}` with an honest message.
- `/privacy` and `/terms`: platform_settings text rendered as plain paragraphs (split on blank lines, React text nodes, CSS pre-line; never HTML). Otherwise shows "Our privacy policy hasn’t been published yet" or "Our terms of service haven’t…" with a contact path (mailto:contact_email when set, else /request-access). A failed read shows a separate "couldn’t be loaded" state.
- `/login`, `/forgot-password`: screen 02 split layout. Each page calls getPublicViewer(); a signed-in user is redirected to resolvePostLoginPath(next, role) or homePathForRole(role) (the proxy can't see the role).
  - All existing login behaviour is kept: rate limits, generic errors, safeNextPath, the ?error= codes and session_expired.
  - Link errors (otp_expired, link_invalid, link_other_browser, verify_failed) show a "Request a new link" button → /forgot-password.
  - Both actions now answer "…not configured" in setup mode before touching the limiter or Supabase.
- `/reset-password` (new): replaces /set-password.
  - Action: `resetPassword(prev: ResetPasswordState, fd)` in (auth)/reset-password/actions.ts. `ResetPasswordState = ActionState & { sessionEnded? }`.
  - No session → redirect to `/login?next=%2Freset-password`. On success → the role's home page.
  - When `sessionEnded`, the form offers "Request a new link" (/forgot-password) and "Log in".
  - Setup mode: the page renders and the action answers "not configured".
- `/set-password`: `permanentRedirect('/reset-password')` (308).
- `/auth/confirm`: restyled. Invite/recovery `next` now defaults to `/reset-password`; an explicit safe `next=/set-password` from older templates is still honoured. Broken links show "Request a new link" and "Go to log in". `/auth/signout` is unchanged.
- `/setup`: restyled centered shell. Once configured, its button is "Go to log in" → /login.

PROXY — src/lib/auth/proxy-rules.ts; decideProxyAction has the same signature. New exports:
- `ADMIN_AREA_PREFIX = '/admin'`
- `BUSINESS_AREA_PREFIXES = ['/radio','/account','/help']`
- `PROTECTED_PREFIXES = ['/admin','/radio','/account','/help','/reset-password']`
- `GUEST_ONLY_PREFIXES` (kept for documentation; the redirect is now done by the pages)
- `SETUP_MODE_PUBLIC_PREFIXES`, `isSetupModePublicPath(p)`, `RESET_PASSWORD_PATH`

Rules:
- Setup mode: `/` (exact), /login, /forgot-password, /request-access, /privacy, /terms, /reset-password, /brand, /setup, /dev and /api/dev all pass. Other /api paths get 503 JSON; everything else redirects to /setup.
- Configured: a signed-out visitor on a protected path goes to /login?next=… . Everything else (the homepage, public pages, guest-only pages, /set-password) is `next`.

DATA — src/lib/data/public.ts (server-only; nothing in it throws):
- `getPublicViewer(): Promise<{role: AppRole} | null>`
- `loadPublicGenres({client?}): Promise<{genres: PublicGenre[]; source: 'catalogue' | 'default'}>`
  - Uses the secret-key client and `await connection()`.
  - Reads only `genres` rows with `is_enabled` and `available_to_all`, ordered by sort_order then name, limit 24. Selects id, slug, name, description and cover_path only; never tracks.
  - Covers are signed with `storage.from('genre-covers').createSignedUrls(paths, 3600)`.
  - Falls back to `DEFAULT_PUBLIC_GENRES` when Supabase or the secret key is missing, there are no rows, or the query fails. The defaults are House, Lounge, Jazz, Deep House, Balkan Hits and Chillout, with the descriptions from the screens.
  - `PublicGenre = {key, slug, name, description|null, artworkUrl}`
- `loadPublicSettings({client?}): Promise<{status:'ok', settings: PublicSettings} | {status:'unavailable'}>`. Uses the visitor's own server client; anon can read this table. Blank values → null.
- `canStoreAccessRequests()`
- `insertAccessRequest(client, input): Promise<{ok:true} | {ok:false, reason:'duplicate'|'failed'}>`
- Also exported: `EMPTY_PUBLIC_SETTINGS`, `PUBLIC_GENRE_LIMIT`, `PUBLIC_COVER_URL_TTL_SECONDS`

COMPONENTS — src/components/public (props-driven, usable by /dev previews):
- `PublicHeader({viewerRole: AppRole | null})`, with `accountLinkFor(role)`:
  - visitors: Log in → /login
  - business users: Open radio → /radio
  - admins: Admin workspace → /admin
- `PublicFooter()`
- `Hero()`: exports `EXAMPLE_STATION`. The card is labelled "Example station"; the pause glyph is aria-hidden and is not a control.
- `AudienceRow()`
- `HowItWorks()`: exports `HOW_IT_WORKS_STEPS`
- `GenreCollection({genres})` (client component):
  - 3 photo cards and 3 compact cards.
  - "Explore all genres" is a disclosure button (aria-expanded/aria-controls), shown only when there are more than 6 genres.
  - Play links go to /login with aria-label "Log in to play {name}".
  - Artwork uses the shared CoverImage.
- `FeatureSection()`
- `Faq()`: exports `FAQ_ITEMS` with the exact handoff answers; built on native details/summary, first item open.
- `CtaBand()`
- `PolicyPage({title, noun, plural?, kind, result})`, plus `policyParagraphs(text)` in policy-text.ts
- `RequestAccessForm({action, contactEmail?})` and `RequestAccessResult({state, contactEmail?})`
- `FormHeading({eyebrow?, title, description?, id?})`, `FORM_LINK_CLASSES`, `FormDivider`
- `VenuePhoto({sizes, eager?, alt?, imageClassName?, overlays?})`
- request-access-options.ts: `BUSINESS_TYPE_OPTIONS`, `BUSINESS_TYPE_VALUES`, `ACCESS_REQUEST_LIMITS`, `HONEYPOT_FIELD`, `RequestAccessValues`
- layout.ts: `PUBLIC_CONTAINER`, `SECTION_TITLE_CLASSES`, …

AUTH UI — src/app/(auth)/_components:
- `AuthSplitShell({children})`: 55/45 photo/form split on desktop; single column with a small photo header on smaller screens.
- `AuthShell({children, width?})`: centered shell, used by /setup.
- `AuthCard({eyebrow?, title, description?, children?, footer?})` and `AUTH_LINK_CLASSES`
- The local PasswordInput was removed; forms now use PasswordInput from @/components/ui.

### Cross-module requests

- docs/ARCHITECTURE.md §7 (and the build-notes auth-shell entry): please record the new routes and rules. (a) `/` is the public homepage and still forwards root-level auth callbacks to /auth/confirm. (b) New public routes /request-access, /privacy and /terms. (c) /reset-password replaces /set-password, which now 308-redirects to it. (d) /auth/confirm defaults invite and recovery links to /reset-password. (e) Proxy: in setup mode it lets through `/`, /login, /forgot-password, /request-access, /privacy, /terms, /reset-password and /brand. /help and /reset-password are protected. Signed-in users on /login and /forgot-password are sent to their role home by the pages themselves via getPublicViewer(), because the JWT carries no role; the proxy no longer redirects them to `/`. (f) Access-request limits are 5 per hour per IP and 3 per day per email, both fail closed; a filled honeypot field `frk_hp` is dropped silently.
- admin-businesses owner (src/lib/data/admin/businesses.ts buildAuthConfirmLink, plus its tests): change `next=/set-password` to `next=/reset-password`. The old value still works through the 308 redirect, but costs an extra hop.
- scripts owner (scripts/lib/admin-invite.ts buildConfirmLink, scripts/tests, docs/SEEDING.md): same change, `next=/set-password` → `next=/reset-password`.
- venue-ui owner (src/app/(venue)/account/page.tsx): point the change-password ButtonLink at /reset-password instead of /set-password.
- admin-businesses owner (access-request list at /admin/businesses/requests): rows arrive from this form with status 'new', email lower-cased, text trimmed, and blank phone or message stored as null. Business types use the enum values cafe, restaurant, hotel, bar and other.
- admin settings owner (/admin/settings): privacy_policy and terms_of_service are rendered as plain text, with blank lines separating paragraphs. Please say so in the field hint. contact_email is used as a mailto link on /privacy, /terms and the request-access success panel.
- dev-previews owner (src/app/dev/**, REDESIGN §7): /, /login, /forgot-password, /reset-password, /request-access, /privacy and /terms all render without Supabase in setup mode. The components take props (PublicHeader({viewerRole}), GenreCollection({genres: DEFAULT_PUBLIC_GENRES}), RequestAccessForm({action})), so /dev/preview/home and /dev/preview/login can reuse them, passing a no-op action.
- brand owner (src/components/brand/BrandLogo.tsx): BrandLogo passes next/image's `priority` prop, which Next 16 deprecates in favour of `preload`, `loading="eager"` or `fetchPriority`. Consider switching.
- admin-shell owner: tests/auth/admin-nav.test.ts and the admin-shell and admin-index parts of tests/auth/ui-render.test.ts sit in my folder but test your module. I rewrote them against your current source: new nav items, ADMIN_HOME_PATH /admin/music, /admin redirecting there, ADMIN_CHANGE_PASSWORD_PATH '/reset-password'. Please move them to your own tests (e.g. tests/admin/shell) and own them from here on.

### Open issues

- Not run against a live Supabase project: the secret-key insert into access_requests and the 23505 → duplicate mapping, `storage.from('genre-covers').createSignedUrls` for homepage covers, and the anon read of platform_settings through the visitor's server client. All were verified only with fakes.
- No `next dev` or `next build` run. The visual check used a static render with Tailwind compiled separately, without Inter (system font fallback) and without hydration. Client-side interactions are unit/SSR-tested only, not clicked through in a browser: the Explore-all-genres toggle, focus moving to the result heading after submitting, focus moving to the first invalid field, and the show/hide password toggle.
- The homepage, the public layout and the auth pages are force-dynamic, because they read the session and sign covers. Each homepage request runs one genres query plus one createSignedUrls call with the secret key; there is no caching.
- With exactly 6 or fewer public genres, as with the default list, the 'Explore all genres' control is hidden because there is nothing to expand. The hero's 'Explore genres' button scrolls to the section.
- The default genre list appears whenever the catalogue has no public genres, as the spec asks. It is illustrative and not labelled as such on the page.
- The homepage FAQ uses its own details/summary markup, bordered rows with +/− as in screen 01, rather than ui Accordion, whose chevron-and-divider look differs from the screen. PasswordInput, Waveform and CoverImage now come from @/components/ui, and my local duplicates were removed.
- The feature section reuses the only supplied venue photo (the same one as the hero), zoomed toward its left side. A second venue photograph would make it closer to the design.

