# Foundation module APIs (build notes)

Generated from the foundation build agents' reports (2026-09-25). Read the source for details; these summaries tell you what exists and how to call it.

## db

### Public API

DATABASE (import type { Database, Tables, TablesInsert, TablesUpdate, Enums } from "@/types/database"): the table and enum shapes are unchanged. I checked them column by column against the SQL (type, nullability, whether a column is optional on insert, enum values, FK constraint names used in Relationships). `Database["public"]["Functions"]` gains these entries:
- consume_rate_limit(p_key text, p_max int, p_window_seconds int) returns boolean. Callable by the service role only. Fixed window; the stored count is capped at max+1. Bad arguments raise 22023.
- reorder_genres(p_genre_ids uuid[]) returns void. Admin only. sort_order becomes the 1-based position in the array; genres not in the array keep their relative order after the listed ones.
- set_business_genre_access(p_business_id uuid, p_genre_ids uuid[]) returns void. Admin only. Replaces the business's access rows with exactly this set; an empty array clears it.
- set_track_genres(p_track_id uuid, p_genre_ids uuid[]) returns void. Admin only. Replaces the track's genres with exactly this set.
- genre_track_counts() returns table(genre_id uuid, playable_count integer, total_count integer). Security invoker, so it counts only the rows RLS lets the caller see. Genres with no tracks are included. Business users get only accessible genres, with playable_count = total_count. An inactive business gets no rows.
All four new RPCs are security invoker with search_path ''. Execute is granted to authenticated and service_role, never to anon. The admin-only ones raise 42501 'Only platform admins can perform this action'. Other errors: 23503 for an unknown id, 22023 for duplicates, 22004 for nulls. Typed usage: supabase.rpc("set_track_genres", { p_track_id, p_genre_ids }). It compiles with SupabaseClient<Database>, and the @ts-expect-error cases for wrong arguments also held.
PRIVATE SCHEMA (not exposed through the Data API): is_platform_admin, member_business_id, active_member_business_id, genre_accessible(uuid, uuid), track_accessible(uuid), track_object_accessible(text), announcement_object_accessible(text), logo_object_accessible(text), exactly as in §5.4. Two internal helpers: assert_platform_admin() and assert_uuid_set(uuid[], text). All trigger functions also live in private.
STORAGE: buckets music (50 MB), announcements (10 MB) and logos (2 MB), all private. Policies: "media: admin select|insert|update|delete", "music: member read accessible tracks", "announcements: member read own playable", "logos: member read own logo".
TEST HARNESS (tests/db):
- setupTestDb<F>(seed?: (t: TestDb) => Promise<F>): TestDbHandle<F>. Gives one PGlite instance per file, restored from the snapshot and optionally seeded (committed) once, then BEGIN/ROLLBACK around each test. Usage: `const t = setupTestDb(seedScenario); t().asUser(id, db => ...); t.fixtures()`.
- TestDb provides asUser, asStorageUser, asAnon, asService, createUser, begin, rollback, snapshot, close, and db (the superuser connection).
- fixtures.ts provides insertRow<T>(db, table, TablesInsert<T>), putObject, selectIds, sorted, createAdmin, createMember, insertTrack, insertAnnouncement, and seedScenario, which builds business A (active, branding version 2), B (active), C (inactive), 6 users, 5 genres, 8 tracks, 8 announcements, plus storage objects and logos.
VITEST: vitest.config.ts now defines two projects. 'unit' covers tests/**/*.test.ts except tests/db. 'db' covers tests/db/**/*.test.ts, uses globalSetup tests/db/global-setup.ts, maxWorkers 3 and sequence.groupOrder 1. The global setup runs only when a db file is selected. Both projects inherit the '@' and 'server-only' aliases from the root config.

### Notes for other modules

- Admin server actions (genres/music/businesses owner): use the new RPCs for multi-row writes instead of separate delete+insert calls: reorder_genres(p_genre_ids), set_business_genre_access(p_business_id, p_genre_ids), set_track_genres(p_track_id, p_genre_ids). Map error.code: 42501 -> forbidden, 23503 -> not_found/invalid_request, 22023/22004 -> invalid_request. Use genre_track_counts() for trackCount in PlayerGenre and for the admin genre list (it respects RLS, so the user's own client returns the right numbers for each role).
- Admin actions (announcement approve owner): to re-approve after a branding change, set status='active', needs_review=false, review_reason=null, approved_at=now(), approved_by=<admin>, and branding_version = the business's current branding_version. branding_version on businesses is managed by a trigger: an UPDATE to it is silently ignored.
- Admin delete actions (business/track/announcement owners): deleting DB rows does NOT delete Storage objects, and SQL deletes on storage.objects are blocked. Remove files with supabase.storage.from(bucket).remove([...]) via the admin/secret client.
- docs/SETUP.md owner: apply supabase/migrations/20260925000100_core_schema.sql, then 000200_access_control.sql, then 000300_storage.sql in the SQL editor, in that order (each file is wrapped in begin/commit; 000300 is safe to re-run). Promote the first admin in the SQL editor with: update public.profiles set role = 'platform_admin' where email = '<email>'; (the guard trigger allows the postgres role and the service role).
- scripts/seed-dev.ts and scripts/create-admin.ts owners: the service role (secret key) may call the admin RPCs and change profiles.role; authenticated users (admins included) cannot change roles through the Data API.
- Whoever owns docs/ARCHITECTURE.md §12/§13 and docs/TESTING.md: DB tests run with `npx vitest run tests/db` (or `--project db`). They live in a separate Vitest project whose global setup builds the migrated PGlite snapshot only when a tests/db file is selected. I only edited §5.

### Known open issues

- Deliberate choices beyond the brief, all documented in ARCHITECTURE §5: (a) the admin RPCs also accept the service role (current_user = 'service_role') so seed and maintenance scripts can use them; (b) RLS is enabled in 000100 as each table is created (deny by default), and 000200 adds grants and policies; (c) review_reason uses the exact spec wording only when station_name changed, otherwise 'Branding changed: venue name or pronunciation updated'; (d) an UPDATE cannot set branding_version, only the trigger changes it (INSERT can still set it); (e) the signup trigger stores a null auth email as '' so phone or email-less signups are never blocked.
- Not verified on hosted Supabase, only reasoned or taken from the research notes: (1) that the postgres role has BYPASSRLS, so the security-definer helpers skip RLS; PGlite's superuser always bypasses it. (2) That the storage policy statements run inside a DO block as the SQL-editor postgres role; they rely on the same create-policy permission as plain `create policy`, and nothing is dropped. (3) Creating triggers on auth.users from the SQL editor (the documented pattern). (4) Whether each file's begin/commit wrapper interacts with the Supabase CLI's own transaction handling; this is expected to be harmless.
- PG15 compatibility is by review only; the tests run on PostgreSQL 18.3. No PG16+ features are used.
- Per spec §5.5, a business user can read their own business_genre_access rows even for disabled genres (ids only; the genre rows themselves stay hidden).
- Vite prints a warning that vitest.config.ts uses ESM syntax in a file loaded as CommonJS. This existed before my change and is harmless; renaming the file to .mts would silence it.

## platform-core

### Public API

ENV — "@/lib/env" (safe in the browser; server-only functions throw if called there):
- class EnvError extends Error { variable: string }
- getSupabasePublicConfig(): { url: string; publishableKey: string } (throws EnvError naming NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY)
- isSupabaseConfigured(): boolean (never throws)
- getSiteUrl(): string (origin with no trailing slash; http://localhost:3000 outside production; THROWS in production when NEXT_PUBLIC_SITE_URL is unset)
- getPublicEnv(): { supabaseUrl; supabasePublishableKey; siteUrl; platformName }
- getServerEnv(): { supabaseSecretKey: string|null; elevenLabsApiKey: string|null; elevenLabsDefaultModelId: string|null; mediaUrlTtlSeconds: number /*900–43200, default 7200*/; uploadTokenSecret: string|null } (throws EnvError if MEDIA_URL_TTL_SECONDS is not an integer, or if UPLOAD_TOKEN_SECRET is under 32 chars)
- getSupabaseSecretKey(): string (throws EnvError; falls back to SUPABASE_SERVICE_ROLE_KEY)
- isTtsConfigured(): boolean
- constants MEDIA_URL_TTL_DEFAULT_SECONDS, MEDIA_URL_TTL_MIN_SECONDS, MEDIA_URL_TTL_MAX_SECONDS

SUPABASE:
- "@/lib/supabase/types": type TypedSupabaseClient = SupabaseClient<Database>; type StorageBucket = "music"|"announcements"|"logos"
- "@/lib/supabase/server": createSupabaseServerClient(): Promise<TypedSupabaseClient> (server-only, cookie-bound, one per request)
- "@/lib/supabase/browser": createSupabaseBrowserClient(): TypedSupabaseClient (singleton)
- "@/lib/supabase/admin": createSupabaseAdminClient(): TypedSupabaseClient (server-only, secret key, bypasses RLS; callers in Server Components must `await connection()` first)
- "@/lib/supabase/proxy": updateSession(request: NextRequest): Promise<{ response: NextResponse; authenticated: boolean|null }>; redirectPreservingSession(source: NextResponse, url: URL, method: string): NextResponse (307 for GET/HEAD, 303 otherwise)

PROXY: src/proxy.ts exports `proxy` and `config.matcher`. Pure rules live in "@/lib/auth/proxy-rules": decideProxyAction({ pathname, search?, configured, authenticated: boolean|null }): {type:"next"} | {type:"redirect"; pathname; searchParams?} | {type:"setup-required-json"}; isStaticAssetPath(p); matchesPrefix(p, prefix); PROTECTED_PREFIXES, GUEST_ONLY_PREFIXES, SETUP_PATH, LOGIN_PATH, HOME_PATH.

AUTH:
- "@/lib/auth/redirects": safeNextPath(next: unknown, fallback = "/"): string (accepts string | string[] | undefined)
- "@/lib/auth/access" (pure): interfaces SessionBusiness {id,name,stationName,isActive} and SessionContext {userId,email,role: AppRole,business: SessionBusiness|null}; AdminSessionContext; VenueSessionContext (a business_user whose business may be null or inactive); BusinessUserSessionContext (active business guaranteed); checkAdminAccess(ctx|null), checkBusinessUserAccess(ctx|null) returning {ok:true,ctx}|{ok:false,denial:{status,code,message}}; isAdminContext, isVenueContext; ACCESS_DENIALS
- "@/lib/auth/session" (server-only; re-exports the types above):
  - getSessionContext(): Promise<SessionContext|null> (React cache)
  - loadSessionContext(supabase): Promise<SessionContext|null> (throws SessionLookupError with reason "auth_unreachable"|"profile_missing"|"query_failed")
  - requireAdminPage(nextPath="/admin"): Promise<AdminSessionContext>
  - requireBusinessUserPage(nextPath="/radio"): Promise<VenueSessionContext> (sends admins to /admin; returns ctx even when business is null or inactive)
  - requireAdminAction(): Promise<{ ctx: AdminSessionContext; supabase: TypedSupabaseClient }> (redirects to /login or /)
  - requireAdminApi(): Promise<ApiAccess<AdminSessionContext>>; requireBusinessUserApi(): Promise<ApiAccess<BusinessUserSessionContext>>
  - type ApiAccess<C> = { ok: true; ctx: C; supabase: TypedSupabaseClient } | { ok: false; response: Response }. Error responses: 401 unauthenticated, 403 forbidden / no_business / business_inactive, 503 unavailable (env missing or auth service unreachable), 500 server_error.

HTTP — "@/lib/api/http":
- jsonOk<T>(data: T, init?: ResponseInit): Response
- jsonError(status: number, code: ApiErrorCode, message: string, fields?: Record<string,string>): Response
- jsonServerError(context: string, cause: unknown): Response (logs the cause, returns a generic 500)
- readJson<S extends z.ZodType>(request, schema, { maxBytes = 65536 }?): Promise<{ok:true; data: z.output<S>} | {ok:false; response}>. REQUIRES Content-Type: application/json (otherwise 415 invalid_request); 413 payload_too_large; 400 invalid_request with `fields`.
- Every response carries Cache-Control: private, no-store. Constants: API_CACHE_CONTROL, DEFAULT_MAX_JSON_BYTES.

RATE LIMIT — "@/lib/rate-limit" (server-only):
- consumeRateLimit({ key, max, windowSeconds, failClosed }): Promise<{allowed:true; degraded:boolean} | {allowed:false; reason:"limited"|"unavailable"}>
- rateLimitErrorResponse(result, retryAfterSeconds?): Response (429 rate_limited or 503 unavailable)

VALIDATION — "@/lib/validation" barrel, or the individual files. Client code should import the individual files.
- limits.ts: MAX_TRACK_BYTES (52428800), MAX_ANNOUNCEMENT_BYTES (10485760), MAX_LOGO_BYTES (2097152), MAX_FILE_NAME_LENGTH, AUDIO_MIME_TYPES, ACCEPTED_AUDIO_MIME_TYPES, AUDIO_EXTENSIONS, IMAGE_MIME_TYPES, IMAGE_EXTENSIONS, AUDIO_ACCEPT, IMAGE_ACCEPT, type UploadBucket, UPLOAD_RULES: Record<UploadKind,{bucket,maxBytes,label,media}>, IMAGE_EXTENSION_BY_TYPE, getFileExtension(name), formatBytes(n), checkUploadFile(kind, {name,size,type}): {ok:true; contentType; extension /* "mp3"|"png"|"jpg"|"webp" */} | {ok:false; code:"invalid_request"|"payload_too_large"|"unsupported_media"; message}
- forms.ts: formDataToObject(formData, { arrays?: string[] }) (a repeated key keeps its LAST value; keys listed in `arrays` become arrays; $ACTION_* fields are dropped); toFieldErrors(zodError): Record<string,string> (via z.flattenError); summarizeValidationError(zodError): string; type FieldErrors
- fields.ts: idSchema (z.guid), LANGUAGE_CODE_PATTERN, languageCodeSchema, requiredText(label,max), nullableText(label,max), emailSchema, nullableEmailSchema, formBoolean, formInteger(label,min,max), formNumber(label,min,max,decimals), idArray(label,max)
- media.ts: signMediaRequestSchema, adminPreviewRequestSchema; player.ts: updatePreferencesRequestSchema (needs at least one field); uploads.ts: signUploadRequestSchema (checks shape only; call checkUploadFile for the 413/415 rules), completeUploadRequestSchema, trackUploadMetadataSchema; tts.ts: generateAnnouncementRequestSchema, PROVIDER_ID_PATTERN (voice and model ids limited to [A-Za-z0-9_-]{1,100})
- businesses.ts: businessCreateSchema (defaults: language "en", isActive false, everyN 4, volume 1, nullable text null), businessUpdateSchema (every field optional; omitted means unchanged; blank text becomes null)
- genres.ts: slugify(s), SLUG_PATTERN, MAX_SLUG_LENGTH, genreCreateSchema (blank slug is derived from the name, with an error on `slug` if nothing usable remains), genreUpdateSchema (blank slug keeps the current one), genreReorderSchema {genreIds}
- tracks.ts: trackMetadataUpdateSchema {title, artist (blank becomes "Unknown Artist"), genreIds (default [])}, UNKNOWN_ARTIST
- announcements.ts: announcementCreateSchema {templateKey|null, placement default "rotation", text, spokenText|null, language? (omitted means use the business language)}, announcementUpdateSchema (partial), ANNOUNCEMENT_PLACEMENTS, TEMPLATE_KEY_PATTERN
- invites.ts: inviteUserSchema {email (lowercased), businessId, delivery "email"|"link" default "email"}, INVITE_DELIVERY_METHODS
- Inferred types: SignMediaRequestInput, AdminPreviewRequestInput, UpdatePreferencesRequestInput, SignUploadRequestInput, CompleteUploadRequestInput, GenerateAnnouncementRequestInput, BusinessCreateInput, BusinessUpdateInput, GenreCreateInput, GenreUpdateInput, GenreReorderInput, TrackMetadataUpdateInput, AnnouncementCreateInput, AnnouncementUpdateInput, InviteUserInput
- BOOLEAN CONVENTION: an absent boolean means default (create) or unchanged (update), NOT false. HTML forms must always submit a value, e.g. `<input type="hidden" name="isActive" value="false"><input type="checkbox" name="isActive" value="true">`.

UPLOADS:
- "@/lib/uploads/token" (server-only): createUploadToken({kind,bucket,path,targetId,userId}, {now?}?): string; verifyUploadToken(token, {now?, expectedKind?: UploadKind|UploadKind[], expectedUserId?}?): {ok:true; payload: UploadTokenPayload} | {ok:false; reason:"malformed"|"bad_signature"|"invalid_payload"|"expired"|"kind_mismatch"|"user_mismatch"}; describeUploadTokenFailure(reason): string; UPLOAD_TOKEN_TTL_SECONDS (900); types UploadTokenPayload, UploadTokenClaims. targetId must be null for "track" and set for every other kind; bucket must match the kind.
- "@/lib/uploads/client" (browser): class UploadError { code: ApiErrorCode|"aborted"|"network"; status: number|null }; isUploadAbort(e); uploadWithProgress({ signedUrl, file, contentType, cacheControl?="3600", apiKey?, onProgress?(fraction), signal? }): Promise<void>; mapStorageUploadFailure(status, text): UploadError; type UploadTarget = {kind:"track"}|{kind:"track-replace";trackId}|{kind:"announcement";announcementId}|{kind:"logo";businessId}; buildSignUploadRequest(target, file): SignUploadRequest; uploadFile({ request, file, metadata?, onProgress?, onPhase?(phase: "signing"|"uploading"|"validating"), signal? }): Promise<CompleteUploadResponse> (the signal cancels signing and the transfer only; validation always runs to completion)
- "@/lib/uploads/queue": class UploadQueue({concurrency?=2, upload?}) with subscribe/getSnapshot/add/cancel/remove/retry/clearFinished/abortAll/setOnUploaded; types UploadQueueItem {id,name,size,kind,phase,progress,error,result}, UploadItemPhase, UploadQueueEntry {file, target: UploadTarget, metadata?}; isActivePhase, isCancellable
- "@/lib/uploads/use-upload-queue" ('use client'): useUploadQueue({ concurrency?, onUploaded?(item) }?): { items, busy, add(entries), cancel(id), remove(id), retry(id), clearFinished() }. Cancel and remove are refused while an item is validating.

MEDIA — "@/lib/media/signing" (server-only): computeSignedUrlTtl(durationSeconds|null|undefined, configuredTtl): number; mediaTtlFor(duration): number; signStorageObject(client, bucket, path, ttlSeconds): Promise<{url; expiresAt}>; signAudioObject(client, "music"|"announcements", path, durationSeconds|null); signLogoObject(client, path); class MediaSigningError { bucket; path; notFound: boolean }; types StorageSigningClient, CreateSignedUrlResult, SignedStorageUrl.

### Notes for other modules

- docs/ARCHITECTURE.md (not owned). Please record these facts, which differ from or add to the current text: (a) §6 module table should list src/lib/auth/access.ts (pure rules and the SessionContext types), src/lib/auth/proxy-rules.ts, src/lib/auth/redirects.ts (safeNextPath), src/lib/supabase/types.ts (TypedSupabaseClient), src/lib/uploads/queue.ts and src/lib/uploads/use-upload-queue.ts, the validation files (limits, forms, fields, media, player, uploads, tts, businesses, genres, tracks, announcements, invites, plus the index barrel), and requireAdminAction() in session.ts. (b) The exported `SessionContext` type is the non-null object; getSessionContext() returns `SessionContext | null`. (c) In setup mode the proxy answers /api/* with 503 JSON (code `unavailable`) instead of redirecting, and exempts /dev/* and /api/dev/* so the dev player lab works without Supabase. (d) NEXT_PUBLIC_SITE_URL is required in production: getSiteUrl() and getPublicEnv() throw without it.
- Every browser caller of our JSON route handlers (the PlayerApi implementation for /api/player/*, /api/media/sign, /api/admin/media/preview and TTS generate) MUST send `Content-Type: application/json`. Otherwise readJson() rejects the request with 415 invalid_request. uploadFile() already does this.
- Owner of /api/admin/uploads/sign: (1) validate with signUploadRequestSchema, then checkUploadFile(kind, {name: fileName, size: fileSize, type: contentType}) and return 413 payload_too_large or 415 unsupported_media with its message; (2) build the object path from check.extension; (3) mint the token with createUploadToken({kind, bucket: UPLOAD_RULES[kind].bucket, path, targetId /* null only for kind 'track' */, userId: ctx.userId}); (4) rate-limit with consumeRateLimit({key:`upload-sign:${userId}`, max:120, windowSeconds:600, failClosed:false}). Owner of /api/admin/uploads/complete: call verifyUploadToken(body.uploadToken, { expectedUserId: ctx.userId }) and on failure return 400 invalid_request (403 forbidden for user_mismatch) with describeUploadTokenFailure(reason).
- Admin form/action authors: boolean fields (isActive, isEnabled, availableToAll) treat an absent value as default/unchanged, not false. Forms must always submit a value, for example a hidden `false` input placed before a checkbox with value `true` (formDataToObject keeps the last value), or a Switch that posts 'true'/'false'. Multi-selects (genreIds) need formDataToObject(fd, { arrays: ['genreIds'] }).
- Media-signing route owners: map MediaSigningError.notFound === true to 404 (unavailable or not_found) and any other MediaSigningError to 500. Business-user signing must pass the user's own client from requireBusinessUserApi(); use signAudioObject(...) so the TTL covers the item's duration.

### Known open issues

- The XHR upload replica has not been run against a live Supabase project or in a real browser. It matches the request shape in the research notes (PUT, FormData cacheControl/contentType/"", apikey header), but whether the hosted gateway needs or tolerates the apikey header, and the CORS behaviour on the signed-upload route, are still unverified.
- The session helpers, updateSession and the rate-limit RPC were verified only against mocked Supabase clients. Behaviour with real JWT/JWKS, RLS on profiles/business_members and consume_rate_limit needs an integration run.
- useUploadQueue itself has not been rendered in a test because jsdom and testing-library are not installed. Its logic sits in UploadQueue, which is fully unit-tested; the hook has been lint-checked (React Compiler rules pass) and typechecked only.
- typedRoutes is deliberately not enabled in next.config.ts. Turning it on would make every dynamic redirect()/Link string in other agents' code a type error mid-build. Revisit after integration if wanted.
- Security headers do not include a script CSP. That would need per-request nonces set in the proxy; only frame-ancestors, base-uri and object-src are set. HSTS (max-age=31536000, no includeSubDomains) is emitted only when next.config is evaluated with NODE_ENV=production.
- A signed-in user whose profile row is missing (e.g. deleted moments ago while the JWT is still valid) makes page guards throw SessionLookupError, which shows the error boundary, instead of redirecting. This avoids a /login ↔ / redirect loop. API guards answer 401 in that case.
- After a user cancels during the 'validating' phase, or when a component using useUploadQueue unmounts mid-transfer, nothing server-side cleans up objects that were uploaded but never completed. Aborted transfers leave no object, but a failed or skipped /complete call can orphan one. Consider a periodic cleanup.
- At the time of the last check, tsc reported errors only in other agents' in-progress files (src/components/ui/Slider.tsx; earlier src/app/dev/layout.tsx). None were in platform files.

## player-core

### Public API

ENGINE — import { PlayerEngine, createPlayerEngine, DEFAULT_ENGINE_TUNING, WELCOME_ANNOUNCEMENT_LABEL, STATION_ANNOUNCEMENT_LABEL, SINGLE_TRACK_NOTICE } from "@/lib/player/engine"
  new PlayerEngine(deps: EngineDeps, config: EngineConfig, tuning?: Partial<EngineTuning>)   // implements PlayerEngineApi
  createPlayerEngine(deps, config, tuning?): PlayerEngine
  DEFAULT_ENGINE_TUNING: Readonly<Required<EngineTuning>>
  - All public members are stable arrow properties: getSnapshot, subscribe, start, pause, resume, togglePlay, skip, selectGenre(genreId), setVolume(0..1), setMuted(bool), retry, destroy. They are safe to pass straight to useSyncExternalStore and to onClick handlers.
  - Constructing the engine has no network side effects. It creates the 3 pooled elements (deps.createMediaElement is called 3 times), registers the Media Session handlers and starts an async volume-writability probe. Audio only starts from start()/resume()/togglePlay(), which must be called directly from a click, keydown or Media Session handler.
  - The engine itself saves preferences (genreId, volume, muted) through api.savePreferences, debounced by 1 s and best-effort, and flushes them on destroy(). Callers must NOT also PUT preferences.
  - destroy() is idempotent. It unloads every element, removes all listeners, clears the Media Session and removes the welcome key.

BROWSER DEPS — import { createBrowserEngineDeps, clearPlayerSessionState, type BrowserEngineDepsOptions } from "@/lib/player/browser"
  createBrowserEngineDeps(options?: { api?: PlayerApi; log?: EngineDeps["log"] }): EngineDeps   // throws if called outside the browser; call it in an effect
  clearPlayerSessionState(): void   // removes every sessionStorage key that starts with "radio-player:"; call on logout after engine.destroy()

API CLIENT — import { createPlayerApi, DEFAULT_PLAYER_API_TIMEOUT_MS, parseGenreTracks, parseAnnouncements, parseSignedMedia, parsePreferencesResponse, type PlayerApiClientOptions } from "@/lib/player/api-client"
  createPlayerApi(options?: { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number /* default 15000 */ }): PlayerApi
  - Error mapping: 401 → "auth" (retried once first, because of the Supabase refresh-token race); 403 → "forbidden" (keeps body error.code); 404/410 → "unavailable"; 429 → "rate_limited"; 5xx, other statuses or a malformed/invalid body → "server"; TypeError or timeout → "network".
  - If the caller's AbortSignal aborts, the AbortError itself is rethrown.

SHUFFLE — import { ShuffleBag } from "@/lib/player/shuffle"
  new ShuffleBag(random?: () => number, ids?: readonly string[])
  Members: size, isEmpty, isSingleTrack, remainingInCycle, cycleCount, last, has(id), isExcluded(id), setPool(ids), next(): string | null, exclude(id), clearExclusions()

ANNOUNCEMENTS — import { AnnouncementScheduler, welcomeStorageKey, normalizeEveryNTracks, PLAYER_STORAGE_PREFIX /* "radio-player:" */ } from "@/lib/player/announcements"
  new AnnouncementScheduler({ everyNTracks, storage: KeyValueStorage, welcomeKey: string, random? })
  Members: setAnnouncements, setEveryNTracks, everyNTracks, completedTracks, hasRotation, tracksUntilAnnouncement, isDue(), wouldBeDueAfterNextCompletion(), onTrackCompleted(), onAnnouncementPlayed(), nextRotation(), isAvailable(id), markFailed(id), takeWelcome(), markWelcomePlayed(), clearWelcome()

MEDIA HELPERS — "@/lib/player/media": safePlay(el, timers, timeoutMs), classifyPlayError, unloadMedia, reloadAt, classifyMediaError, detectVolumeWritable(el, timers), rampValue(opts), NETWORK_EMPTY, HAVE_FUTURE_DATA, type PlayOutcome.
RUNTIME — "@/lib/player/runtime": systemTimers, createMemoryStorage(), isAbortError(e), clamp01(v).

ADDITIVE CHANGES TO src/lib/player/types.ts (no existing name removed or renamed)
  - New `MediaSessionActionName` union. MediaSessionLike.setActionHandler now accepts it, adding previoustrack/seekbackward/seekforward/seekto so the engine can clear them to null.
  - New optional EngineDeps.onVisibilityChange?: (cb) => unsubscribe, used for a watchdog catch-up check when the tab becomes visible.
  - New optional EngineTuning.preloadDelayMs? (5000) and playTimeoutMs? (15000).
  - Doc only: Timers.now() is wall-clock epoch ms, because it is compared with signed-URL expiresAt.

### Notes for other modules

- PlayerProvider (src/components/player/PlayerProvider.tsx): build the engine in an effect, never during render: `new PlayerEngine(createBrowserEngineDeps({ log }), config)`, with config from PlayerBootstrap. Use `useSyncExternalStore(engine.subscribe, engine.getSnapshot, getServerSnapshot)` with a static idle snapshot for the server. Call engine.destroy() on unmount; Strict Mode double-mount is safe because destroy is idempotent. Call commands directly from onClick/keydown handlers so play() stays inside the gesture. Do NOT persist preferences separately; the engine already PUTs genreId/volume/muted, debounced. Only offer volume control when snapshot.volumeControllable is true. On logout, call engine.destroy(), then clearPlayerSessionState(), then sign out.
- POST /api/media/sign handler: must re-check eligibility on every call. Return 404 or 410 when the track or announcement is no longer playable (the engine excludes it and moves on). Return 403 with error.code 'business_inactive' (or 'no_business') for a venue block; any other 403 code on a sign call is treated as 'this item is no longer accessible'. Always return `expiresAt` (ISO), and `durationSeconds`, `title` and `artist` for tracks.
- GET /api/player/genres/[genreId]/tracks: an inaccessible genre should return 403 (a code other than business_inactive), or 404/410. The engine maps both to errorCode 'genre_unavailable'; 403 business_inactive maps to 'business_inactive'.
- docs/ARCHITECTURE.md §9 (not my file), please record:
- The engine persists playback preferences itself.
- The additive types.ts changes: MediaSessionActionName, EngineDeps.onVisibilityChange, optional EngineTuning.preloadDelayMs / playTimeoutMs, and Timers.now() being epoch ms.
- sessionStorage keys use the prefix 'radio-player:' (welcome key 'radio-player:welcome:{userId}:{businessId}').
- Announcements are never retried: any failure goes straight to music, and the counter stays due.
- The /dev/player-lab owner can pass `Partial<EngineTuning>`, for example short preloadDelayMs or stall timings, as the third constructor argument. The engine's `log` hook emits these events: item.promoted, item.failed, item.reload, watchdog.reload/failed, play.blocked, pause.external, network.retry, api.failed, fatal, preload.*, exclusivity.paused_stray.

### Known open issues

- No real browser or device test yet. The WebKit/iOS behaviour follows docs/research/browser-audio.md, which is based on reading WebKit source and was not tested on a device:
- per-element unlock via load() at Start;
- volume that can't be changed on iPhone (the engine detects this asynchronously);
- pauses caused by interruptions.
One listening check in Chrome and Safari via /dev/player-lab is still needed.
- If resume() comes from the `blocked` state and the current URL no longer covers the remaining track, the engine re-signs before calling play(), so play() runs outside the gesture. This is fine on Chrome and Firefox (activation is per document). On WebKit it relies on the Start-time unlock of all three pooled elements having worked. This combination is rare.
- The optional Screen Wake Lock from research §7 is not implemented. It belongs in the UI/provider layer, together with the honest sleep and background notice and the `navigator.userActivation.hasBeenActive` gating of the Start button.
- Preference saves are best-effort: failures are only logged through deps.log and are never shown in the UI.
- A welcome announcement is marked played (in sessionStorage) only when it actually starts playing. If it fails or is skipped before starting, it is not retried in this engine lifetime, but a new browser session will offer it again.

## ui-kit

### Public API

UTILS: `@/lib/utils` (index), or the individual files `@/lib/utils/cn`, `/format`, `/initials`, `/files`
- cn(...inputs: ClassValue[]): string. ClassValue = string|number|boolean|null|undefined|readonly ClassValue[]. There is NO tailwind-merge: conflicting utilities resolve by stylesheet order, so a className should only add classes. To force an override, use Tailwind's `!` suffix, e.g. `px-8!`.
- formatDuration(seconds: number|null|undefined): string. Gives "m:ss" or "h:mm:ss", truncating fractions and clamping negatives to 0. Unknown values give "--:--" (UNKNOWN_DURATION).
- formatBytes(bytes: number|null|undefined): string. Binary units with 1 decimal: "512 B", "1.5 KB", "50 MB". Invalid input gives "—" (UNKNOWN_VALUE).
- formatDateTime(value: string|Date|null|undefined, options?: { timeZone?: string /* default "UTC" */; dateOnly?: boolean }): string. Output: "25 Sep 2026, 14:03 UTC". The month names are its own, so output is deterministic across ICU versions. Invalid input gives "—". An unknown time zone throws RangeError.
- initials(name: string|null|undefined): string. Examples: "Hotel Aurora"→"HA", "EmeraldBar"→"EB", no letters→"?".
- fileMatchesAccept(file: {name: string; type: string}, accept: string|null|undefined): boolean. Callers must re-check dropped files with it, because drops bypass `accept`.

UI: `@/components/ui` (barrel; server-safe unless marked [client]). Every component takes ref as a prop (React 19) and passes native props through.
- Button(props: ButtonProps). ButtonProps = ComponentPropsWithRef<'button'> & { variant?: 'primary'|'secondary'|'ghost'|'danger'|'outline'; size?: 'sm'|'md'|'lg'|'xl'; fullWidth?; loading?; loadingText?: ReactNode; icon?: ReactNode; iconRight?: ReactNode }. Defaults to type="button". `loading` sets disabled and aria-busy and shows a spinner.
- ButtonLink<T extends string>(props): next/link with the same styling. Props: { href: Route<T>, variant, size, fullWidth, icon, iconRight, className } plus the other Link and anchor props. Verified with typedRoutes both on and off. Cast computed strings `as Route`.
- buttonClasses({variant,size,fullWidth,className}?): string. Types exported: ButtonVariant, ButtonSize, ButtonStyleProps.
- IconButton: { 'aria-label': string (required); icon: ReactNode; variant? (default 'ghost'); size?: 'sm'|'md'|'lg'|'xl'; round?; loading? } plus button props. Mute should use aria-pressed; Play/Pause should change its aria-label.
- Input (ComponentPropsWithRef<'input'>, 44px tall, 16px text), Textarea, Label { required?; optional? }.
- Field { label: ReactNode; children: ReactElement /* exactly one control */; hint?; error?: string|readonly string[]|null; required?; optional?; id?; hideLabel?; labelAside?; className? }. It clones the control to add id, required, aria-describedby (hint+error) and aria-invalid. Works in Server Components.
- Select: ComponentPropsWithRef<'select'> & { placeholder?: string } (adds an empty option with value ""). className goes to the wrapper; other props go to the <select>.
- Checkbox: { label: ReactNode; description?: ReactNode } plus input props.
- [client] Switch: { checked?; defaultChecked?; onCheckedChange?(checked: boolean); name?; value? (default 'on'); label?; description? } plus button props. Renders role="switch" with aria-checked. With `name` it submits `name=value` only while on, like a checkbox. The uncontrolled state resets to defaultChecked on form reset.
- [client] Slider: { label: string; hideLabel?; value?; defaultValue?; onValueChange?(n); min=0; max=100; step=1; formatValue?(n)=>string (display and aria-valuetext); showValue=true } plus input props. Uses the global `.ui-range` CSS class with the `--range-progress` variable, which the player can reuse on its own range input.
- Card, CardHeader { actions? }, CardTitle { as?: 'h2'|'h3'|'h4' }, CardDescription, CardContent, CardFooter.
- Badge { tone?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info'; dot? }.
- Alert { tone?: 'neutral'|'info'|'success'|'warning'|'danger'; title?; description?; action?; icon?: ReactNode|null }. Danger uses role=alert; the other tones use role=status.
- Spinner { size?: 'sm'|'md'|'lg'; label? = 'Loading'; decorative? }.
- Skeleton (div props, aria-hidden).
- EmptyState { icon?; title; description?; action?; headingLevel?: 'h2'|'h3' }.
- [client] Dialog { open: boolean; onClose(): void; title; description?; children?; footer?; size?: 'sm'|'md'|'lg'; dismissible? = true; initialFocusRef?: RefObject<HTMLElement|null> }. Built on native <dialog>.showModal(). Sets aria-modal="true" while open, so player shortcut handlers can detect it. Returns focus on close, locks page scroll, and mounts content only while open.
- [client] ConfirmDialog { open; onCancel(); onConfirm(): void|Promise<unknown>; title; description?; children?; confirmLabel?; cancelLabel?; tone?: 'danger'|'primary' (default 'danger', focus starts on Cancel); pending? }. A promise returned from onConfirm is shown as busy until it settles; a rejection is not swallowed.
- [client] Tabs { items: readonly {value: string; label: ReactNode; content: ReactNode; disabled?: boolean}[]; label: string; value?; defaultValue?; onValueChange?; className?; panelClassName? }. Arrow keys and Home/End move between tabs; disabled tabs are skipped.
- [client] NavTabs { items: readonly {href: Route; label: ReactNode; exact?: boolean /* default true */}[]; label: string; className? }. Sets aria-current="page" on the active item.
- PageHeader { title; description?; actions?; breadcrumbs?: readonly {label: string; href?: Route}[]; children?; className? }. Renders the page's <h1>. Breadcrumbs is also exported on its own.
- ProgressBar { value?: number|null (null or undefined means indeterminate); max? = 100; label: string; showLabel?; showValue?; valueText?; tone?: 'accent'|'danger'; size?: 'sm'|'md' }.
- [client] ToastProvider (already mounted in the root layout) and useToast(): ToastApi.
  - ToastApi = { show(o: ToastOptions): string; success|error|warning|info(title: string, o?: {description?; durationMs?: number|null; action?: {label; onClick}}): string; dismiss(id: string): void }.
  - Toasts auto-dismiss after 5 s (errors 8 s), or never when durationMs is null. The timer pauses on hover and focus.
  - Announced through an aria-live="polite" region. useToast throws when used outside the provider.
- Table { caption?; showCaption?; wrapperClassName? }, THead, TBody, TR, TH { numeric?; scope default 'col' }, TD { numeric? }. Scrolls horizontally inside its own frame.
- [client] SubmitButton: ButtonProps minus type/loading plus { pendingLabel?: ReactNode }. Uses useFormStatus and must be rendered inside the <form>.
- FormMessage { state?: { ok: boolean; message?: string|null } | null; message?: string|null; tone?: 'success'|'error' }. The polite live region is always rendered; nothing shows while the message is empty.
- [client] FileDropzone { onFiles(files: File[]): void; label: string; description?; hint?; accept?; multiple?; disabled?; maxSizeBytes?: number (display only); icon?; id?; className? }. Presentational: it validates nothing, so callers must validate.
- Kbd, VisuallyHidden, SkipLink { href?: `#${string}` = '#main-content' }.

BRAND: `@/components/brand`
- PlatformMark { size?: 'sm'|'md'|'lg'; iconOnly?; className? }. Shows PLATFORM_NAME with an emerald equaliser glyph.
- [client] StationLogo { name: string; src?: string|null; size?: 'sm'|'md'|'lg'|'xl'; decorative?; className? }. Uses a plain <img> for signed URLs. Falls back to an initials monogram when there is no src or the image fails to load, including a failure before hydration.
- EqualizerBars { playing: boolean; size?: 'sm'|'md'|'lg'; label?: string (without it the component is decorative/aria-hidden); className? }. Animates only while playing and motion is allowed.

DESIGN TOKENS: Tailwind utilities defined in globals.css.
- Colours: canvas, surface, surface-2, surface-3, border, border-strong, fg, fg-muted, fg-subtle, accent, accent-hover, accent-active, accent-fg (text on a solid accent), accent-text (accent text on dark), success, warning, danger, danger-solid, danger-solid-hover, info, ring. They combine with bg-/text-/border-/ring-, e.g. bg-surface-2, text-fg-muted, bg-danger/10.
- Other utilities: rounded-control, rounded-card, shadow-card, shadow-overlay, animate-eq, animate-toast-in, animate-progress-indeterminate.
- Global rules: :focus-visible ring, ::selection, color-scheme: dark, prefers-reduced-motion, and page scroll lock while a modal dialog is open.
- The default Tailwind palette is still available.

APP FILES:
- layout.tsx: Server Component. Metadata title template `%s · ${PLATFORM_NAME}` with the default title, description PLATFORM_TAGLINE, and viewport themeColor/colorScheme dark. Loads the Geist fonts; body is `flex min-h-dvh flex-col bg-canvas`; ToastProvider wraps children.
- error.tsx uses Next 16.3 `retry()` for its "Try again" button rather than reset(); the bundled docs recommend retry, and it refreshes and then resets. It also offers "Go to the start page".
- global-error.tsx imports globals.css and renders its own html/body, with Try again and Reload buttons.
- not-found.tsx exports metadata title "Page not found".
- dev/layout.tsx calls notFound() when NODE_ENV === 'production', which also gates /dev/player-lab. /dev/ui is the component gallery.

### Notes for other modules

- vitest.config.ts (owner: tooling/tests): add "src/**/*.test.ts" to test.include so src/lib/utils/utils.test.ts runs under `npm test`, or move that file to tests/lib/utils.test.ts. It imports only "@/lib/utils" and "vitest".
- src/app/page.tsx (owner of the `/` redirect route): it is still the create-next-app scaffold and references /next.svg and /vercel.svg, which I deleted from public/ as instructed. Replace it with the redirect page from ARCHITECTURE §7. Until then that scaffold page shows two broken images; it still compiles.
- src/app/favicon.ico (not owned by me) is still the default Next.js icon. If a branded icon is wanted, add src/app/icon.svg using the PlatformMark glyph: an emerald #10b981 rounded tile with 4 dark bars.
- App shells (src/app/(venue)/layout.tsx, src/app/admin/layout.tsx, (auth) layout): render <SkipLink /> from @/components/ui first and give the shell's <main> id="main-content" and tabIndex={-1}. Also do not mount another ToastProvider; the root layout already provides one.
- Player UI owner: for the volume control, reuse <Slider label="Volume" hideLabel formatValue={v => `${v}%`} .../>, or put className="ui-range" with style={{'--range-progress': `${pct}%`}} on your own range input. <EqualizerBars playing={status==='playing'} /> and <StationLogo name={stationName} src={logoUrl} size="xl" decorative /> are ready. Dialog sets aria-modal="true" while open, which your shortcut handler can check.
- docs/ARCHITECTURE.md §10 (owner: orchestrator): optionally list the additional primitives now available: Field, FormMessage, SubmitButton, FileDropzone, ConfirmDialog, NavTabs, PageHeader, Table, Toast via useToast, and the brand components. Also note that `cn` does not merge conflicting Tailwind classes.

### Known open issues

- No tailwind-merge: when a caller's className conflicts with a component's own utility (for example a different bg or padding), stylesheet order decides the result, not argument order. Components are written so that className only adds classes. For a deliberate override use the `!` suffix (e.g. `px-8!`). If agents rely on overrides a lot, adding tailwind-merge would be a dependency decision.
- An uncontrolled Switch or Slider returns to defaultChecked/defaultValue when React resets the form after an action, which is what a native checkbox does. Forms that keep values after a validation error should pass defaultChecked or defaultValue from the echoed action state (see the /dev/ui FormDemo pattern).
- FormMessage: if an action returns exactly the same message twice in a row, screen readers do not announce it the second time, because the live region's text does not change.
- Toasts render beneath an open modal <dialog>, which sits in the browser's top layer. While a modal is open, toasts are visible behind the backdrop and cannot be clicked; they still auto-dismiss.
- StationLogo shows logos on a dark tile (surface-2). A logo with dark ink on a transparent background will have poor contrast. The DB has no per-logo background setting, so admins should upload logos with their own background.
- formatDateTime defaults to UTC, labelled "UTC", so server and client HTML always match. Showing a viewer's local time requires passing `timeZone` from client code.
- Not verified at runtime: global-error.tsx (it only typechecks and lints) and prefers-reduced-motion in a browser (checked only in the compiled CSS). The dialog's look was checked through DOM geometry and computed styles because the screenshot tool does not capture the top layer. next build was not run, per instructions.
- error.tsx uses Next 16.3's stable `retry()` prop, which refreshes and then resets, rather than `reset()`. The bundled docs recommend retry; the task asked for a reset button. The 'Try again' button therefore both re-fetches the segment and clears the boundary.

## audio-tts-libs

### Public API

## @/lib/audio/mp3 (NO server-only; music-metadata is loaded with a dynamic import, so tsx scripts can import it)
- `validateMp3(bytes: Uint8Array, options?: { maxBytes?: number /*default 50 MB; use MAX_ANNOUNCEMENT_BYTES for announcements*/; minDurationSeconds?: number /*default 0.5*/ }): Promise<Mp3Validation>`
- `type Mp3Validation = Mp3Metadata | Mp3Rejection`
- `Mp3Metadata = { ok: true; durationSeconds: number /*rounded to 0.01*/; bitrateKbps: number|null; sampleRateHz: number|null; channels: 1|2|null; codec: string; title: string|null; artist: string|null }`. Title and artist have whitespace collapsed and are capped at 200 UTF-16 units, so they are safe for the tracks table.
- `Mp3Rejection = { ok: false; code: Mp3RejectCode; reason: string /*user-facing*/ }`
- `type Mp3RejectCode = "empty"|"too_large"|"not_mp3"|"truncated"|"too_short"|"corrupt"`. `too_large` was added beyond the task's list and is only returned when maxBytes is exceeded.
- `fileNameToTitle(fileName: string): string`: "C:\\x\\01 - Blue_Moon.mp3" → "Blue Moon". Never returns an empty string (falls back to "Untitled").
- Constants: `MP3_DEFAULT_MAX_BYTES`, `MP3_DEFAULT_MIN_DURATION_SECONDS`, `MP3_MAX_JUNK_RATIO`, `MAX_TAG_TEXT_LENGTH`.
- Upload wiring: `const v = await validateMp3(new Uint8Array(await blob.arrayBuffer()), { maxBytes })`. If `!v.ok`, delete the object and return `jsonError(415, "unsupported_media", v.reason)`.

## @/lib/files/image (pure and client-safe)
- `sniffImage(bytes: Uint8Array): "png"|"jpeg"|"webp"|null`
- `validateLogo(bytes: Uint8Array, declaredType?: string|null, options?: { maxBytes?: number /*default MAX_LOGO_BYTES*/ }): LogoValidation`
- `LogoValidation = { ok: true; format: ImageFormat; contentType: "image/png"|"image/jpeg"|"image/webp"; extension: "png"|"jpg"|"webp" } | { ok: false; code: "empty"|"too_large"|"unsupported"|"type_mismatch"; reason: string }`. When declaredType is ""/null/octet-stream the type check is skipped. Any other declared type that differs from the bytes returns `type_mismatch`.
- Also exported: `IMAGE_CONTENT_TYPE`, and the types `ImageFormat` and `ImageContentType`.

## @/lib/tts/elevenlabs ('server-only')
- `createElevenLabsClient(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch; maxRetries?: number /*default 2*/; sleep?: (ms) => Promise<void> }): ElevenLabsClient`. Throws `ElevenLabsError("not_configured")` for an empty key.
- `getElevenLabsClient(overrides?)` builds a client from ELEVENLABS_API_KEY via getServerEnv(). Throws not_configured when the key is missing.
- `ElevenLabsClient` methods:
  - `listModels(o?: CallOptions): Promise<TtsModel[]>` returns only TTS-capable models that need no alpha access.
  - `listVoices(o?: CallOptions & { search?: string; maxPages?: number /*default 10 × 100 voices*/ }): Promise<Voice[]>` uses /v2/voices.
  - `getSubscription(o?): Promise<Subscription>`
  - `synthesize(input: SynthesizeInput): Promise<{ audio: Uint8Array; contentType: string; requestId: string|null; characterCount: number|null }>`
- `SynthesizeInput = { voiceId; modelId; text; languageCode?; voiceSettings?: VoiceSettings; outputFormat?: OutputFormat; seed?; applyTextNormalization?; timeoutMs? /*default 60 s*/; signal? }`. `language_code` is never sent to eleven_multilingual_v2.
- Retries: listings retry on rate_limited, provider_unavailable and timeout. Synthesis retries only on 429, because a 5xx or timeout may already have been billed.
- `class ElevenLabsError extends Error { kind: "auth"|"quota"|"rate_limited"|"validation"|"voice_not_found"|"provider_unavailable"|"timeout"|"not_configured"; status: number|null; providerCode: string|null; requestId: string|null; retryAfterMs: number|null; get retryable(): boolean }`. If a provider message echoes the API key, it is redacted.
- `classifyElevenLabsError(status, tokens, message, voiceScoped)`
- `buildSynthesizeBody(input)`
- `describeElevenLabsError(err): string`: an honest admin-facing message of at most 1000 chars, including the provider request id. Suitable for `announcements.last_error`.
- `elevenLabsErrorToApi(err): { status: number; code: ApiErrorCode; message: string; fields?: { voiceId } }`. Mapping: auth/not_configured → 503 tts_not_configured; quota → 502 tts_failed; rate_limited → 429; validation/voice_not_found → 400 invalid_request; provider_unavailable → 502 tts_failed; timeout → 504 tts_failed.
- Other exports: `OUTPUT_FORMATS`, `ELEVENLABS_BASE_URL`, and the types `TtsModel`, `Voice`, `VoiceSettings`, `OutputFormat`, `CallOptions`.

## @/lib/tts/options ('server-only')
- `getTtsOptions(options?: { forceRefresh?: boolean }): Promise<TtsOptionsResponse>`: 10-minute in-memory cache keyed by API key, and concurrent callers share one load.
  - No key → `{ configured: false, reason: TTS_NOT_CONFIGURED_REASON }`.
  - A key ElevenLabs rejects (auth) → `{ configured: false, reason }`, not cached.
  - Transient failures (rate_limited, provider_unavailable, timeout) are REJECTED with ElevenLabsError and not cached. The route should catch them and use `elevenLabsErrorToApi`.
- `clearTtsOptionsCache()`
- `createTtsOptionsService(deps)` for dependency injection.
- `buildTtsOptions(models, voices, preferredDefault)`, `toTtsModelOption`, `toTtsVoiceOption`, `chooseDefaultModelId`, `TTS_OPTIONS_TTL_MS`.
- Re-exports `resolveLanguageForModel` and `describeModelLanguageSupport`.

## @/lib/tts/models (pure and client-safe: admin UI components should import from here, not from options)
- `resolveLanguageForModel(model: Pick<TtsModelOption,"id"|"languages"|"supportsLanguageCode">, desired: string|null|undefined): string|undefined`. Never returns a code for multilingual_v2. Otherwise returns the primary subtag, e.g. "sr-Latn" → "sr", only if the model lists it.
- `describeModelLanguageSupport(model, businessLanguage): { status: "supported"|"unsupported"|"unknown"; languageCode: string|undefined; message: string }`
- `normalizeLanguageCode` (maps ISO 639-3 → 639-1), `languageDisplayName`, `modelAcceptsLanguageCode`, `isOfferedModelId` (hides turbo, v1 and conversational models), `effectiveMaxCharacters`, `compareModels`, `DEFAULT_TTS_MODEL_ID`, `DEFAULT_OUTPUT_FORMAT`.

## @/lib/tts/hash (uses node:crypto, so server-side only)
- `generationHash({ spokenText, voiceId, modelId, languageCode?, outputFormat? /*default mp3_44100_128*/, voiceSettings? }): string` returns a sha256 hex digest of a canonical JSON form. Text is trimmed, keys are sorted, and languageCode is ignored for multilingual_v2.

## @/lib/announcements/templates (pure and client-safe)
- `ANNOUNCEMENT_TEMPLATES` (as const; each has key, label, text and defaultPlacement): welcome_enjoy, welcome_station, station_listening, good_music, thank_you_visit.
- Types: `AnnouncementTemplateKey`, `AnnouncementTemplate`.
- `getAnnouncementTemplate(key)`, `isAnnouncementTemplateKey(key)`.
- `TEMPLATE_PLACEHOLDERS` = { business_name, station_name }.
- `validateTemplateText(text): { ok: true; placeholders } | { ok: false; reason; unknownPlaceholders: string[] }`. Rejects unknown placeholders, stray braces and blank wording.
- `renderAnnouncement({ template, business: { name, stationName, namePronunciation?, stationNamePronunciation? }, mode: "display"|"spoken" }): string`. Throws `TemplateError` for invalid wording. Spoken mode:
  - uses the pronunciations;
  - when there is no station pronunciation, uses the station name with the venue name respelled;
  - also respells names written literally in custom text (whole word, case-insensitive, Unicode-aware).
- `renderAnnouncementWording(template, business): { text; spokenText: string|null }`. spokenText is null when it equals text.
- `spokenBrandingNames(business)`, `placementLabel(p)`, `placementDescription(p, everyNTracks?)`, `ANNOUNCEMENT_PLACEMENT_OPTIONS`.

## @/lib/announcements/state (pure and client-safe; `now` is always explicit, as Date or ms)
- Types: `AnnouncementStateFields`, `AnnouncementWording` (AdminAnnouncement satisfies both), and `AnnouncementState` (adds brandingVersion, lastError, reviewReason).
- `toAnnouncementState(row)` maps a DB row to `AnnouncementState`.
- `GENERATION_LOCK_MS` = 180000.
- `isGenerationStale(a, now)`, `isGenerationInProgress(a, now)`.
- Each rule has a boolean form and a `check*` form returning `RuleCheck = { ok: true } | { ok: false; reason }`:
  - `canGenerate` / `checkGenerate`
  - `checkUploadAudio`
  - `checkEditWording`
  - `canApprove` / `checkApprove`: ready, or active with needsReview; requires audio.
  - `canActivate` / `checkActivate`: ready, with approvedAt set, not needsReview; this re-activates something previously approved.
  - `canDeactivate` / `checkDeactivate`
- `statusAfterWordingEdit(a, changes: { text?; spokenText?; voiceId?; modelId?; language? }): { status; audioInvalidated; ttsInputChanged; clearLastError; message }`
- `CLEARED_AUDIO_FIELDS`: the DB patch to write when `audioInvalidated` is true. It clears the audio columns, source, generation_hash, approved_at and approved_by. The caller must also remove the Storage object.
- `isPlayable(a & { brandingVersion }, business: { isActive; brandingVersion })`
- `describeStatus(a, now): { label; tone: "neutral"|"accent"|"success"|"warning"|"danger"|"info" /*same as BadgeTone*/; description }`

## tests/fixtures/audio.ts (reusable by other test authors)
`encodeToneMp3`, `id3v23Tag`, `id3v1Tag`, `id3v2Header`, `apeV2Tag`, `xingInfoFrame`, `vbriInfoFrame`, `wavFile`, `riffWrappedMp3`, `randomBytes`, `concatBytes`, `asciiBytes`, `mpegFrameOffsets`, `samplesPerFrame`.

### Notes for other modules

- docs/ARCHITECTURE.md §6 (owner: docs/architecture maintainer): add rows for the new modules so other agents find them: `src/lib/files/image.ts` (sniffImage/validateLogo), `src/lib/tts/options.ts` (getTtsOptions, 10-min cache), `src/lib/tts/models.ts` (client-safe model/language rules: resolveLanguageForModel, describeModelLanguageSupport), `src/lib/tts/hash.ts` (generationHash), `src/lib/announcements/state.ts` (state rules). Also note Mp3RejectCode includes `too_large` in addition to the task's list.
- Upload-complete route (/api/admin/uploads/complete): call `validateMp3(bytes, { maxBytes: UPLOAD_RULES[kind].maxBytes })` for tracks and announcements, and `validateLogo(bytes, claims' contentType)` for logos. When the result is not ok, delete the object and return 415 unsupported_media with `reason`. Use `v.title ?? fileNameToTitle(originalName)` and `v.artist ?? 'Unknown Artist'` as track defaults. For an announcement upload, call `checkUploadAudio(state, now)` first; a fresh generating lock should return 409 conflict. After an upload, set status 'ready', source 'upload', and approved_at/approved_by = null.
- Generate route (/api/admin/announcements/[id]/generate):
1. `checkGenerate(toAnnouncementState(row), now)`, returning 409 conflict with the reason if it fails.
2. `const opts = await getTtsOptions()`. Find the model and check its maxCharacters, then `languageCode = resolveLanguageForModel(model, request.languageCode ?? business.announcement_language)`.
3. Compute `spokenText = row.spoken_text ?? row.text` and `hash = generationHash({ spokenText, voiceId, modelId, languageCode, voiceSettings })`. If hash equals row.generation_hash, the audio exists and !force, return `reused: true`.
4. Otherwise synthesize with `getElevenLabsClient().synthesize({... signal: request.signal})`, then `validateMp3(result.audio, { maxBytes: MAX_ANNOUNCEMENT_BYTES })` before storing it.
5. On ElevenLabsError, write `describeElevenLabsError(e)` to last_error, set status 'failed', and respond with `elevenLabsErrorToApi(e)`.
6. Set `export const maxDuration >= 60` on the route.
- Admin announcement Server Actions: before an edit call `checkEditWording`, then apply `statusAfterWordingEdit`. When `audioInvalidated` is true, write `CLEARED_AUDIO_FIELDS` and remove the Storage object. When `clearLastError` is true, null out last_error. Approve must use `checkApprove`; approving sets status 'active', needs_review=false, branding_version=current, approved_at/by. Activate/deactivate must use `checkActivate`/`checkDeactivate`, and deactivate should keep approved_at so `checkActivate` can re-enable it. Render template wording with `renderAnnouncementWording(template, business)` and validate custom text with `validateTemplateText`.
- GET /api/admin/tts/options route: `return jsonOk(await getTtsOptions())`, and catch ElevenLabsError with `elevenLabsErrorToApi` (transient errors are rejected, not returned as configured:false).
- Admin UI (announcement generate form and list): client components must import `describeModelLanguageSupport`, `resolveLanguageForModel` and `languageDisplayName` from `@/lib/tts/models`, not from `@/lib/tts/options`, which is server-only. `describeStatus(a, now)` requires an explicit `now` (React Compiler forbids Date.now() during render), so pass it from state or a prop.

### Known open issues

- No real LAME- or FFmpeg-encoded MP3 files, and no encoder, exist on this machine. Xing/Info/LAME and VBRI handling was verified only against hand-built frames that follow the spec. music-metadata independently read my Xing frame count and LAME version at the expected offsets, which supports the layout. Real-world files should be tried once some exist.
- Duration choice: when a LAME/FFmpeg tag declares encoder delay/padding, validateMp3 subtracts it (gapless length). music-metadata and some decoders report the untrimmed frame length instead, about 25–60 ms longer. This is harmless for URL-expiry margins and display.
- Truncation detection only works when a Xing/VBRI header declares a frame count, allowing a shortfall of up to max(2 frames, 1%). A plain CBR file cut mid-stream is accepted with its shorter real duration. This matches what a browser would play and is covered by a test.
- ElevenLabs behaviours still unverified without a real key (research §14): the real `/v1/models` language_id format (codes are normalised, e.g. ISO 639-3 → 639-1, as a hedge), the real maximum_text_length values (capped at the documented limits), whether 429s send Retry-After, and whether the character-cost header is present. The client handles each case either way.
- Model filtering hides deprecated turbo models, the retired *_v1 models and *conversational* models (per the research recommendation). If ELEVENLABS_DEFAULT_MODEL_ID names a hidden or unavailable model, defaultModelId falls back to eleven_multilingual_v2, or else the first offered model.

## demo-scripts

### Public API

## Commands (defined in the root package.json; I did not change it)

- `npm run demo:audio [-- --no-sapi]`: writes `supabase/seed/audio/{music,announcements}/*.mp3` and `manifest.json`. The output is byte-identical on every run.
- `npm run seed:dev -- --dry-run`: prints the plan. No network calls.
- `npm run seed:dev -- --yes [--allow-remote] [--admin-email <e>]`: performs the seed.
  - Environment: `SEED_ADMIN_EMAIL`, `SEED_EMERALDBAR_EMAIL`, `SEED_AURORA_EMAIL`.
  - Defaults: admin@example.com, emeraldbar@example.com, hotel-aurora@example.com.
- `npm run admin:create -- <email> [--link]`

## Manifest contract

File: `supabase/seed/audio/manifest.json`. This is what the dev audio route and the player lab should read. The schema is in `scripts/lib/manifest.ts`.

Top level: `{ version: 1, synthetic: true, notice: string, entries: Entry[] }`

Fields on every entry:
- `id`: unique slug; it is also the file's base name.
- `file`: `"music/<id>.mp3"` or `"announcements/<id>.mp3"`, relative to `supabase/seed/audio`.
- `title`, `artist` (`"<PLATFORM_NAME> Test Signal"`).
- `durationSeconds`: the value `validateMp3` reports.
- `bytes`, `sha256`, `bitrateKbps`, `sampleRateHz`, `channels` (1 | 2).
- `synthetic: true`.

Track entries add:
- `kind: "track"`
- `genre`: the genre slug
- `generator: "synthetic-tones"`
- `style: { mood, bpm, key }`

Announcement entries add:
- `kind: "announcement"`
- `business`: `"emeraldbar"` or `"hotel-aurora"`
- `templateKey`: `"welcome_enjoy"`, `"station_listening"` or `"good_music"`
- `placement`: `"welcome"`, `"rotation"` or `"both"`
- `text`, and `spokenText` (a string or null)
- `generator`: `"windows-sapi"` or `"chime-placeholder"`
- `voice`: a string or null

What the seed writes (the DB contract):
- Demo venues are identified by name plus the seed-marker `contact_email`: `demo+emeraldbar@example.com` and `demo+hotel-aurora@example.com`.
- Track objects go to `music/tracks/{track_id}/{32hex}.mp3`.
- Announcement objects go to `announcements/{business_id}/{announcement_id}/{32hex}.mp3`.
- Announcements are inserted with `status active`, `source upload`, `approved_at now()`, `approved_by = admin`, and `branding_version` equal to the business's.

## Script-internal exports

These live under `scripts/lib/*`. App code should not import them.
- `generateToneTrack(options: ToneTrackOptions): Uint8Array` and `synthesizeToneTrack` (audio-synth.ts)
- `normalizeLoudness(pcm, { targetLufs = -16, ceilingDbfs = -1 })` and `integratedLufs` (pcm.ts)
- `encodeMp3(pcm, kbps)` and `wavToMp3(wav: Uint8Array, opts)`, both validating their inputs (mp3-encode.ts)
- `probeSapi()`, `speakToMp3(text, { voice })` and `chooseVoice` (sapi.ts)
- `loadLocalEnv()` (env.ts)
- `evaluateSeedSafety`, `parseSeedArgs`, `resolveSeedUsers`, `buildSeedPlan` and `formatSeedPlan` (seed-plan.ts)
- `readExistingState` and `applySeedPlan` (seed-apply.ts)
- `ensurePlatformAdmin` and `buildConfirmLink(siteUrl, hashedToken, 'invite' | 'recovery')`, which builds `${site}/auth/confirm?token_hash=…&type=invite&next=/set-password` (admin-invite.ts)

### Notes for other modules

- vitest.config.ts (root, owner: tests/platform): add "scripts/tests/**/*.test.ts" to the "unit" project's include so `npm test` runs the 53 script tests (right now they only run via `npx vitest run --config scripts/vitest.config.ts`). They need the committed supabase/seed/audio files and take about 5 s.
- Dev audio route GET /api/dev/audio/[file] and /dev/player-lab (owner: player/dev tooling): the demo files are in two subfolders, supabase/seed/audio/music/ and supabase/seed/audio/announcements/, so a single [file] segment cannot address them by path. Resolve the file through supabase/seed/audio/manifest.json instead (entry.id → entry.file, both validated slugs). Use entry.kind, entry.genre, entry.business and entry.placement to build the lab playlist. Serve only paths listed in the manifest; never join a user-supplied path.
- src/lib/announcements/templates.ts, src/lib/audio/mp3.ts, src/config/platform.ts (owners: announcements / audio / platform): scripts/lib/demo-catalog.ts and scripts/lib/demo-audio.ts import these at runtime under tsx (CommonJS mode for src/). They must keep working there: no `import "server-only"`, no runtime (non-type) `@/…` alias imports, and no static imports of ESM-only packages (music-metadata must stay a dynamic import). The seed also relies on the template keys welcome_enjoy, station_listening and good_music, and on renderAnnouncementWording / getAnnouncementTemplate. Renaming them breaks `tsc` for scripts/lib/demo-catalog.ts.
- docs/ARCHITECTURE.md §11 (owner: lead): consider documenting that the demo audio contract is supabase/seed/audio/manifest.json (schema in scripts/lib/manifest.ts, docs in docs/SEEDING.md). Also record that demo venues are identified by the seed-marker contact emails demo+emeraldbar@example.com and demo+hotel-aurora@example.com.
- docs/SETUP.md (if owned by someone): link to docs/SEEDING.md for `npm run demo:audio`, `npm run seed:dev -- --yes` and `npm run admin:create -- <email> [--link]`. Note that invite links need the token_hash email template (docs/research/supabase.md §4.2).

### Known open issues

- seed:dev and admin:create have never run against a real Supabase project (no credentials here). Their logic is covered by an in-memory fake of the supabase-js calls, but these live behaviours are unverified: a Uint8Array body in storage upload under Node; PostgREST `in` filters on titles that contain em dashes and parentheses (postgrest-js quotes them); `ilike` used as case-insensitive equality; the service-role update of profiles.role passing the role guard trigger.
- The generated audio adds about 7.7 MB (27 MP3s) under supabase/seed/audio. The lead should decide whether to commit it or regenerate it per machine. The output is deterministic, so committing it produces no churn.
- The loops are pleasant by construction only: consonant voicings, soft envelopes, -16 LUFS, no clipping, no note-end clicks. Nobody has listened to them. They are not gapless (about 36 ms of encoder padding).
- The announcement wording comes from the app's ANNOUNCEMENT_TEMPLATES, so the stored text uses the typographic apostrophe ("You’re listening to …") instead of the task's straight "You're". SAPI is given a straight apostrophe.
- Seed matching rules are strict by design. A demo track renamed in the admin UI is uploaded again on the next run. A demo venue whose seed-marker contact email was edited is reported as a conflict instead of being reused.
- On a machine without Windows SAPI, `npm run demo:audio` replaces the committed speech announcements with chime placeholders. They are labelled, but the files change in git. The generator prints the reason, and SEEDING.md warns about it.

