# Feature module notes (build notes)

Generated from the feature build agents' reports (2026-09-25).

## player-api

### Public API

## src/lib/data/player.ts
Server-only (`import "server-only"`). Every function takes the user's own client (`TypedSupabaseClient`), so RLS applies. The business id always comes from the ctx.

- `loadPlayerBootstrap(supabase: TypedSupabaseClient, ctx: BusinessUserSessionContext): Promise<PlayerBootstrap>`
  - Runs 5 queries in parallel: business row (`eq id ctx.business.id`), visible genres ordered by `sort_order` then `name`, `rpc('genre_track_counts')`, the preferences row (`user_id`/`business_id` from ctx), and active announcements.
  - Then signs the logo with `signLogoObject(userClient)`. `logoUrl` is null when there is no logo_path or on ANY signing failure (logged with console.warn, never thrown).
  - `trackCount` = `playable_count`, or 0 when the genre is missing from the RPC result.
  - `preferences` defaults to `{genreId:null, volume:0.8, muted:false}`. A saved genreId that is no longer among the visible genres becomes null (volume and muted are kept). Volume is clamped to 0..1.
  - `announcementCounts`: `welcome` counts placement welcome|both, `rotation` counts rotation|both. Only playable rows are counted (status active, !needs_review, audio_path set, `branding_version === business.branding_version`).
  - numeric columns are converted with Number().
  - Throws `PlayerDataError` (the cause is the PostgREST error) when a query fails or the business row is not visible.
- `class PlayerDataError extends Error` (name "PlayerDataError").
- `DEFAULT_PLAYBACK_PREFERENCES`: frozen `{genreId:null, volume:0.8, muted:false}`.
- `TRACK_PAGE_SIZE = 1000`.
- Helpers used by the routes:
  - `isGenreVisible(supabase, genreId): Promise<boolean>`
  - `listGenreTracks(supabase, genreId): Promise<TrackSummary[]>`. Uses an inner join via `track_genres!inner(genre_id)` with filters `eq track_genres.genre_id`, `is_active=true`, `removed_at is null`. Order is `created_at`, then `id`. Pages through results with `.range()` in pages of 1000 (at most 50 pages). Rows are re-checked in code, and rows with an invalid duration are skipped.
  - `findSignableTrack(supabase, trackId, genreId): Promise<SignableTrack|null>`
  - `loadAnnouncementPlayback(supabase, businessId): Promise<AnnouncementPlayback|null>`
  - `findSignableAnnouncement(supabase, businessId, announcementId): Promise<SignableAnnouncement|null>`
  - `savePlaybackPreferences(supabase, ctx, update): Promise<{ok:true, preferences} | {ok:false, reason:'rejected'}>`
    - Upserts with onConflict `user_id,business_id`. The payload contains only the provided fields plus `user_id`/`business_id` from ctx.
    - When `genreId` is omitted and the stored genre is no longer visible (checked through the embed `genres ( id )`), it also writes `genre_id: null`. Without this, the RLS with-check would refuse every later volume or mute save.
    - 42501 or 23503 → `rejected`. Other errors throw `PlayerDataError`.

## Routes
All routes:
- `export const dynamic = "force-dynamic"`
- call `requireBusinessUserApi()` first; its 401/403/503 responses are passed through unchanged
- are wrapped in try/catch → `jsonServerError` (generic 500, cause logged)
- send every response with `Cache-Control: private, no-store` (jsonOk/jsonError)

- **`GET /api/player/genres/[genreId]/tracks`** (typed with `RouteContext<'/api/player/genres/[genreId]/tracks'>`) → `GenreTracksResponse {genreId, tracks, fetchedAt}`.
  - A genreId that is not a uuid → 400 invalid_request with `fields.genreId`.
  - A genre not visible under RLS → 404 not_found.
- **`GET /api/player/announcements`** → `AnnouncementsResponse`.
  - `settings.everyNTracks`, `settings.volume` and `brandingVersion` are numbers.
  - Returns playable announcements only, and re-checks branding_version and audio_path in code. `durationSeconds` is a number or null.
  - Business row not visible → 403 no_business (`ACCESS_DENIALS.noBusiness`).
- **`PUT /api/player/preferences`** → `UpdatePreferencesResponse {preferences}`.
  - Uses readJson with updatePreferencesRequestSchema: wrong Content-Type → 415, bad JSON or `{}` → 400, and unknown keys such as businessId/userId are stripped.
  - A genreId that is not visible → 403 forbidden ("That genre is not available to your venue. Choose another genre.", `fields.genreId`), and nothing is written.
  - An RLS with-check refusal → 403 forbidden.
- **`POST /api/media/sign`** → `SignedMedia`.
  - Order of checks: readJson(signMediaRequestSchema), then `consumeRateLimit({key:'media-sign:'+userId, max:900, windowSeconds:600, failClosed:false})`. A denial → `rateLimitErrorResponse` (429 rate_limited). Invalid bodies never consume the bucket.
  - **Track**: must be playable, linked to genreId and visible under RLS, otherwise 404 unavailable. Signed with `signAudioObject(userClient, 'music', storage_path, duration)`. The response includes title, artist and durationSeconds.
  - **Announcement**: `eq business_id ctx.business.id`, and must be playable with `branding_version === business.branding_version`, otherwise 404 unavailable. Signed from the 'announcements' bucket, with durationSeconds (number or null).
  - `MediaSigningError.notFound` → 404 unavailable. Any other signing error → 500 server_error.

### Cross-module requests

- venue-ui / (venue) layout owner: call loadPlayerBootstrap(await createSupabaseServerClient(), ctx) only when you have a BusinessUserSessionContext. A VenueSessionContext from requireBusinessUserPage() whose business is null or inactive must show the 'not linked' or 'venue not active' state instead. Narrow it with checkBusinessUserAccess(ctx) from '@/lib/auth/access' (ok ⇒ decision.ctx is typed BusinessUserSessionContext). loadPlayerBootstrap throws PlayerDataError on query failure or when the venue row is not visible. Let it reach error.tsx, or catch it and show an honest error. It never throws because of the logo (logoUrl becomes null).
- docs/ARCHITECTURE.md §7/§9 owner, please record these behaviours:
- (a) PUT /api/player/preferences with genreId omitted clears a stored genre that is no longer accessible. Otherwise the RLS with-check (genre_id null or accessible) would reject every later volume or mute save.
- (b) GET /api/player/genres/[id]/tracks returns 404 not_found for an invisible genre. It pages through tracks with range() in pages of 1000, which assumes PostgREST max_rows ≥ 1000 (the Supabase default).
- (c) POST /api/media/sign validates the body before consuming the media-sign rate-limit bucket (900 per 10 min, fail-open), and returns 404 unavailable for any item that is not eligible or whose Storage object is missing.

### Open issues

- Only tested against an in-memory fake PostgREST client, not a live Supabase instance. Four behaviours are standard PostgREST but still unverified:
- (1) `tracks.select('..., track_genres!inner(genre_id)').eq('track_genres.genre_id', X)` returning only tracks linked to X, combined with `.range()`.
- (2) the embed `playback_preferences.select('genre_id, genres ( id )')` returning genres = null when RLS hides the genre.
- (3) a single-object upsert with onConflict 'user_id,business_id' inserting column defaults for omitted fields and updating only the columns in the payload.
- (4) Storage `createSignedUrl` with the user's JWT returning statusCode '404'/'403' for objects that Storage RLS refuses, which maps to 404 unavailable.
- Track-list paging stops at the first page shorter than 1000 rows. If a project sets PostgREST max_rows below 1000, lists would be silently truncated to one page.
- PUT /api/player/preferences has no rate limit (none was specified; the engine debounces saves by 1 s).
- The 429 from /api/media/sign carries no Retry-After, because the position within the fixed window is unknown to the route.

## venue-ui

### Public API

ROUTES / PAGES
- src/app/(venue)/layout.tsx (dynamic = "force-dynamic", typed LayoutProps<"/">). It calls requireBusinessUserPage(). No business → VenueStatusScreen "no-business" (shows the email, Sign out). Inactive business (checkBusinessUserAccess fails) → "inactive" screen: "This venue is not active yet — contact your administrator", with Sign out and no player. Otherwise it calls loadPlayerBootstrap(await createSupabaseServerClient(), access.ctx) from '@/lib/data/player'. If that throws, unstable_rethrow runs and then an "unavailable" screen shows with Try again (router.refresh) and Sign out. On success it renders <PlayerProvider key={userId:businessId}> containing SkipLink, VenueHeader (StationLogo, station name, business name, next/link nav Radio /radio and Account /account with aria-current, Sign out), <main id="main-content" tabIndex=-1>, a "Powered by {PLATFORM_NAME}" footer and <MiniPlayer/>.
- /radio (src/app/(venue)/radio/page.tsx): force-dynamic, requireBusinessUserPage("/radio"), and generateMetadata sets title = the station name. Renders <RadioPlayer/>.
- /account (src/app/(venue)/account/page.tsx): force-dynamic, metadata "Account", requireBusinessUserPage("/account"). Cards:
  - Venue: name, station, signed-in email.
  - StationSummary (client): live status and now playing, plus the announcement rule from the bootstrap.
  - Password: ButtonLink /set-password, with a note that the radio stops.
  - Sign out.
- GET|HEAD /api/dev/audio/[id]: 404 JSON when NODE_ENV === 'production'.
  - The id must be a slug and is looked up in supabase/seed/audio/manifest.json. It serves entry.file only; request paths are never joined.
  - Responses: audio/mpeg, Accept-Ranges: bytes, 206 with Content-Range, 416 with `bytes */size`, ETag = sha256, If-Range honoured, Cache-Control private, no-store.
  - The body streams via createReadStream plus Readable.toWeb.
  - Optional ?exp=<epoch ms>: after that time it answers 400 like an expired Supabase signed URL.
  - Unknown id → 404 not_found. Missing or invalid manifest → 503 unavailable, with the message "Run `npm run demo:audio`".
- /dev/player-lab (src/app/dev/player-lab/page.tsx, force-dynamic; the /dev layout already 404s in production).
  - The server reads the manifest and builds the catalogue with buildLabCatalog. The client <PlayerLab> runs the real createPlayerEngine(createBrowserEngineDeps({api: fake, log}), config, SHORT_TUNING | defaults).
  - Setup: demo venue EmeraldBar or Hotel Aurora, everyNTracks 1–10, timings shortened or production, and "Apply & restart engine".
  - Transport: primary action, Skip, Retry, VolumeControl.
  - Genre cards, including the empty "Pop" genre and a "Removed genre" that returns 404, which triggers genre_unavailable.
  - Fault switches: next sign → 410 (one-shot); next track URL → broken (one-shot); announcements fail (500); API offline (network); session expired (401); slow API (1.5 s); short-lived URLs (20 s, via ?exp).
  - Live snapshot view (plus raw JSON) and an event log (engine log hook, fake API calls, lab actions, snapshot transitions; last 400 kept).
  - Labelled as a development tool using synthetic audio. It needs no Supabase.

COMPONENTS / FUNCTIONS (src/components/player)
- PlayerProvider.tsx ('use client'):
  - `PlayerProvider({ bootstrap: PlayerBootstrap; children })`
  - `usePlayer(): PlayerContextValue`, which throws outside the provider.
  - `useOptionalPlayer(): PlayerContextValue | null`
  - `signOutOfVenue(destroyEngine?: () => void): Promise<void>`: destroy, then clearPlayerSessionState(), then fetch('/auth/signout', {method:'POST', redirect:'manual'}), then window.location.replace('/login').
  - `PlayerContextValue = { snapshot: PlayerSnapshot; commands: PlayerCommands; bootstrap: PlayerBootstrap; signOut(): Promise<void>; wakeLock: ScreenWakeLockControl }`
  - `ScreenWakeLockControl = { supported; active; error: string|null; enabled; setEnabled(b) }`
  - One engine is created in an effect from toEngineConfig(bootstrap) and destroyed on unmount. State goes through useSyncExternalStore with a static idle server snapshot. The engine persists preferences itself; they are not saved twice.
  - Screen Wake Lock is held while the keep-awake preference is on and status is playing, buffering or loading. It is re-acquired on visibilitychange.
- RadioPlayer, MiniPlayer (hidden on /radio via usePathname), GenrePicker({genres, selectedGenreId, playing, onSelect, label}), VolumeControl({volume, muted, controllable, onVolumeChange, onMutedChange, size?}), TrackProgress({positionSeconds, durationSeconds, loading?}), PlayerAlerts, PlayerSettings, PrimaryActionIcon, SignOutButton({variant?, size?, className?, label?}).
  - SignOutButton works with or without the provider.
- engine-store.ts: `class PlayerEngineStore(idleSnapshot)`
  - Members: subscribe, getSnapshot, getServerSnapshot, commands (stable, synchronous delegates), attach(engine), detach(engine), destroyEngine(), hasEngine.
- player-view.ts (pure):
  - Setup: resolveInitialGenreId, hasPlayableGenre, toEngineConfig, createIdleSnapshot.
  - Primary action: getPrimaryAction(snapshot, canStart) → {kind: start|pause|resume|unblock|retry|none, label, disabled}, runPrimaryAction(commands, kind), isAudioActive, isRetryableError.
  - Display: statusLabel, statusTone, statusMessage, describeNowPlaying, announcementCountdown, describePlayerError, volumeToPercent, percentToVolume, formatTrackCount.
- shortcuts.ts: `playerShortcutFor(e): 'toggle'|'mute'|'skip'|null`
  - Ignores text entry and sliders, Space on buttons, links or switches, Ctrl/Meta/Alt chords, key repeat and IME composition.
  - Also exports isModalDialogOpen(root) and PLAYER_SHORTCUT_KEYS.
- local-preference.ts: `createFlagPreference(key, default, {getStorage, getEventSource?})`, plus two instances:
  - shortcutsPreference ('radio-ui:keyboard-shortcuts', default on)
  - keepAwakePreference ('radio-ui:keep-screen-awake', default off)
- hooks.ts ('use client'): useFlagPreference(pref), useScreenWakeLock(shouldHold), usePlayerShortcuts(enabled, onShortcut: (s) => boolean).

### Cross-module requests

- docs/ARCHITECTURE.md §7 (docs owner): the route list says `GET /api/dev/audio/[file]`. It is actually `GET|HEAD /api/dev/audio/[id]`: id is a manifest entry id resolved via supabase/seed/audio/manifest.json, with single-range support (206/416/Accept-Ranges/ETag/If-Range) and an optional `?exp=<epoch ms>` that returns 400 after expiry, like a Supabase signed URL.
- docs/ARCHITECTURE.md §9/§10 and docs/build-notes/foundation-api.md (docs owner): record that the player-core open issue 'optional Screen Wake Lock not implemented' is now handled in the UI layer. PlayerProvider holds navigator.wakeLock ('screen') while the per-browser 'Keep screen awake' toggle (localStorage `radio-ui:keep-screen-awake`, default off) is on and status is playing/buffering/loading, and re-acquires it on visibilitychange. Keyboard shortcuts (Space/K, M, N) run only on /radio, with an on/off switch in localStorage `radio-ui:keyboard-shortcuts` (default on), and are ignored while an [aria-modal=true] dialog is open. Also list the src/components/player public API from this report.
- docs/ARCHITECTURE.md §13 (docs owner, optional): note that the venue logout uses `fetch('/auth/signout', {method:'POST', redirect:'manual'})` so fetch does not follow the 303 to /login (the Set-Cookie on the 303 is still applied), then `window.location.replace('/login')`. Also note that /set-password is outside the (venue) layout, so opening it from /account stops the player; the Account page says so.

### Open issues

- No real-browser verification (next dev/build forbidden here). Verified only by unit tests with fakes, a direct call of the route handler against the real demo files, and server-render smoke tests. Still needed: a listening check of /radio and /dev/player-lab in Chrome and Safari/iOS, covering autoplay unlock, blocked → Start audio, fades, and wake lock on real devices.
- The Screen Wake Lock hook is unverified on devices. It only prevents the screen from sleeping, not system sleep, and the UI says this honestly.
- Sign-out uses redirect:'manual'. Per the Fetch spec, the browser still applies Set-Cookie from the opaque 303. That is not verified against a live Supabase session.
- The genre list and trackCount on /radio come from the layout's bootstrap at page load. A genre newly assigned by an admin appears after a reload. The engine itself refreshes track lists, so emptied or disabled tracks and genres are handled live (empty / genre_unavailable states).
- PlayerProvider keeps the engine config from its first bootstrap (the provider is keyed by userId:businessId). If a later bootstrap arrives, e.g. after router.refresh, only the UI data updates, never the running engine. This is deliberate so music is not interrupted.
- The lab restarts the engine on 'Apply', and engine.destroy() clears the welcome key, so each restart plays the welcome again. This is intended for testing.
- turbopackIgnore comments were added to the dev-only manifest/audio path joins. I did not run next build, so the absence of the tracing warning in a production build is unconfirmed (the route returns 404 in production anyway).
- At the last check, other agents' files still had failures that are not mine: tsc errors in src/app/api/admin/announcements/[id]/generate/route.ts (possibly just stale typegen) and tests/auth/ui-render.test.ts, and 2 failing tests in tests/auth/forgot-password-action.test.ts and tests/auth/setup-env.test.ts.

## upload-api

### Public API

All three routes follow the same order: requireAdminApi() first, then `export const dynamic = "force-dynamic"`. Every response goes through jsonOk/jsonError (private, no-store). Request bodies are read with readJson plus the foundation zod schemas, so JSON Content-Type is required.

1. POST /api/admin/uploads/sign: SignUploadRequest in, SignUploadResponse out (exactly as in src/lib/api/contracts.ts).
   - Steps in order: await connection(); consumeRateLimit({key:`upload-sign:${userId}`, max:120, windowSeconds:600, failClosed:false}), answering 429 or 503 through rateLimitErrorResponse; signUploadRequestSchema; checkUploadFile, answering 413 payload_too_large, 415 unsupported_media or 400 with its message.
   - Target resolution uses the admin user's own client. Paths are built from database ids, never from the client's string:
     - 'track': crypto.randomUUID(), path `tracks/{newId}/{32hex}.mp3`, targetId null.
     - 'track-replace': the track must exist (else 404), path `tracks/{id}/{32hex}.mp3`.
     - 'announcement': must exist (else 404), and checkUploadAudio(toAnnouncementState(row), now) must pass (else 409 conflict with its reason). Path `{business_id}/{id}/{32hex}.mp3`.
     - 'logo': the business must exist (else 404), path `{business_id}/{32hex}.{png|jpg|webp}` using the checked extension.
   - It then mints createUploadToken({kind, bucket: UPLOAD_RULES[kind].bucket, path, targetId, userId}) and wraps it in the file-name envelope (below).
   - createSignedUploadUrl(path) is called on the admin user's client. Storage errors map to: 403 policy refusal, 503 with the bucket name when the bucket is missing, 409 when the object exists, 503 when Storage is down, generic 500 otherwise.
   - Returns {uploadToken, bucket, path, signedUrl, token, maxBytes}. A missing secret gives 503 unavailable.

2. POST /api/admin/uploads/complete: CompleteUploadRequest in, CompleteUploadResponse out. `maxDuration = 60`.
   - Steps in order: await connection(); rate limit `upload-complete:${userId}` (120 per 600 s, fail open); completeUploadRequestSchema; open the envelope; verifyUploadToken(token, {expectedUserId}). A bad token is 400 invalid_request; user_mismatch is 403 forbidden. Both use describeUploadTokenFailure's message.
   - The path layout and targetId are re-checked. The secret-key client downloads the object with cache no-store. A missing object gives 404 "The upload did not finish; please try again." A Storage outage gives 503 and keeps the object. Audio is checked with validateMp3(bytes, {maxBytes: UPLOAD_RULES[kind].maxBytes}); logos with validateLogo(bytes, the type implied by the path extension). Invalid content means the object is removed and the route answers 415 unsupported_media with the validator's reason.
   - Every DB write uses the admin user's client (RLS).
   - track:
     - Checks for replay (a row with this id means 409, object kept).
     - Checks that metadata.genreIds exist. If not: 400 with fields.genreIds, and the object is removed before any download.
     - Inserts the row: id from the path; title = metadata.title ?? tag title ?? fileNameToTitle(originalName); artist = metadata.artist ?? tag artist ?? 'Unknown Artist'; plus duration, size, bitrate, sample rate, original_filename, created_by and is_active true.
     - An insert failure removes the object. A 23505 (concurrent completion) answers 409 and keeps the object.
     - Then rpc('set_track_genres'). If that fails, the track row is deleted, then the object is removed.
     - Returns {kind:'track', track: toAdminTrack(row, genreIds)}.
   - track-replace:
     - Updates storage_path, duration, size, bitrate, sample rate, original_filename and mime_type. Title and artist change only when metadata supplies them; genreIds are ignored for replacements.
     - The update is guarded on the storage_path that was read. A lost update gives 409 and removes the new object.
     - The old object is removed only after the update succeeds.
     - Returns kind 'track-replace' with the unchanged genre ids.
   - announcement:
     - Re-runs checkUploadAudio (409 plus object removed if it fails).
     - Update: CLEARED_AUDIO_FIELDS plus audio_path, audio_duration_seconds, audio_size_bytes, source 'upload', status 'ready'. Cleared: needs_review (false), review_reason, approved_at/by, generation_hash, generation_started_at, voice_id/voice_name/model_id, last_error.
     - The update is guarded on status, audio_path and generation_started_at, so a generation that starts during validation gives 409 and the object is removed.
     - The previous audio is removed afterwards. Returns toAdminAnnouncement(row).
   - logo:
     - Updates businesses.logo_path, guarded on the old logo_path. The previous logo is removed afterwards.
     - Returns {kind:'logo', businessId, logoPath, logoUrl}; logoUrl comes from signLogoObject with the admin user's client.
     - If signing fails after the save, the route answers 500 with "The logo was saved, but its preview link could not be created…".
   - A replayed token (the row already points at this path) answers 409 "This upload has already been completed." and touches nothing. Metadata is ignored for announcement and logo.

3. POST /api/admin/media/preview: AdminPreviewRequest {kind, id} in, AdminPreviewResponse {url, expiresAt} out.
   - Track: any status, including disabled or removed.
   - Announcement: must have audio_path, otherwise 404 "no audio yet".
   - Signed with signAudioObject(admin user's client, bucket, path, duration). An unknown id is 404. MediaSigningError with notFound gives 404 "missing from storage"; any other signing error gives 500. A missing env var gives 503.

ORIGINAL FILE NAME DESIGN (documented in src/lib/data/admin/uploads.ts):
- The foundation token payload is a strict zod object with no field for the name, and CompleteUploadRequest.metadata strips unknown keys. So the `uploadToken` returned by /sign is an envelope: `<foundation payload>.<foundation sig>.<base64url(UTF-8 name)>.<HMAC-SHA256>`.
- The HMAC covers everything before it. Its key is derived with HKDF from UPLOAD_TOKEN_SECRET ?? SUPABASE_SECRET_KEY under its own label.
- The browser passes it back untouched; the existing uploadFile() needs no change.
- The name is sanitised when sealed and again when opened: base name only; control, zero-width, bidi and lone-surrogate characters replaced; whitespace collapsed; at most 255 characters without splitting a surrogate pair. The worst-case envelope stays under the 4096-character schema limit (tested).

Helpers exported from src/lib/data/admin/uploads.ts (server-only):
- Paths: randomObjectName, buildTrackObjectPath, buildAnnouncementObjectPath, buildLogoObjectPath, parseUploadObjectPath(kind, path), pathMatchesTarget, isLogoExtension, LOGO_CONTENT_TYPE_BY_EXTENSION.
- File names and envelope: sanitizeOriginalFileName, sealUploadEnvelope(token, name|null), openUploadEnvelope(envelope) returning {ok, uploadToken, originalFileName} or {ok:false, reason:'malformed'|'bad_signature'}.
- Storage: classifyStorageError; downloadStorageObject(admin, bucket, path, maxBytes) returning {ok, bytes} or {ok:false, reason:'missing'|'too_large'|'unavailable'|'failed'}; removeStorageObjects(admin, bucket, paths, context), which never throws and logs failures.
- DB errors: dbErrorResponse(context, pgError) maps 42501→403, PGRST116→404, 23505→409, 23503/23514/22023/22004/22P02→400, anything else → logged generic 500.

### Cross-module requests

- docs/ARCHITECTURE.md §8 (owner: lead/docs): please record these points. (a) The /sign `uploadToken` is an envelope around the foundation HMAC token, carrying the original file name as `<payload>.<sig>.<base64url(name)>.<HMAC>`. It is keyed by HKDF over the same secret with its own label and is implemented in src/lib/data/admin/uploads.ts. (b) /complete is rate-limited with `upload-complete:{userId}` at 120 per 600 s. (c) A replayed completion answers 409 conflict. (d) A missing object answers 404 'The upload did not finish; please try again.' (e) Metadata overrides: title, artist and genreIds for 'track'; title and artist only for 'track-replace'; ignored for announcement and logo. (f) An announcement upload clears voice_id/voice_name/model_id/generation_hash/generation_started_at/last_error, sets needs_review false and review_reason null, and clears the approval. (g) Logo validation derives the declared type from the path extension (png→image/png, jpg→image/jpeg, webp→image/webp).
- src/lib/api/contracts.ts (owner: platform-core), comment only: the CompleteUploadRequest.metadata doc says 'Only for kind "track"'. The implemented behaviour also applies title and artist, but not genreIds, for 'track-replace'. Please update the comment. No shape change is needed.
- docs/build-notes/foundation-api.md (owner: platform-core/audio-tts-libs): the note 'validateLogo(bytes, claims' contentType)' refers to a claim that does not exist, because UploadTokenPayload has no contentType. The upload API derives the declared type from the signed path's extension instead. Optionally, add an optional `fileName` (and `contentType`) claim to UploadTokenClaims in src/lib/uploads/token.ts. The envelope in src/lib/data/admin/uploads.ts could then be dropped. It works today without that change.
- Admin UI owners (admin-music, admin-businesses, admin-announcements): uploads complete through a Route Handler, not a Server Action, so nothing revalidates your page. After useUploadQueue's onUploaded (or uploadFile resolving), call router.refresh() or merge the returned AdminTrack/AdminAnnouncement/logoUrl into local state. Handle these statuses from /complete: 409 conflict (already completed, a generation is running, or the target changed: ask the admin to refresh or retry); 404 (the target was deleted, or the upload did not finish); 415 (the validator's reason, suitable to show as-is). For previews, POST /api/admin/media/preview with Content-Type: application/json and {kind:'track'|'announcement', id}. Its 404 messages are user-facing.

### Open issues

- Not verified against a live Supabase project (only against the in-memory fake): createSignedUploadUrl signed with the admin USER's client (the storage INSERT policy is checked at signing time); download/remove with the secret key; and the PostgREST equality filter on generation_started_at (timestamptz ISO string with '+00:00', which postgrest-js URL-encodes) used as the announcement concurrency guard.
- Ambiguous DB failures: if a tracks insert commits but its response is lost (a network error with no code), the route treats it as a failure and removes the object. The row would then point at a missing file. This is rare; a later preview shows 'missing from storage'.
- A replacement deletes the previous object as soon as the row points at the new one, as specified. A venue streaming the old file mid-track then gets a media error, and the engine re-signs and resumes at the same position in the NEW audio.
- Edge case: a 'track-replace' (or logo/announcement) token replayed within its 15-minute lifetime, after a later replacement whose old-object removal FAILED, could point the row back at that older object. This is admin-only (the same admin, bound by userId) and needs a prior storage-removal failure, which is logged.
- Orphaned objects are still possible when /complete is never called, e.g. the admin cancels during validation, closes the tab, or a download or lookup fails with an unknown DB state. The route removes objects only when it knows no row references them. A periodic cleanup job (list objects not referenced by any row, older than about 1 hour) would close this gap; the foundation already noted it.
- An object larger than the kind's limit at completion answers 415 unsupported_media (as the spec requires) rather than 413. In practice this cannot happen, because the bucket size limits reject such uploads first.

## auth-shell

### Public API

ROUTES / PAGES
- `/` (src/app/page.tsx, force-dynamic). The checks run in this order: (1) if Supabase is not configured, redirect to /setup; (2) if the URL carries an email-link callback (`token_hash`, `code` or `error`/`error_code`), forward only the whitelisted params (token_hash, type, next, code, sb_flow_id, error, error_code) to `/auth/confirm?…`; (3) otherwise redirect by session: signed out → /login, admin → /admin, business user → /radio.
- `/login` ((auth) group). Signs in with a Server Action. The page shows a notice for `?error=<code>`, but only for the known codes: otp_expired | link_invalid | link_other_browser | auth_unavailable | too_many_attempts | verify_failed | session_expired. Unknown values are never rendered. `?next=` is sanitised with safeNextPath and carried in a hidden field.
- `/forgot-password`. Always shows the same neutral confirmation, which explains that the link works once and expires after about an hour.
- `/set-password` (force-dynamic). Needs a session; without one it redirects to /login?next=%2Fset-password. It works for any signed-in user. The page wording follows the JWT `amr` claim (invite / recovery / change). On success it redirects to /admin or /radio.
- `/auth/confirm`. A page (force-dynamic, noindex, referrer no-referrer) that renders a Continue form. The token is only consumed on POST by the Server Action. Broken or expired links render an explanation plus "Go to sign in" and "Forgot password" links.
- `POST /auth/signout`: calls `signOut({scope:'local'})` and returns 303 with a relative `Location: /login` and `Cache-Control: private, no-store`. If Supabase fails to sign out, it deletes the `sb-*-auth-token(.N)` cookies itself. A cross-site Origin (compared with x-forwarded-host/host) gets 403. `GET` returns 405 with `Allow: POST`.
- `/setup`: works without Supabase. It lists variable NAMES with a status (never values) and the setup steps from docs/SETUP.md. Once configured, it shows "Setup complete". In production it then hides the checklist.
- `/admin` layout (force-dynamic, `requireAdminPage()`), wrapping pages in AdminShell. `admin/loading.tsx` is a skeleton with role=status. `/admin` is the overview page.

COMPONENTS (src/components/admin/shell, barrel index.ts)
- `AdminShell({ email: string; children: ReactNode })` (server). Contains the SkipLink, a sticky sidebar at lg+, a compact sticky top bar with horizontal nav below lg, a Change password link to /set-password, a Sign out form, and `<main id="main-content" tabIndex={-1}>` with a max-w-6xl padded container. Admin pages render only PageHeader and their sections.
- `AdminNav({ variant: 'sidebar' | 'bar'; className? })` (client, uses usePathname). The exact page gets `aria-current="page"`; a nested section gets `aria-current="true"`.
- `SignOutForm({ compact?: boolean; className? })`: a plain `<form action="/auth/signout" method="post">`.
- `ADMIN_NAV_ITEMS` (Overview /admin, Businesses, Genres, Music) and `adminNavItemState(pathname, item): 'page' | 'section' | null`.
- Auth UI in src/app/(auth)/_components: `AuthShell({children, width?: 'md'|'lg'})`, `AuthCard({title, description?, children?, footer?})`, `AUTH_LINK_CLASSES`, and `PasswordInput` (client; show/hide toggle; accepts the props Field injects).

DATA: src/lib/data/admin/overview.ts (server-only)
- `loadAdminOverview(supabase: TypedSupabaseClient): Promise<AdminOverview>` runs five parallel requests with the admin's own client: businesses with embedded `business_members(count)` and announcement status rows, genres, `genre_track_counts()`, and head counts for library and playable tracks. It throws `AdminOverviewError` on any query error.
- `buildAdminOverview(input: OverviewInput): AdminOverview` (pure). It returns counts for businesses {total, active, withoutMembers}, genres {total, enabled, enabledWithoutMusic}, tracks {total, playable, disabled} and announcements {total, active (on air), needsReview, failed, awaitingApproval (ready)}.
- It also returns `attention: AttentionItem[]` ({key, kind, severity, title, description, href, actionLabel}) sorted danger → warning → info. The kinds and their links:
  - announcements_failed, announcements_review, announcements_ready → /admin/businesses/{id}/announcements
  - business_no_members → /admin/businesses/{id}
  - business_no_announcements (active venues only, and only when no other announcement item explains it)
  - genre_empty → /admin/genres
- Plus `gettingStarted` steps, `setupIncomplete` and `isEmpty`. Helpers: `businessHref(id)` and `businessAnnouncementsHref(id)`.

SERVER ACTIONS (all 'use server'; only async exports)
- `signIn(prev: SignInState, fd): Promise<SignInState>` (login/actions.ts)
- `requestPasswordReset(prev: ResetRequestState, fd)` (forgot-password/actions.ts)
- `setPassword(prev: SetPasswordState, fd)`, where SetPasswordState adds `sessionEnded?` (set-password/actions.ts)
- `confirmEmailLink(fd): Promise<void>` (auth/confirm/actions.ts)
- Rate limits, all failClosed:false: login:email:{lowercased} 10/600s and login:ip:{first XFF hop (superseded: see ARCHITECTURE §3 CLIENT_IP_HEADER / TRUSTED_PROXY_HOPS) | 'unknown'} 50/600s; reset:ip 20/3600s and reset:email 5/3600s. Keys longer than 200 characters are replaced by `prefix:sha256:<hex>`.

PURE HELPERS in src/app/(auth)/_lib (unit-tested)
- `homePathForRole(role)`
- `resolvePostLoginPath(next, role)`: rejects unsafe paths, guest/auth/api pages and the other role's area.
- `describeAuthLinkError(code)`, `authLinkErrorCode(error)`, `authLinkErrorFromCallback`, `AUTH_LINK_ERROR_CODES`
- `describeSignInError`, `describePasswordUpdateError`, `describeWeakPasswordReasons`
- `validateNewPassword(pw, confirm)`: at least 10 code points, not all whitespace, at most 72 UTF-8 bytes, and must match the confirmation.
- `passwordPageMode(amr)`
- `parseConfirmParams`, `confirmForwardQuery`, `defaultConfirmDestination`, `describeConfirmPurpose`
- `clientIpFromHeaders`, `rateLimitKey`, `authRateLimit`

Setup: `describeSetupEnv(snapshot)` and `readSetupEnvSnapshot()` in src/app/setup/_lib/env-status.ts.

### Cross-module requests

- src/lib/env.ts (platform-core): please add a presence report such as `getEnvPresenceReport(): { name; status: 'set'|'missing'|'invalid'; need }[]`. It must return names only, never values, and list ALL missing Supabase variables. getSupabasePublicConfig() only names the first one. Until then, src/app/setup/_lib/env-status.ts reads presence with literal process.env.X reads and duplicates env.ts's URL rules. It is documented in the file and can then delegate to env.ts.
- src/app/admin/error.tsx (admin area, not owned by me): please add a 'use client' error boundary under the admin layout, for example Alert plus a `retry()` button. Today a thrown error in any admin page falls through to the root src/app/error.tsx, which replaces the whole admin shell. The overview page catches its own load errors, but other admin pages would lose the sidebar.
- admin-businesses: the overview links 'Add business' to /admin/businesses, where the create form lives per ARCHITECTURE §7. 'Invite staff' links to /admin/businesses/{id}, where the members/invites UI lives. If the create form gets an anchor or query (e.g. id="create-business"), tell me and I'll deep-link to it.
- admin-announcements: the overview links 'Fix' (failed), 'Review' (active + needs_review), 'Approve' (status ready) and 'Add announcement' to /admin/businesses/{id}/announcements. The overview counts needs-review as status='active' AND needs_review, matching describeStatus() in src/lib/announcements/state.ts.
- venue-ui / player owners: /login accepts `?error=session_expired` and then shows 'Your session has ended — please sign in again'. On engine errorCode auth_expired you can send users to `/login?error=session_expired&next=%2Fradio`. Sign-out: POST /auth/signout rejects cross-origin posts (403). The documented `fetch('/auth/signout', {method:'POST'})` is same-origin and works.
- docs/ARCHITECTURE.md §7 (orchestrator): please record these behaviours. (a) '/' forwards email-link callbacks (?token_hash / ?code / ?error_code) to /auth/confirm, so templates pointing at the site root still work. (b) /login?error= accepts only the AUTH_LINK_ERROR_CODES listed in the public API. (c) /auth/signout returns 405 on GET and 403 on cross-origin POST, and clears the sb-*-auth-token cookies itself if Supabase is unreachable. (d) Auth rate limits: login 10 per email and 50 per IP per 10 min; reset 5 per email and 20 per IP per hour. All fail open and depend on SUPABASE_SECRET_KEY. (e) Shared auth UI lives in src/app/(auth)/_components and _lib.
- docs/SETUP.md owner: mention the /setup page and that our login/reset rate limits need SUPABASE_SECRET_KEY (without it they fail open with a server warning). Also recommend enabling Supabase Auth rate limits or CAPTCHA, because the publishable key lets anyone call Supabase Auth directly and bypass our Server Action limits.

### Open issues

- Not verified against a live Supabase project, because there are no credentials. Unit tests with mocks cover:
- signInWithPassword, resetPasswordForEmail, verifyOtp, exchangeCodeForSession, updateUser and signOut
- cookie writes from Server Actions and the route handler
- the embedded `business_members(count)` PostgREST aggregate

Things that need a live Supabase test:
- The server client uses PKCE, so resetPasswordForEmail produces a `pkce_`-prefixed token_hash. The token_hash template plus verifyOtp is the documented Supabase pattern for this, and the parser accepts that prefix.
- The JWT `amr` claim is assumed to contain 'invite'/'recovery'. It is only used to word /set-password; the fallback is 'Change your password'.
- No real-browser or visual check. next dev and next build were off-limits, and the Browser pane refuses local files. The layout (sidebar/top bar breakpoints, card sizes) was checked only through the SSR markup and the compiled Tailwind classes. It needs a quick look in a browser at laptop, tablet and phone widths.
- Our rate limits only protect this app's endpoints. Anyone can call Supabase Auth directly with the public publishable key, so Supabase's own Auth rate limits (and optional CAPTCHA) remain the real protection. Per-email login limiting can also let someone temporarily lock out a known address (10 attempts per 10 min), as the spec requires.
- Forgot-password always gives the same neutral answer. Response timing can still differ slightly between existing and unknown accounts; that is inherent to Supabase /recover.
- loadAdminOverview reads the businesses list with embedded announcement rows in one query. PostgREST's max-rows (default 1000) would truncate more than 1000 businesses, which is fine at MVP scale. Track counts use head counts and are not affected.
- Invitees can choose 'Continue without setting a password' on /set-password. They stay signed in, and the page tells them they can set a password later with Forgot password.
- src/app/favicon.ico was deleted as instructed. Browsers use the <link rel=icon> for /icon.svg; a direct request for /favicon.ico now returns the 404 page.

## admin-announcements

### Public API

ROUTES
- GET /api/admin/tts/options → TtsOptionsResponse. Admin only.
  - No key, or a key ElevenLabs rejects → 200 {configured:false, reason}.
  - Temporary provider failures go through elevenLabsErrorToApi: 429 rate_limited, 502 tts_failed, 504 tts_failed.
  - EnvError → 503 unavailable.
  - `?refresh=1` passes forceRefresh:true. It is rate-limited with `tts-options-refresh:{userId}`, 10 per 600 s, fail open.
- POST /api/admin/announcements/[id]/generate: body GenerateAnnouncementRequest, response GenerateAnnouncementResponse. Admin only. `maxDuration = 60`, `dynamic = "force-dynamic"`. Steps in order:
  1. Bad or unknown id → 404. Bad body → readJson 400/415.
  2. A fresh generating lock → 409 (checkGenerate).
  3. getTtsOptions. Not configured → 503 tts_not_configured. A temporary provider error → mapped status.
  4. Unknown model → 400 with fields.modelId. Spoken text longer than the model's maxCharacters → 400.
  5. Language: `languageCode ?? announcement.language` must be one the model lists (when it lists any). Otherwise 400 with fields.languageCode.
  6. generationHash. If the hash matches, the audio exists, source is tts and force is not set → 200 {reused:true}. No provider call, no rate limit, no write.
  7. An on-air announcement (active and not flagged) → 409 with ON_AIR_GENERATE_REASON.
  8. consumeRateLimit `tts-generate:{adminId}`, 20 per 600 s, failClosed:true → 429, or 503 when the limiter is down.
  9. Atomic lock: one conditional UPDATE. It sets status 'generating', generation_started_at and generation_attempts+1. It is guarded by eq status, eq generation_attempts and the audio_path read earlier, plus `.or('status.neq.generating,generation_started_at.is.null,generation_started_at.lt."<now-3min>"')`. Zero rows → 409.
  10. synthesize with the server key: maxRetries 0, timeout 45 s, not tied to request.signal.
  11. validateMp3 with MAX_ANNOUNCEMENT_BYTES. Invalid → 502 tts_failed.
  12. Upload with the secret-key client to `{business_id}/{announcement_id}/{32hex}.mp3`, upsert false.
  13. Guarded final UPDATE (status generating, generation_started_at = this request's lock). Sets: status ready, source tts, audio fields, voice_id and voice_name (the server's voice name wins), model_id, language, generation_hash, and clears last_error, review flag and approval.
  14. Only after that UPDATE, the previous object is removed. If the lock was lost, the new object is removed and the route answers 409.
  - Any failure after the lock: status 'failed' with last_error when the row had no audio. When it had audio, the previous status and audio are kept and only last_error is set.
  - An auth or unknown-voice error also calls clearTtsOptionsCache().

PAGE
- /admin/businesses/[businessId]/announcements (page.tsx and loading.tsx). `force-dynamic`, requireAdminPage. It renders content only: PageHeader, list and sidebar, no shell.

SERVER ACTIONS (actions.ts)
Each one calls requireAdminAction first, returns ActionState, and revalidates `/admin/businesses/{id}/announcements` and `/admin/businesses/{id}`.
- updatePlaybackSettingsAction(businessId, prev, fd): fields announcementEveryNTracks (1–50) and announcementVolumePercent (10–100, stored ÷100).
- createAnnouncementAction(businessId, prev, fd): fields mode, templateKey, customText, placement, language, spokenText.
- updateAnnouncementAction(announcementId, prev, fd): fields text, spokenText, placement, language.
- approveAnnouncementAction(id, version|null) and activateAnnouncementAction(id, version|null). `version` is the updatedAt the admin saw.
- deactivateAnnouncementAction(id), deleteAnnouncementAction(id), duplicateAnnouncementAction(id), markGenerationFailedAction(id).

DATA (@/lib/data/admin/announcements, server-only)
- loadAnnouncementsPage(supabase, businessId): Promise<{business: AnnouncementBusiness; announcements: AnnouncementItem[]; now: number; suggestedVoiceId: string|null} | null>. Returns null for an unknown venue and throws AnnouncementsDataError on DB errors.
- toAnnouncementItem(row, approverEmail?) and toAnnouncementBusiness(row).
- The mutation functions (deps, …) → {state: ActionState, businessId}: updatePlaybackSettings, createAnnouncement, updateAnnouncementWording, approveAnnouncement, activateAnnouncement, deactivateAnnouncement, deleteAnnouncement, duplicateAnnouncement, markGenerationFailed. Also createAnnouncementMutationDeps(userId, supabase) and STALLED_GENERATION_MESSAGE.

PURE RULES (@/components/admin/announcements/rules, client-safe; the business detail page can reuse them)
- Types: AnnouncementItem (AdminAnnouncement plus brandingVersion, generationAttempts, audioSizeBytes, approvedByEmail) and AnnouncementBusiness.
- needsReview(a, business): the flag, or approval under an older branding version.
- withEffectiveReview, isOnAir(a, business), checkGenerateInPlace(a, business, now), generationFailureStatus(prev, hadAudio).
- availableActions(a, business, now) → RuleCheck for each of: preview, approve, activate, deactivate, editWording, uploadAudio, generate, duplicate, remove, markFailed. Approve is hidden when Activate applies.
- primaryAction, describeAnnouncement(a, business, now).
- summarizeAnnouncements(items, business, now) → {total, onAir, onAirWelcome, onAirRotation, awaitingApproval, needsReview, failed, generating, withoutAudio}.
- sourceLabel, modelLabel, spokenWording, asSentence, volumeToPercent, ON_AIR_GENERATE_REASON.

UI
- AnnouncementsManager takes {business, announcements, serverNow, suggestedVoiceId, actions: AnnouncementServerActions}. While any row is generating it refreshes every 3 s, capped at about 70 refreshes per generation, and keeps a clock aligned to server time.
- Also built: AnnouncementCard, Create/Edit/GenerateAudio dialogs, AnnouncementUpload (uploadFile kind 'announcement', progress, cancel, confirm before replacing approved audio), AudioPreview (POST /api/admin/media/preview, then audio controls), PlaybackSettingsForm and VenueSummaryCard.

RULE CHOSEN FOR ACTIVE ANNOUNCEMENTS
- An on-air announcement is never regenerated in place: the route answers 409. The admin uses Duplicate (generate and approve the copy while the original keeps playing, then deactivate the original) or deactivates it first.
- A flagged announcement is already off air, so it may be regenerated.
- A failed generation never removes existing audio.
- This rule is shown in the page's "How announcements work" card, on each card's hint, and in the edit and upload warnings.

### Cross-module requests

- docs/ARCHITECTURE.md §5.2 (state machine), owner of ARCHITECTURE: please record the generation rules. (a) An on-air announcement (status active and needs_review false) is never regenerated in place: POST /generate answers 409; the admin duplicates it (copy → generate → approve, then deactivate the original) or deactivates it first. (b) generating → failed only when the row had no audio; when it had audio (ready, a flagged active one, or a stale lock), the previous status and audio are kept and only last_error is set. A stale lock with audio falls back to 'ready'. (c) A successful generation sets status ready and clears approved_at/by, needs_review and review_reason. (d) The lock is one conditional UPDATE guarded by status, generation_attempts and audio_path plus an 'or(status.neq.generating, generation_started_at.is.null, generation_started_at.lt.<now-3min>)' condition; the final UPDATE is guarded by status 'generating' and this request's generation_started_at.
- docs/ARCHITECTURE.md §6/§7: add src/lib/data/admin/announcements.ts (page loader and announcement mutations) and src/components/admin/announcements/rules.ts (pure admin rules: availableActions, isOnAir, summarizeAnnouncements, ...). Document GET /api/admin/tts/options?refresh=1, which bypasses the 10-minute cache and is rate-limited with tts-options-refresh:{userId}, 10 per 10 minutes.
- docs/build-notes/foundation-api.md, audio-tts-libs note, generate step 2: the route resolves the language from `request.languageCode ?? announcement.language` rather than the business language. The announcement's language already defaults to the venue's at creation, and an explicit announcement language such as 'hr' at a 'bg' venue must win. In step 4 the route deliberately does NOT pass request.signal to synthesize, so a closed tab doesn't throw away a paid generation.
- Upload-api owner, src/lib/data/admin/uploads.ts: the generate route and the announcement mutations import buildAnnouncementObjectPath, removeStorageObjects and dbErrorResponse from this file. Please keep those signatures stable.
- admin-businesses owner, /admin/businesses/[businessId]: for the announcement summary you can call summarizeAnnouncements(items, business, now) from '@/components/admin/announcements/rules'. It gives on-air counts by placement, awaiting-approval, needs-review (branding-version aware) and failed/stale counts. Items can come from loadAnnouncementsPage() or your own query mapped with toAnnouncementItem(). Link to `/admin/businesses/${id}/announcements`. My actions already revalidate `/admin/businesses/${id}`.
- auth-shell owner, src/app/admin/layout.tsx: my page renders content only, with no outer padding or max-width. The admin <main> should provide the page padding and width.
- Foundation owner, src/lib/announcements/state.ts (optional, cosmetic): describeStatus() appends review_reason directly before 'It is off air…', but the DB trigger's reasons have no final period. I work around it with asSentence() in rules.ts; adding the period in describeStatus would fix it for every caller.

### Open issues

- Not tested in a browser (next dev was not allowed). Unchecked: layout at laptop, tablet and phone widths; native <dialog> focus handling with the keyed dialogs; audio preview autoplay after the signed-URL fetch; the ElevenLabs preview_url samples (public access to them is unverified, research §14); the 3-second refresh while generating.
- Not tested against live Supabase: the PostgREST `or()` filter with a double-quoted timestamp value; the timestamptz equality guards (for example .eq('generation_started_at', lockedAt) using the value PostgREST returned); storage upload() of a Uint8Array from Node. The one-paid-call guarantee relies on PostgreSQL re-checking the UPDATE's WHERE after a row-lock wait (READ COMMITTED), which I only checked with the fake client.
- Not tested against live ElevenLabs: synthesis timing against maxDuration 60 (synthesis is capped at 45 s with no retries). A 429 from ElevenLabs fails immediately and the admin has to click again.
- Other agents' rules I rely on: editing the spoken wording or language of an on-air AI announcement discards its audio and takes it off air (statusAfterWordingEdit), and uploading an MP3 to an on-air announcement sets it to 'ready', off air until approved (upload-complete route). The UI warns and offers Duplicate or a confirmation, but neither is blocked.
- Approving checks the updatedAt the admin saw and approves exactly that audio_path. An approval that races with a branding change is still caught: the page treats approval under an older branding version as needing review, even though needs_review may read false.

## admin-businesses

### Public API

ROUTES (all export dynamic="force-dynamic", call requireAdminPage, render only PageHeader + sections inside the admin shell):
- /admin/businesses?q=<text>&deleted=1 — table of all businesses (logo, name, station name, Active/Inactive badge, contact email, staff count, accessible-genre count = enabled genres (available_to_all OR assigned), announcements: N active + badges "need review"/"awaiting approval"/"failed"); GET search form (next/form) filtering name/station/contact email case- and accent-insensitively; "Add business" button; honest empty / no-match / load-error states; `deleted=1` shows a success notice.
- /admin/businesses/new — create form → createBusiness → redirect `/admin/businesses/{id}?created=1`.
- /admin/businesses/[businessId]?created=1 — notFound() for a non-uuid or missing id; generateMetadata title = business name. Sections: Details, Genre access, Staff accounts (main column); Activation, Logo, Announcements summary (links to /admin/businesses/[id]/announcements, shows counts + every-N/volume read-only) (side column); Danger zone.

SERVER ACTIONS
src/app/admin/businesses/actions.ts ('use server'):
- createBusiness(prev: BusinessFormState, formData): Promise<BusinessFormState>  (type BusinessFormState = ActionState<BusinessFormValues>) — businessCreateSchema; blank stationName ⇒ "<name> Radio"; inserts with user client; revalidates /admin/businesses, /admin; redirects to detail.
src/app/admin/businesses/[businessId]/actions.ts ('use server'); every action calls requireAdminAction() first, returns ActionState with nonce, revalidates /admin/businesses/{id}, /admin/businesses, /admin:
- updateBusinessDetails(prev: BusinessDetailsState, formData{businessId,name,stationName,namePronunciation,stationNamePronunciation,contactEmail,announcementLanguage}) — businessUpdateSchema, only these 6 columns; reports branding change + count of announcements marked for review (also revalidates …/announcements).
- setBusinessActive(businessId: string, isActive: boolean): Promise<ActionState>
- removeBusinessLogo(businessId: string): Promise<ActionState> — clears logo_path guarded by the current value, then deletes logos/{path} with the secret-key client (honest message if the file can't be removed).
- updateGenreAccess(prev: GenreAccessState, formData{businessId, genreIds[]}) — recomputes the full set server-side (only enabled exclusive genres editable; rows for disabled / available-to-all genres preserved) and calls rpc('set_business_genre_access').
- inviteMember(prev: MemberAccessState, formData{businessId,email,delivery:'email'|'link' from the pressed button}) — inviteUserSchema, rate limit invite:{adminId} 30/600s (fail open), secret-key Auth admin.
- sendMemberAccess(businessId, userId, delivery:'email'|'link'): Promise<MemberAccessState> — server decides invite (not yet accepted) vs password reset (accepted); verifies membership in this business.
- removeMember(businessId, userId): Promise<ActionState> — deletes the membership only.
- deleteBusiness(businessId, confirmation: string): Promise<ActionState> — exact-name confirmation; requires secret key; deactivates → removes logos/{id}/… and announcements/{id}/…/… (listed + DB-known paths, never outside the prefix) → deletes the row → redirect /admin/businesses?deleted=1.
- Types: BusinessDetailsState, GenreAccessState = ActionState<{genreIds}>, MemberAccessState = ActionState<{email}> & { link: AccessLink | null }.

DATA MODULE src/lib/data/admin/businesses.ts (server-only):
- loadAdminBusinessList(supabase, query): Promise<AdminBusinessList{items: AdminBusinessListItem[], total, query}>
- loadAdminBusinessDetail(supabase, businessId, {auth: AuthAdminPort|null, authUnavailableReason?, now?}): Promise<AdminBusinessDetail|null>
- loadKnownBusinessStoragePaths(supabase, businessId)
- Ports/adapters: createAuthAdminPort(adminClient): AuthAdminPort {getUser, inviteByEmail, generateLink, sendPasswordReset}; createMemberDirectory(userClient): MemberDirectoryPort
- Flows: inviteMemberToBusiness(deps, {businessId,email,delivery}), sendAccessToMember(deps, {businessId,userId,delivery}) → MemberAccessResult
- Pure helpers: normalizeSearchQuery, matchesBusinessSearch, summarizeAnnouncements, buildGenreAccessOptions, countAccessibleGenres, computeGenreAccessUpdate, toAdminBusinessRecord, toBusinessInsert, toBusinessDetailsUpdate, deleteConfirmationMatches, toAuthUserSnapshot, deriveMemberStatus, buildAuthConfirmLink(siteUrl, hashedToken, 'invite'|'recovery') → `${site}/auth/confirm?token_hash=…&type=…&next=/set-password`, isEmailExistsError, describeAuthAdminError, listObjectsUnder, removeObjects, collectBusinessStoragePaths, removeBusinessStorage
- Schemas: genreAccessUpdateSchema, businessActivationSchema, memberRefSchema, memberAccessSchema, deleteBusinessSchema.

SHARED CLIENT-SAFE (src/components/admin/businesses): business-form.ts (BUSINESS_TEXT_FIELDS, BusinessFormValues, suggestStationName, stationNameOrSuggestion, readBusinessFormValues, brandingDiffers, COMMON_ANNOUNCEMENT_LANGUAGES, languageLabel…), <LanguageField/>, <BusinessFields mode="create"|"edit"/>.

### Cross-module requests

- src/lib/validation/businesses.ts (foundation owner): consider moving genreAccessUpdateSchema {businessId, genreIds: idArray}, businessActivationSchema {businessId, isActive: boolean}, memberRefSchema/memberAccessSchema {businessId, userId, delivery} and deleteBusinessSchema {businessId, confirmation} there; they currently live in src/lib/data/admin/businesses.ts because I may not edit the validation files.
- src/app/admin/page.tsx (overview owner): the 'Add business' quick action points to /admin/businesses; it can now point straight to /admin/businesses/new.
- docs/ARCHITECTURE.md §6/§7 (lead): record src/lib/data/admin/businesses.ts (loaders, AuthAdminPort/MemberDirectoryPort adapters, invite/access flows, storage cleanup) and src/components/admin/businesses/* (business-form.ts, LanguageField, BusinessFields). Also record that business deletion is deactivate → remove Storage objects under {businessId}/ in logos and announcements → delete row.
- docs/SETUP.md owner: admin-triggered password reset emails are sent with the secret-key client (implicit flow), so the Supabase 'Reset password' template must use the token_hash form ({{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password), like the invite template; invites and resets pass redirectTo = NEXT_PUBLIC_SITE_URL.
- admin-announcements owner: the business detail page links to /admin/businesses/[businessId]/announcements and shows a read-only summary. updateBusinessDetails revalidates that path when branding changes.

### Open issues

- No live Supabase run: inviteUserByEmail / generateLink / getUserById / resetPasswordForEmail with the secret-key client, Storage list() folder semantics and createSignedUrls, and the case-insensitive profile lookup fallback (ilike) were verified only against fakes and the documented contracts.
- No browser run (next dev/build not allowed): dialogs, clipboard copy, logo upload progress/cancel, and form reset behaviour after actions are covered by server-render smoke tests and typed/linted code only, not by real interaction.
- Delete order is deactivate → remove files → delete row. If the row delete fails after the files are gone, the business stays inactive without files; the message says so and retrying completes it.
- Member status cannot tell whether an account has set a password (Supabase exposes no flag): 'Active' means the email is confirmed and access is re-granted with password resets; 'Invitation pending' means it was invited but not accepted.
- Removing a member does not revoke their current session: their next request finds no venue (403 no_business / venue screen).
- Link-expiry wording assumes Supabase's default Email OTP expiration (1 hour).
- A running venue player keeps the old logo until its next page load (the signed logo URL comes from the venue layout bootstrap).
- The business list is filtered in memory after loading every business, with announcement statuses embedded; fine for hundreds of venues, not for tens of thousands.

## admin-catalog

### Public API

PAGES (both export dynamic = "force-dynamic", call requireAdminPage(path), render only PageHeader + sections inside the admin shell; each has a loading.tsx skeleton):
- /admin/genres: the genres in sort_order. Each row shows the name, slug, description, an Enabled/Disabled badge, availability ("All businesses", or "Assigned only · N businesses" with their names), and playable/total counts from rpc genre_track_counts, with a "View tracks" link to /admin/music?genre=<id>&status=all. Controls: "New genre" dialog (automatic slug with manual override; when "Assigned only", a business multi-select). Edit dialog (name, slug, description). Move up/Move down buttons: optimistic via useOptimistic, focus kept on the moved genre, position announced in a live region. Enabled and "Available to all" switches (optimistic, with an Undo toast). "Manage access" dialog (only for Assigned only). Delete via ConfirmDialog.
- /admin/music?q=&genre=<uuid|none>&status=current|active|disabled|removed|all&sort=newest|oldest|title|artist&page=N. Upload card: FileDropzone for several MP3s, genre checkboxes applied to each batch, useUploadQueue with per-file phase and progress bar, Cancel/Retry/Remove/Dismiss, server errors shown as returned, router.refresh (debounced 800 ms) after uploads. Filters: search, genre select (including "No genre"), sort select. Status links with counts. Table (50 rows per page through range()): title and file name, artist, length, genre badges, status, size and bitrate, upload date. Row actions: Preview (a single player docked at the bottom, so only one preview plays), Edit details, and a More menu (Replace audio file, Disable/Enable, Remove from playback with ConfirmDialog, Restore, Delete permanently for removed tracks only, with ConfirmDialog). Pagination.

SERVER ACTIONS (all 'use server'; each calls requireAdminAction() first, validates with zod, returns ActionState, calls revalidatePath on "/admin/genres", "/admin/music" and "/admin"):
- src/app/admin/genres/actions.ts:
  createGenreAction(formData: FormData). Fields: name, slug (blank means derived), description, isEnabled, availableToAll ("true"/"false"), and repeated businessIds (used only when availableToAll is false). If the genre is created but its access rows fail, the result has ok:false and values.createdGenreId.
  updateGenreAction(genreId: string, formData: FormData). Omitted fields stay unchanged; a blank slug keeps the current one.
  deleteGenreAction(genreId: string)
  setGenreEnabledAction(genreId: string, enabled: boolean)
  setGenreAvailabilityAction(genreId: string, availableToAll: boolean)
  reorderGenresAction(genreIds: string[]). Takes the full order and calls rpc reorder_genres.
  setGenreAccessAction(genreId: string, businessIds: string[]). Computes a diff, upserts new rows with ignoreDuplicates, and deletes removed rows in chunks.
  A 23505 error becomes fieldErrors.name or fieldErrors.slug (constraints genres_name_lower_key and genres_slug_key). Other errors go through describeDbError.
- src/app/admin/music/actions.ts:
  updateTrackAction(trackId: string, formData: FormData). Fields: title, artist (blank means "Unknown Artist"), repeated genreIds. Updates the row, then calls rpc set_track_genres. A partial failure is reported as such.
  setTrackActiveAction(trackId: string, active: boolean)
  removeTrackAction(trackId: string). Sets removed_at to now, only where removed_at is null.
  restoreTrackAction(trackId: string)
  deleteTrackAction(trackId: string). Only for removed tracks. First removes the Storage objects with the admin client (storage_path plus any other files in tracks/{id}/), then deletes the row (guarded by removed_at not null). Retrying is safe.

DATA (server-only) src/lib/data/admin/catalog.ts. All functions use the admin's own client; reads past PostgREST's 1000-row limit are paged.
- loadGenreCatalog(supabase: TypedSupabaseClient): Promise<GenreCatalog>
- loadGenreOptions(supabase): Promise<GenreOption[]>
- loadGenreAccessBusinessIds(supabase, genreId): Promise<string[]>
- nextGenreSortOrder(supabase): Promise<number>
- loadTrackPage(supabase, query: TrackListQuery): Promise<TrackPage>. The select is "*, track_genres(genre_id)". Search uses or(title/artist ilike). A genre filter uses track_genres.genre_id=eq plus track_genres=not.is.null, then a second query reads each track's full genre list. "none" uses track_genres=is.null. Three HEAD count queries give per-status counts. PGRST103 (range past the end) returns an empty page.
- removeTrackObjects(admin, trackId, storagePath): Promise<{ok:true;removed:number}|{ok:false;cause}>
- class CatalogLoadError

CLIENT-SAFE HELPERS AND TYPES (src/components/admin/catalog):
- types.ts: AdminGenreItem, BusinessOption, GenreOption, GenreCatalog, TrackStatusCounts, TrackPage.
- genre-helpers.ts: normalizeSlugInput, effectiveSlug, slugProblem, moveInOrder(ids, id, "up"|"down"), applyOrder, diffGenreAccess(current, desired) returning {toAdd, toRemove}, chunk, describeAvailability, describeTrackCounts, genreConflictField.
- track-query.ts: TRACK_PAGE_SIZE=50, TrackListQuery, DEFAULT_TRACK_QUERY, NO_GENRE, parseTrackListQuery(searchParams), trackListSearchParams, trackListHref(query, patch) (a changed filter resets to page 1), hasActiveFilters, normalizeSearch, toIlikePattern, trackSearchFilter, pageRange, pageCount, countForStatus, trackState, describePageWindow, formatCount.
- Other agents can link here: /admin/music?genre=<id> and /admin/genres.

### Cross-module requests

- ui-kit owner (src/components/ui/Dialog.tsx): if a component with an open <Dialog> is unmounted, focus is not returned to the element that opened it. The cleanup calls dialog.close(), but the native 'close' event arrives after React has detached onClose, so handleNativeClose never runs. Suggested fix: in the unmount cleanup, also focus returnFocusRef.current when it is still connected. My components work around this by keeping dialogs mounted and toggling `open`. Other agents who mount dialogs conditionally will lose focus return.
- docs/ARCHITECTURE.md owner: in §6 add rows for src/lib/data/admin/catalog.ts (admin genre/track loaders, removeTrackObjects) and src/components/admin/catalog/{genre-helpers,track-query}.ts (pure helpers). In §7, record the /admin/music query params (q, genre=<uuid>|none, status=current|active|disabled|removed|all, sort=newest|oldest|title|artist, page), and that genre business access can be edited both per genre (/admin/genres: row upsert/delete) and per business (set_business_genre_access). Both write the same rows.
- admin-businesses owner (optional): the business detail page can link to /admin/genres for the genre-side view, and to /admin/music?genre=<id> for a genre's tracks. No contract change is needed.

### Open issues

- No real browser has run any of this UI. Not verified at runtime: the placement of the popover-based 'More actions' menu (native popover + JS positioning), useOptimistic reorder reconciliation against the server re-render, restoring focus after keyed reordering, the docked preview player, and upload progress rendering.
- The PostgREST embedded filters are checked only as recorded supabase-js calls, never against live PostgREST: track_genres.genre_id=eq.X together with track_genres=not.is.null for the genre filter, and track_genres=is.null for 'No genre' (both documented PostgREST ≥ v11 features). HEAD count queries with these filters are also unverified live.
- Search replaces , ( ) " \ : . % * with the LIKE single-character wildcard '_'. Matches can be slightly broader (e.g. 'v1.0' also matches 'v1x0'), but a search can never inject another filter.
- Three writes are not atomic. Genre access changes are an upsert followed by a delete; track metadata is a row update followed by rpc set_track_genres; a genre created with initial business access is an insert followed by access rows. On a partial failure the user is told what was saved.
- Permanent track deletion follows the spec: Storage objects first, then the row, so a failed row delete can be retried. If another admin restores the track between the check and the delete, the track is left without audio. The action detects this and tells the admin to use 'Replace file'.
- Each /admin/music load makes 4 requests: the page plus 3 HEAD count queries. A 5th request (full genre lists for the page) is added when filtering by genre.
- Preview autoplay can be blocked on Safari, because the <audio> element is created after the signed URL is fetched. The native controls still let the admin press play.
- Retrying an upload that failed the local checkUploadFile check fails again with the same message; the queue does not tell local failures apart from server ones.

