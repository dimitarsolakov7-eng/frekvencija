# Redesign wave 2 notes (build notes)

Generated from the redesign wave-2 agents' reports (2026-09-25).

## venue-v2

### Public API

ROUTES ((venue) group; every page is force-dynamic and checks requireBusinessUserPage(path) again)
- (venue)/layout.tsx:
  - Order: requireBusinessUserPage(). No business → <VenueStatusScreen variant="no-business" support/>. Inactive (checkBusinessUserAccess fails) → variant="inactive". loadPlayerBootstrap throws → unstable_rethrow, then variant="unavailable" with RefreshButton.
  - Contact details come from loadSupportContact(await createSupabaseServerClient()), i.e. platform_settings read with the user's own client. The call never throws.
  - Success renders <PlayerProvider key=userId:businessId bootstrap><VenueAppShell business email={ctx.email}>{children}</VenueAppShell></PlayerProvider>.
- /radio → <RadioScreen/>; generateMetadata title = station name. loading.tsx is a skeleton with the same geometry.
- /account:
  - loadAccountDetails(userClient, ctx.business, ctx.email) reads businesses: name, station_name, business_type, contact_email, announcement_language, filtered by eq id = session business id. If the read fails it falls back to the session's name/station and sets partial = true.
  - Renders <AccountView details partial resetAction={sendAccountPasswordReset} changePasswordHref="/reset-password"/>. Has loading.tsx.
- /help (new) → <HelpScreen/>. Has loading.tsx.
- (venue)/error.tsx (new): client boundary rendered inside the shell, so a failing page keeps the player alive. Alert + Try again (retry()) + digest + link to /radio.
- SERVER ACTION sendAccountPasswordReset(): Promise<ActionState> in (venue)/account/actions.ts. Steps:
  - requireBusinessUserPage('/account'); the email comes from the session only.
  - isSupabaseConfigured check.
  - redirectTo = getSiteUrl().
  - consumeRateLimit(authRateLimit(RESET_IP_LIMIT, ip)), then RESET_EMAIL_LIMIT per email (same buckets as Forgot password).
  - resetPasswordForEmail(email, {redirectTo}) with the user's server client.
  - Returns a neutral success message even when Supabase errors; returns honest ok:false messages for rate limits, setup mode, and accounts without an email.

COMPONENTS (src/components/player)
- PlayerProvider.tsx:
  - PlayerContextValue gains signAnnouncement(id, signal?) → Promise<SignedMedia>. The app uses createPlayerApi().signMedia({kind:'announcement', id}).
  - signOut(options?: {destination?: string}); only same-origin paths are accepted.
  - New PlayerContextProvider({value, children}) lets the lab and previews supply their own context.
  - signOutOfVenue(destroyEngine?, {destination?}).
  - usePlayer and useOptionalPlayer are unchanged.
- VenueAppShell({business: Pick<PlayerBusiness,'name'|'logoUrl'>, email?, links?: VenueLinks, children}), server-compatible:
  - Sidebar: SidebarBrand, SidebarIdentity (venue initial or logo), SidebarNav 'Venue' (Your radio / Account, match exact), then SidebarSection 'Help and sign out' (Help link + VenueSignOutButton).
  - Top bar below 1024px: MobileTopBar + VenueAccountMenu. Bottom tabs: MobileTabBar Radio / Account.
  - playerBar = <PlayerBar/>. Wraps everything in VenueShellProvider.
- venue-shell-context.tsx: VenueLinks {radio, account, help}, VENUE_LINKS, VenueShellProvider, useVenueShell() → {links, email}.
- VenueSignOutButton: sidebar row running the venue logout.
- VenueAccountMenu({name, logoUrl?, className?}): compact UserMenu with Account, Help, Sign out (onSelect → signOut).
- RadioScreen (client, reads usePlayer): header (eyebrow "Your station", h1#station-name, "Choose the sound for your space.", account menu on desktop), NowPlayingHero, StationVoiceCard, ComingUpCard, "Find your atmosphere" GenreGrid (id="genres"). Keyboard shortcuts via usePlayerShortcuts(shortcutsPreference).
- NowPlayingHero:
  - CoverImage artwork for the genre with a dark gradient; eyebrow / genre name / title / artist from describeHero.
  - One large emerald control: round Play/Pause, or a labelled pill for Start Radio / Resume radio / Retry.
  - Visible status line (heroStatus). A notice box for error and empty states: "Log in again" link to /login?error=session_expired&next=%2Fradio (clears the session first); "Choose another genre" (#genres); "Reload page"; "Check again". Also shows snapshot.notice (single track).
- StationVoiceCard({clip, hasRotation, everyNTracks, preview: VoicePreviewView, onPreview, onStop, onResumeRadio, onDismiss}):
  - Waveform, the quoted clip text, and a badge ("Every N songs", or "When the radio starts" for a welcome-only clip).
  - With no approved clip it shows "No approved announcement yet — music plays without voice clips."
  - Buttons: Preview / Stop preview / Resume radio / Preview again / Try again / Close. A role=status line reports the preview state.
- ComingUpCard({upcoming, genre, emptyText, voiceNote}): read-only numbered list of title · artist and duration. Collapsible <details> below 768px.
- GenreGrid({genres, snapshot, onSelect, onPlay}): 2 columns below 1024px, 3 from 1024px. The card body is a stretched button (aria-pressed, aria-label "Select {name}", described by its text); a separate IconButton "Play {name}". "Playing" with EqualizerBars shows only while that genre is actually playing; empty genres are disabled with "No tracks yet".
- PlayerBar: persistent card with artwork, title/subtitle (describeBarItem), Play/Pause, Skip (canSkip), read-only TrackProgress, compact VolumeControl. On phones the volume opens a bottom Drawer. No previous button. It holds the only playback live region (liveStatusText).
- TrackProgress({positionSeconds, durationSeconds, loading?}): decorative bar plus "m:ss / m:ss" text; never announced live.
- VolumeControl gains variant 'compact' | 'full'. When volumeControllable is false the slider is replaced by an explanation (DEVICE_VOLUME_NOTE).
- PlaybackSettings({shortcutsEnabled, onShortcutsChange, wakeLock}): shortcuts switch plus key list, Keep screen awake, device-sleep note. Also exports DEVICE_SLEEP_NOTE and wakeLockStatus.
- AccountView({details: VenueAccountDetails, partial?, resetAction: PasswordResetAction, changePasswordHref}): read-only 06-style fields, reset form (useActionState + FormMessage), "Change password now", Sign out, PlaybackSettings.
- HelpView({everyNTracks, hasRotation, hasWelcome, support, accountHref}) and HelpScreen (reads the context). Also exports stationVoiceHelp.
- SupportContactDetails({support}): mailto / tel links, or "Ask your Frekvencija administrator…". Also exports telHref and hasSupportContact.
- Pure helpers:
  - player-view.ts adds: BLOCKED_COPY, NO_MUSIC_COPY, NO_VOICE_CLIP_COPY, SESSION_EXPIRED_LOGIN_PATH, playGenre(commands, snapshot, id), genreCardState, pickVoiceClip, everyNSongsLabel, stationVoiceCountdown, comingUpEmptyText, liveStatusText, heroStatus, describeHero, describeBarItem, venueInitial.
  - player-view.ts changes: createIdleSnapshot now includes upcoming: []; the unblock label is "Resume radio"; describePlayerError gains the action 'reload' for business_inactive and 'Log in again' for auth_expired; announcementCountdown was replaced by stationVoiceCountdown.
- voice-preview.ts: voicePreviewReducer, IDLE_VOICE_PREVIEW, isVoicePreviewActive, describeVoicePreview(state, radioActive), describeVoicePreviewError.
- useVoicePreview({signAnnouncement, commands, radioActive, volume, muted, announcementVolume}) → {state, view, start(clipId), stop, resumeRadio, dismiss}:
  - Remembers whether the radio was playing, calls pause(), then signs the clip.
  - Plays it in its own new Audio(), unlocked with load() inside the click. The engine never sees it, so the song counter is untouched.
  - resume() runs only from the explicit "Resume radio" button. If the radio restarts from any other control, the preview stops.

DEV
- /dev/player-lab: the real VenueAppShell + RadioScreen + PlayerBar, driven by the lab engine through PlayerContextProvider with a lab bootstrap. The collapsible "Player lab" details panel keeps engine setup, faults, live snapshot (now including upcoming) and the event log. Station-voice Preview plays the demo clip through the lab API. Account and Help links open the previews.
- lab-catalog.ts: LabBusiness.type, coverUrl: null on genre cards, and buildLabBootstrap(catalog, {businessKey, everyNTracks, announcementVolume?}). lab-api getAnnouncements now returns text.
- /dev/preview/radio?state=: idle, playing (default), paused, announcement, loading, buffering, blocked, network, catalogue, session, genre-unavailable, empty, single-track, no-voice, fixed-volume, no-music, no-genres. It uses StaticPlayer (a fixture reducer, so the controls react) and a state switcher.
- /dev/preview/radio/account[?partial=1] uses a no-op reset action. /dev/preview/radio/help[?contact=0].

### Cross-module requests

- docs/ARCHITECTURE.md §7/§9/§10 and docs/build-notes (docs owner), please record:
- (a) /help is a new venue route.
- (b) The venue shell is VenueAppShell (sidebar, mobile top bar and tabs, persistent PlayerBar on every venue route including /radio). MiniPlayer, RadioPlayer, GenrePicker, PlayerAlerts and PlayerSettings are removed.
- (c) PlayerContextValue gained signAnnouncement(id, signal?) and signOut({destination?}). New PlayerContextProvider for the lab and previews.
- (d) PlayerBar holds the only playback live region. Keyboard shortcuts still run only on /radio; their on/off switch and Keep screen awake moved to /account under 'Playback on this device'.
- (e) The station-voice Preview plays in a separate element and never touches the engine or the song counter.
- (f) /dev/preview/radio[/account|/help] exist.
- src/components/public/request-access-options.ts (public-auth owner): /account imports BUSINESS_TYPE_OPTIONS for business-type labels. Please keep that export stable.
- src/app/(auth)/_lib/request.ts (auth owner): the /account reset action imports authRateLimit, clientIpFromHeaders, RESET_IP_LIMIT and RESET_EMAIL_LIMIT (same buckets as Forgot password). Please keep those signatures stable.
- src/lib/auth/proxy-rules.ts (platform owner): nothing to change, BUSINESS_AREA_PREFIXES already includes /help. Noting only that /reset-password (linked from /account 'Change password now') is outside the venue layout, so the player stops there; the page says so.
- ui-foundation (optional): UserMenu/DropdownMenu append their own 'relative inline-flex' wrapper classes, so a caller cannot hide the menu with 'hidden lg:inline-flex' through className. I wrapped it in a div. A `wrapperClassName` or tailwind-merge would make that easier.

### Open issues

- Not run in a real browser with hydration (next dev and next build were off-limits). These are covered only by unit tests, server-render tests and static screenshots:
- the station-voice Preview flow (pause, sign, separate <audio>, Stop, Resume radio);
- the phone volume Drawer;
- the account menu DropdownMenu;
- keyboard shortcuts;
- the useActionState reset form;
- the lab UI around the real engine.
- Still needed: a listening pass in /dev/player-lab on Chrome and Safari/iOS (the Preview uses its own element, unlocked with load() inside the click; WebKit behaviour is unverified).
- The Preview follows the listener's mute and volume, so it is silent while the radio is muted. The card does not point this out.
- If the radio starts from another control (big button, genre Play, keyboard, media keys) while a preview is loading or playing, the preview ends through a render-phase dispatch plus an effect that silences the element. ESLint accepts this, but it is only unit-tested at the reducer level.
- The Coming up thumbnails reuse the genre's artwork, because tracks have no artwork of their own.
- /account reads businesses.contact_email with the member's own client (existing businesses select policy for members). This is not verified against live Supabase. The account reset uses PKCE resetPasswordForEmail, the same as Forgot password: the link goes through /auth/confirm to /reset-password, which depends on the email template set up by the auth owner.
- The dev previews use example.com contact details and the design's names as fixtures only. Their station-voice Preview plays the synthetic demo clip from /api/dev/audio, so the demo manifest must exist.
- In the player lab, Account and Help link to the static previews. Following them leaves the lab page, which stops the lab engine; this is intended for a dev tool.
- When rendered on the server, 'Keep screen awake' shows as unsupported (supported is false in the server snapshot) until hydration. This is expected.

## admin-catalog-v2

### Public API

UPLOADS (genre-cover kind)
- limits.ts: `MAX_GENRE_COVER_BYTES = 3145728`. `UPLOAD_RULES['genre-cover'] = {bucket:'genre-covers', maxBytes:3 MB, label:'Genre cover', media:'image'}`. `UploadBucket` now includes 'genre-covers'. The checkUploadFile message reads "…the genre cover limit is 3 MB".
- validation/uploads.ts: `signUploadRequestSchema` accepts `{kind:'genre-cover', genreId, fileName, fileSize, contentType}`.
- uploads/token.ts: payload schema accepts kind 'genre-cover' with bucket 'genre-covers'; targetId is the genre id.
- uploads/client.ts: `UploadTarget` gains `{kind:'genre-cover'; genreId}`.
- use-upload-queue.ts: new option `upload?: UploadRunner`, read once (the previews inject a simulated uploader).
- data/admin/uploads.ts:
  - New: `ImageExtension`, `IMAGE_CONTENT_TYPE_BY_EXTENSION`, `isImageExtension`, `buildGenreCoverObjectPath(genreId, ext)` giving `{genreId}/{32hex}.{png|jpg|webp}`.
  - `UploadPathParts` has a `{kind:'genre-cover', genreId, extension}` variant, and `parseUploadObjectPath`/`pathMatchesTarget` handle it. This fixes the exhaustiveness error.
  - The old Logo* names are kept as aliases.
- POST /api/admin/uploads/sign, kind 'genre-cover':
  - Rejects a non-PNG/JPEG/WebP extension with 415.
  - Looks the genre up with the admin's client; a missing genre gives 404 "This genre no longer exists. Refresh the page." and no upload link is created.
  - Signs with the admin's client in bucket genre-covers.
- POST /api/admin/uploads/complete, kind 'genre-cover' (completeGenreCover):
  - Genre missing → the object is removed and the route answers 404.
  - Replayed token → 409; nothing is touched.
  - Bytes are validated with validateLogo (PNG/JPEG/WebP sniffing, type must match the signed extension, 3 MB). Invalid → object removed and 415; the size message says "genre covers".
  - `genres.cover_path` is updated with the admin's client, guarded on the old path. A lost update gives 409 and the new object is discarded when safe.
  - The previous cover is removed afterwards with the secret-key client.
  - The response is `{kind:'genre-cover', genreId, coverPath, coverUrl}`; coverUrl is signed with the admin's user client via signGenreCoverObject. If signing fails after the save, the route answers 500 "The cover was saved, but its preview link could not be created…".
- media/signing.ts:
  - `signGenreCoverObject(client, path)`
  - `signStorageObjects(client, bucket, paths, ttl): Promise<Map<path,url>>`: one createSignedUrls call; dedupes; drops blanks; never throws.
  - `signGenreCoverUrls(client, paths)`: baseline TTL; never throws.
  - Types `StorageBatchSigningClient`, `BatchSignedUrlEntry`.

DATA (src/lib/data/admin/catalog.ts, server-only, admin's own client)
- `loadGenreCatalog()` items now include `coverPath` and `coverUrl` (one batch sign on genre-covers; null on failure, and the UI falls back to defaultGenreArtwork(slug)).
- `loadGenreOptions()` returns `{id, name, slug, isEnabled, coverUrl}`.
- `loadTrackPage()` statuses are 'all' | 'active' | 'inactive' | 'removed'; statusCounts is `{active, inactive, removed}`.

SERVER ACTIONS
- src/app/admin/music/actions.ts keeps updateTrackAction, setTrackActiveAction, removeTrackAction, restoreTrackAction and deleteTrackAction; their wording now says active/inactive.
  - New `setTracksActiveAction(trackIds: string[], active: boolean)`
  - New `removeTracksAction(trackIds: string[])`
  - Both validate 1–200 ids (trackBulkIdsSchema/MAX_BULK_TRACKS in validation/tracks.ts), do one `.in('id')` update with the admin's client, report missing or already-removed tracks, and revalidate.
- src/app/admin/genres/actions.ts keeps all existing actions.
  - `createGenreAction` success now carries `values.createdGenreId`.
  - New `saveGenreAction(genreId, formData)`: name, slug (blank keeps the current one), description, isEnabled, availableToAll. With `accessListed=true` plus repeated businessIds, the business_genre_access rows become exactly that set (same upsert/delete helpers as setGenreAccessAction). Partial failures are reported honestly.
  - New `removeGenreCoverAction(genreId)`: clears cover_path guarded on its current value, then removes the object with the admin's client (storage policy "genre-covers: admin delete").
  - `deleteGenreAction` now also removes the cover object (best effort).
  - `setGenreEnabledAction` messages say active/inactive, and that tracks are kept.

PAGES (force-dynamic, requireAdminPage, content only inside AdminShell, loading.tsx skeletons matching the final layout)
- /admin/music: loads genres and a track page, then renders `<MusicLibrary query genres page unknownGenre actions={MusicActions}/>`. `?genre=<id>` preselects the genre filter, and new uploads go into that genre by default.
- /admin/genres: renders `<GenreManager genres businesses actions={GenreActions}/>`.
- The error state keeps the PageHeading and shows an Alert with Try again.

COMPONENTS (src/components/admin/catalog, props-driven)
- `MusicLibrary({query, genres, page, unknownGenre?, actions: MusicActions, services?: CatalogServices, basePath?='/admin/music', genresPath?='/admin/genres'})`:
  - PageHeading "Music library" / "One catalogue. Every venue." with "+ Upload music" (opens the file picker; files go to the queue).
  - Tabs: All tracks / Uploads (the Uploads tab shows an in-progress count badge).
  - TrackFilters: debounced search "Search tracks or artists", a genre select (All genres / each genre / Without genre) and a status select (All statuses default / Active / Inactive / Removed). All filters live in the URL.
  - TrackTable in a container-query layout: checkbox with select-all, first-genre artwork, title + artist, GenreChips, duration, StatusPill, and a DropdownMenu with Edit / Preview / Replace file / Activate or Deactivate / Remove from playback (confirmed) / Restore / Delete permanently (removed tracks only, confirmed).
  - BulkActionBar: Activate, Deactivate, Remove from playback (confirmed), Clear.
  - Count footer "N tracks" with a sort select and pagination.
  - "Selected track" TrackEditor: sticky right column from 1024px, a Drawer below. Artwork, Title, Artist, Genres checkbox tiles, a single inline preview player, Replace file, Save changes (only saves on Save), Discard. Switching tracks with unsaved edits asks first; beforeunload also warns.
  - UploadQueuePanel ("Add music whenever you like. No website update needed."): per-file icon, name, "MP3 • 8.4 MB", progress bar with %, phase text, Cancel/Retry/Remove, an Edit button for finished uploads, and "Add new uploads to" genre toggle chips.
- `GenreManager({genres, businesses, actions: GenreActions, services?, musicPath?, businessesPath?})`:
  - PageHeading "Genres" / "Give every space the right sound." / "+ Add genre", plus a genre search.
  - Card grid: two columns on phones and next to the panel; three at very wide sizes.
  - GenreCard: cover, drag handle, name, Active/Inactive pill, track count, and a menu with Edit / Move up / Move down / Activate or Deactivate / Delete (confirmed).
  - Reordering, persisted via reorderGenresAction with an optimistic update that reconciles with the server's order:
    - mouse: HTML5 drag and drop onto another card;
    - touch/pen: pointer events on the handle, with auto-scroll;
    - keyboard: arrow keys, Home and End on the handle, plus Move up/Move down; focus is kept on the moved genre and announced.
    - Reordering is disabled while a search filters the grid.
  - GenreEditor ("Edit genre" panel, a Drawer below 1024px, "Add genre" uses the same panel):
    - cover field: Change cover (progress, cancel, validation errors) and Remove cover (confirmed), with the hint "Upload a cover image for this genre.";
    - Genre name, Description (with counter), Availability (All businesses / Selected businesses with a business picker), a Status switch, and a slug under "More settings";
    - Manage tracks links to /admin/music?genre=id and shows the track counts; a warning appears when there is no playable music;
    - Save changes, and Deactivate/Activate genre (deactivation is confirmed and never deletes audio);
    - unsaved changes are guarded the same way as tracks.
- Pure helpers:
  - track-query.ts: parseTrackStatus with legacy aliases disabled→inactive and current→all; trackListHref(q, patch, basePath); genreTracksHref; TRACK_STATE_LABELS; trackStateTone; formatTrackCount.
  - genre-helpers.ts: moveToIndex, sameOrder, normalizeForSearch, genreMatchesSearch.
  - genre-draft.ts and track-helpers.ts: drafts, dirty checks, FormData builders, selection and upload-row formatting.
  - services.ts: MusicActions, GenreActions, CatalogServices, DEFAULT_CATALOG_SERVICES.

DEV PREVIEWS (inside AdminShell; the /dev layout returns 404 in production)
- /dev/preview/music?scenario=empty: example tracks (Afterglow, Slow Motion, …). Filters, sort and paging run in memory. Actions are no-ops that return success. Uploads are simulated; a file name containing "broken" fails validation. Previews play /api/dev/audio demo loops.
- /dev/preview/genres?scenario=empty: six genres and four venues. Cover uploads are simulated and show the chosen image.

### Cross-module requests

- Docs owner (docs/ARCHITECTURE.md §7/§8, build notes), please record:
- Upload kind 'genre-cover':
  - sign: the genre must exist, otherwise 404; path {genreId}/{32hex}.{png|jpg|webp}; bucket genre-covers; 3 MB.
  - complete: the image is validated by content; genres.cover_path is set with the admin's client, guarded on the old path; the previous cover is removed afterwards with the secret-key client; invalid image → object removed + 415; replay → 409; genre gone → 404 + object discarded.
  - response {kind, genreId, coverPath, coverUrl}, signed with the admin's user client.
- /admin/music status filter: all | active | inactive | removed, default all. Legacy values disabled→inactive and current→all are still accepted.
- New actions: setTracksActiveAction, removeTracksAction, saveGenreAction, removeGenreCoverAction.
- createGenreAction success now returns values.createdGenreId; deleteGenreAction also deletes the cover object.
- Player-backend owner (src/lib/data/player.ts), optional: signGenreCoverUrls / StorageBatchSigningClient can now delegate to @/lib/media/signing (signGenreCoverUrls, signStorageObjects, StorageBatchSigningClient, BatchSignedUrlEntry); the semantics are the same (one batch, never throws).
- Public-site owner (src/lib/data/public.ts loadPublicGenres), optional: signStorageObjects(secretClient, 'genre-covers', paths, ttl) replaces the hand-written createSignedUrls mapping.
- Owner of src/lib/files/image.ts, optional: validateLogo's too_large reason says 'logos can be at most …'. The genre-cover complete route rewrites it for covers; a `label` option would avoid that.
- UI-foundation owner, optional ergonomics:
- DropdownMenu triggerClassName cannot override the variant's radius or background without the `!` suffix. I used `rounded-full! bg-canvas/75!` for the cover-overlay menu; an 'overlay' trigger variant would be cleaner.
- Select's `className` width loses to its built-in `w-full`, so I used `w-44!`.

### Open issues

- Not verified against live Supabase, only against fakes:
- createSignedUploadUrl on genre-covers with the admin's user client;
- createSignedUrls batch signing of covers with the admin's client;
- Storage remove() on genre-covers with the admin's user client in removeGenreCoverAction and deleteGenreAction, which relies on the 'genre-covers: admin delete' policy.
- Drag and drop was verified only with synthetic events in the preview (HTML5 DragEvents and touch PointerEvents in Chrome), not on real touch devices, Safari or Firefox. The drag handle is a focusable div with role=button because Firefox does not start native drags on <button>. Mouse drags use HTML5 drag and drop; touch and pen use pointer capture on the handle.
- Design deviations, kept deliberately:
- The mock's 'Draft' status shows as 'Inactive'; the data model has no draft state for tracks.
- The existing sort feature is kept as a compact sort select in the count footer (not in the mock).
- An 'Add new uploads to' genre-chip picker is in the upload queue panel; without it new uploads would have no genre. It defaults to the ?genre filter.
- Track counts are shown on genre cards and in the editor.
- Genre chip and dot colours come from the shared hash (for example House and Balkan Hits share indigo in the fixtures), as noted in wave 1; pass `tone` explicitly if a fixed mapping is wanted.
- In the dev previews the no-op actions never change the props: reorder, activate/deactivate and covers persist locally, but saved name and metadata edits don't show in cards or rows. Uploaded tracks appear only in the queue, where Edit opens them.
- Orphaned cover objects remain possible when /complete is never called after an upload, as for the other upload kinds; a periodic cleanup job would close that gap.
- Bulk actions accept at most 200 track ids (a page holds 50).

## admin-businesses-v2

### Public API

ROUTES (all force-dynamic; every page, layout and action authorises itself with requireAdminPage/requireAdminAction; every DB read and write uses the admin's own RLS client)

The business pages share a route group, `src/app/admin/businesses/(directory)/`:
- `layout.tsx` renders BusinessesDirectory: PageHeading "Businesses" / "A personal station for every space." / "+ Add business", the list, and the page in the detail column. Because the list lives in the layout, its search and filter survive moving between venues. It also shows the "Access requests (N new)" count.
- `page.tsx` = /admin/businesses. Shows a placeholder panel on desktop and only the list on phones.
- `[businessId]/page.tsx` = the detail panel. `?tab=profile|access|announcements` picks the tab; `?created=1` shows a "was created" notice.
- `new/page.tsx` = /admin/businesses/new. `?fromRequest=<uuid>` prefills name, type, contact email and "<name> Radio".
- `loading.tsx` is a detail-column skeleton. `not-found.tsx` shows "This business doesn't exist" in the detail column while the list stays.
- Layout: on desktop (≥1024px) the list is on the left and the detail panel on the right is sticky and scrolls on its own. On smaller screens one column shows at a time: the selected detail or add form comes with an "All businesses" back link. List rows adapt to the list's own width (container queries), so on phones they become labelled cards.
- `/admin/businesses/requests?status=all|new|contacted|approved|declined` (page, loading, actions): the access-request list.
- `/admin/settings` (page, loading, actions): the integration status streams in through Suspense.
- `src/app/admin/not-found.tsx`: notFound() inside the admin area now keeps the admin shell.

STATUS RULE (decided and documented in src/components/admin/businesses/business-status.ts):
- **Inactive**: is_active is false.
- **Active**: the venue is active and at least one staff account has accepted its invitation (email confirmed and not blocked).
- **Invited**: the venue is active but nobody has accepted, or it has no staff account yet. The detail text then says "No staff account yet…".
- If the sign-in statuses can't be read (no secret key, or Auth unreachable), an active venue with members shows as Active with `verified:false` and a note above the list. It is never guessed as Invited.
- The list reads statuses with ONE Supabase Auth `listUsers` call (secret key), not one call per member.

SERVER ACTIONS

`src/app/admin/businesses/actions.ts`:
- createBusiness(prev: NewBusinessState, fd): Promise<NewBusinessState>
  - Validates with newBusinessSchema; the type is required and an invitation needs the contact email.
  - Inserts the business, with announcement_every_n_tracks taken from platform_settings (falls back to 4).
  - Stores the ticked exclusive genres with rpc set_business_genre_access.
  - Marks the fromRequest request approved, only while it is still open.
  - Invites the contact through the existing invite flow (email or link, rate limit invite:{admin}).
  - Returns `{created, link, warnings[]}` and never redirects. Anything that failed after the insert goes into `warnings`, so the business can't be created twice.
- saveBusinessProfile(prev, fd): one save for name, type, station, pronunciations, contact, language, is_active and genre access.
  - `shownGenreIds` protects genres the form did not show.
  - If the venue row saved but genre access failed, it returns ok:false with `saved:true`.
  - The message covers branding review and status changes.
- setBusinessActive(id, bool)
- removeBusinessLogo(id)
- sendBusinessPasswordReset(id): sends to every member (up to 10). The server picks a reset or a repeat invitation from each account's state.
- inviteMember(prev, fd)
- sendMemberAccess(id, userId, 'email'|'link')
- removeMember(id, userId)
- deleteBusiness(id, confirmation): now returns ok instead of redirecting. The client shows a toast and leaves the deleted venue.

`src/app/admin/businesses/requests/actions.ts`:
- updateAccessRequestStatus(requestId, expectedStatus, status)
  - Guarded with `.eq('status', expected)` so two admins can't overwrite each other.
  - Stamps handled_by and handled_at.
  - 23505 becomes a friendly "already an open request" message.
  - Reports "changed in the meantime" separately from "no longer exists".
- saveAccessRequestNotes(prev, fd): max 2000 characters, CRLF normalised, blank clears the notes.

`src/app/admin/settings/actions.ts`:
- savePlatformSettings(prev, fd): `update(...).eq('id', true)` with updated_by. A missing row gets an honest message. Revalidates /admin/settings, /privacy, /terms and /request-access.

COMPONENTS (props-driven; actions come in as props)
- `BusinessesDirectory {list, newRequestCount, basePath, announcementsPath, actions: BusinessDirectoryActions, accessUnavailableReason, children}`
- `BusinessList`
- `BusinessActionsProvider` and `useBusinessMenuItems`: the row and detail "…" menus (Open, Manage announcements, Activate/Deactivate, Send password reset, Delete). Each has a confirm dialog; delete requires typing the name.
- `BusinessDetailPanel {detail, actions: BusinessDetailActions, invitesUnavailableReason, genresHref, initialTab?, justCreated?, uploadLogo?}`, built from:
  - BusinessIdentity: logo upload/replace/remove, applied immediately.
  - BusinessProfileForm: keyed by updatedAt, toasts for results, confirms before deactivating.
  - GenreAccessTiles: tile checkboxes; genres available to all show as ticked and locked ("All venues").
  - BusinessAccessPanel and AccessLinkDialog.
  - BusinessAnnouncementsSummary: counts by placement, linking to /admin/announcements?business=<id>.
- `NewBusinessForm {action, genres, prefill, notices, defaultFrequency, invitesUnavailableReason, basePath, settingsHref, genresHref}`
- `AccessRequestsView {requests, counts, filter, truncated, basePath, requestsPath, actions}`
- `SettingsForm {settings, action, privacyHref, termsHref}` and `IntegrationStatusCard {items}`
- `unsaved-changes.tsx`: UnsavedChangesProvider, useFormChangeTracking, GuardedLink and GuardedButtonLink.
  - Unsaved edits get a confirm dialog for in-app navigation (rows, menus, Add business, Cancel, Manage genres/announcements) and the browser's own warning on unload.

DATA / VALIDATION
`data/admin/businesses.ts`:
- loadAdminBusinessList(supabase, {authUsers: AuthUserDirectory|null, authUnavailableReason?, now?}) → {items[status, statusDetail, statusVerified, businessType, memberEmails…], statusNote}
- loadAdminBusinessDetail(...) → now includes `.status` and `business.businessType`, plus onAirWelcome/onAirRotation
- Other additions: createAuthUserDirectory, isAcceptedAuthUser, countAcceptedMembers, loadGenreAccessChoices, toBusinessProfileUpdate, toBusinessType, and computeGenreAccessUpdate(…, shownIds?).
- buildAuthConfirmLink now uses next=/reset-password (AUTH_LINK_NEXT_PATH).
- Schemas moved out to validation/businesses.ts.

`data/admin/access-requests.ts`: loadAccessRequests, loadAccessRequest, countNewAccessRequests, markAccessRequestApproved, buildAccessRequest*Update, isOpenRequestConflict.

`data/admin/settings.ts`:
- loadPlatformSettings, loadDefaultAnnouncementFrequency (never throws), toPlatformSettingsUpdate
- loadIntegrationStatus(deps?) covers Supabase host, secret key present, site URL, ElevenLabs getSubscription (maxRetries 0, 8 s timeout; plan, status, credits and reset; errors explained without the key) and the SMTP/invite-link note.

Validation:
- businesses.ts: BUSINESS_TYPES, businessProfileSchema, newBusinessSchema and the moved schemas. businessCreateSchema.businessType is optional, and the insert stores "other" when it is missing.
- settings.ts: platformSettingsSchema, normalizeLongText, PLATFORM_SETTINGS_LIMITS
- access-requests.ts: status-change, notes and filter schemas
- invites.ts: inviteDeliverySchema

DEV PREVIEWS (no Supabase needed; no-op actions; simulated logo upload):
- `/dev/preview/businesses[/<id>|/new|/requests]` with `?tab=`, `?created=1`, `?fromRequest=1` and `?list=empty|error|nokey`. Fixtures are the design's venues: EmeraldBar, Hotel Aurora, Café Central, Restaurant Olive.
- `/dev/preview/settings?variant=configured|empty|missing`

### Cross-module requests

- docs owner (docs/ARCHITECTURE.md §7, docs/build-notes): please record the following. (a) /admin/businesses uses a route group, `(directory)`, whose layout holds the list; [businessId] and new render in its detail column, while /requests sits outside the group. (b) The Active/Invited/Inactive rule, as in business-status.ts; the list reads statuses with one secret-key auth.admin.listUsers call. (c) deleteBusiness no longer redirects. (d) Business Server Actions now live in src/app/admin/businesses/actions.ts, and [businessId]/actions.ts was removed. (e) Invite and recovery links now go to next=/reset-password. (f) New modules: data/admin/access-requests.ts, data/admin/settings.ts, validation/settings.ts, validation/access-requests.ts.
- src/lib/validation/index.ts (barrel owner, optional): add `export * from './settings'` and `export * from './access-requests'` if the barrel is meant to cover every validation module.
- scripts owner (scripts/lib/admin-invite.ts buildConfirmLink, scripts/tests, docs/SEEDING.md): switch next=/set-password to next=/reset-password, matching buildAuthConfirmLink.
- admin-announcements owner (/admin/announcements): the business menus and the detail panel link to `/admin/announcements?business=<id>`. Please keep that query parameter, and let breadcrumbs link back to /admin/businesses/<id>.
- venue help and inactive screens, and the /privacy and /terms owners: platform_settings.contact_email and contact_phone are now editable in /admin/settings, which normalises phone whitespace. Saving revalidates /privacy, /terms and /request-access.
- admin-shell owner (optional): in /dev/preview/* the Businesses sidebar item isn't highlighted, because AdminShell matches /admin/... paths only.

### Open issues

- Not run against live Supabase. Only fakes cover: auth.admin.listUsers paging (perPage 1000) for list statuses; the embedded selects `business_members ( user_id, profiles ( email ) )`, `handler:profiles!access_requests_handled_by_fkey ( email )` and `editor:profiles!platform_settings_updated_by_fkey ( email )`; `.in('status',[...])` combined with update; and 23505 on reopening a request.
- No real-browser interaction test (next dev and build not allowed). These still need a click-through in Chrome and Safari: the unsaved-changes confirm on row, menu and link navigation; beforeunload; the sticky detail column with its own scroll; the toast after save and the form re-mount; DropdownMenu-opened dialogs returning focus; the delete flow navigating away; the logo upload progress.
- The route-group layout assumes Next re-renders it after a Server Action with revalidatePath('/admin/businesses','layout'). This is documented behaviour but not verified at runtime.
- When sign-in statuses are unavailable, active venues with members show as Active with verified:false, and a note explains it above the list. An admin could prefer a separate 'Unknown' pill; the spec allows only three statuses.
- A status change made from the row menu while the Profile form has unsaved edits re-mounts the form (updatedAt changes), so those edits are lost without a prompt. This is rare, and the menu change itself is confirmed.
- sendBusinessPasswordReset reaches at most 10 staff accounts per call; a venue normally has one.

## admin-announcements-v2

### Public API

ROUTE /admin/announcements?business=<uuid>[&announcement=<uuid>] (src/app/admin/announcements/page.tsx; force-dynamic; requireAdminPage; metadata title "Announcements"). No `business` param ⇒ redirect to the first venue by name. No venues ⇒ EmptyState "Add a business first" with a link to /admin/businesses/new. Unknown or invalid venue ⇒ in-page "This venue could not be found" with links. `announcement` opens that recording in the editor: an on-air one opens as a new version, anything else is edited in place. Data: loadAnnouncementVenues + loadAnnouncementsPage with the admin's own client; ttsConfigured = isTtsConfigured(). The studio is keyed by business.id. loading.tsx is a skeleton with the final geometry.
LEGACY /admin/businesses/[businessId]/announcements ⇒ permanentRedirect('/admin/announcements?business=<id>'), or '/admin/announcements' for a non-uuid id.

SERVER ACTIONS (src/app/admin/announcements/actions.ts, 'use server'). Each calls requireAdminAction() first and reuses the existing mutations from @/lib/data/admin/announcements. When something was written it revalidates '/admin/announcements', '/admin/businesses/{id}' and '/admin/businesses'. A non-FormData payload returns an error ActionState.
- updateAnnouncementSettingsAction(businessId, prev: ActionState, fd{announcementEveryNTracks 1–50, announcementVolumePercent 10–100}): Promise<ActionState>
- createAnnouncementDraftAction(businessId, fd{mode template|custom, templateKey, customText, placement, language, spokenText}): Promise<StudioActionState> (includes announcementId)
- updateAnnouncementWordingAction(id, fd{text, spokenText?, placement, language}): Promise<ActionState>
- approveAnnouncementAction(id, version|null) and activateAnnouncementAction(id, version|null)
- deactivateAnnouncementAction(id)
- duplicateAnnouncementAction(id): Promise<StudioActionState> (includes announcementId)
- deleteAnnouncementAction(id)
- markAnnouncementFailedAction(id)

DATA (@/lib/data/admin/announcements, additive only)
- MutationOutcome.announcementId?: string, set by createAnnouncement and duplicateAnnouncement.
- loadAnnouncementVenues(supabase): Promise<AnnouncementVenueOption[]> where AnnouncementVenueOption = {id, name, stationName, isActive}, ordered by name then id. Throws AnnouncementsDataError.

PURE LIBS (client-safe)
- @/lib/announcements/spoken:
  - ANNOUNCEMENT_TEXT_MAX_LENGTH=500, SPOKEN_TEXT_MAX_LENGTH=1000, PRONUNCIATION_MAX_LENGTH=200
  - announcementTextCounter(text, business?): {count, max, over, label:'n/500'}. It counts the stored, trimmed, placeholder-rendered text.
  - brandingWithPronunciation(business, pronunciation): uses the saved station pronunciation only while the typed spelling equals the saved name spelling.
  - buildSpokenWording({text, business, pronunciation}): {ok:true, text, spoken, spokenText|null} | {ok:false, reason|null}. It never changes the venue record.
  - wordingProblems(wording, pronunciation?): {text?, pronunciation?}
- @/lib/announcements/labels:
  - RECORDING_PLACEMENT_LABELS and recordingLabel(p): rotation 'Station identity', welcome 'Welcome message', both 'Welcome & station identity'
  - PLACEMENT_CHOICES: Station identity / Welcome message / Both
  - placementTiming(p, everyNTracks)

COMPONENTS (src/components/admin/announcements)
- <AnnouncementStudio business: AnnouncementBusiness; announcements: AnnouncementItem[]; venues: VenueOption[] ({id,name,isActive}); serverNow: number; suggestedVoiceId: string|null; ttsConfigured: boolean; initialDraftId?: string|null; actions: AnnouncementStudioActions; api?: StudioApi (default DEFAULT_STUDIO_API); venueHref?: (id)=>string />. It renders the PageHeading (breadcrumb Businesses / {venue} / Announcements, title = station name, 'Your music. Their name.', VenueSelect) plus both columns.
- AnnouncementStudioActions = {updateSettings(prev, fd), createDraft(fd)→StudioActionState, updateWording(id, fd), approve(id, v), activate(id, v), deactivate(id), duplicate(id)→StudioActionState, remove(id), markFailed(id)}
- StudioApi = {loadTtsOptions({signal?, refresh?}), generate(id, GenerateAnnouncementRequest), previewUrl(id, signal?), uploadRecording({announcementId, file, signal, onPhase, onProgress})}
- AnnouncementAudioProvider, useAnnouncementAudio, useClipPlayback, ClipPlayButton, ClipPlayer: one shared <audio> element so only one preview plays at a time. Signed URLs are cached until shortly before expiry. The element is unlocked inside the click handler (WebKit).
- AudioPreviewCard (+ GenerationPhase, hasAudioPreview), RecordingsPanel (+ recordingAccessibleName), AnnouncementSettingsCard, VoiceFields / VoiceFieldsSkeleton, EditorFields (TemplatePicks, PlacementField, AnnouncementTextField, PronunciationField), InfoToggletip, RecordingDropzone (+ ANNOUNCEMENT_UPLOAD_LIMIT_LABEL from MAX_ANNOUNCEMENT_BYTES), VenueSelect (arrow keys only browse; Enter or blur commits), StudioNotices (TtsUnavailableCard, NeedsReviewBanner)
- studio-model.ts:
  - recordingState / RECORDING_STATE_PILLS: Active, Ready for review, Needs review, Inactive, Generating…, Generation stalled, Failed, Draft
  - recordingDetail, recordingArtwork, recordingPrimaryAction, recordingMenuActions, RECORDING_ACTION_LABELS, splitRecordings
  - PLAY_AFTER_PRESETS (1–12), playAfterLabel, isPlayAfterPreset
  - Editor state helpers: newEditorState, editorStateFromRecording(item, business, 'edit'|'copy'), initialEditorState, isEditorDirty, editorWording (keeps a saved custom spoken wording until the text or pronunciation changes), matchingTemplateKey, templateText, defaultTemplateKey, storedLanguageFor, wordingDiffers, generateProblems, editorErrorsFromAction
  - StudioActionState type
- studio-hooks.ts: useGenerationWatch (server-aligned clock; refreshes every 3 s while a recording is generating, capped at about 70 refreshes) and useTtsOptions.

BEHAVIOURS
- Generate preview: validates first (text, voice, model, a language the model lists, spoken length). It creates the draft, or updates the bound draft's wording only when it changed, then calls the existing generate route. The result is committed with router.refresh inside a transition, so the card keeps showing 'Generating…' until the new data arrives. A busy ref blocks double clicks. Errors show honestly with Retry; a reused result gets an info note.
- Regenerate sends force: true. Approve & activate is explicit (it uses Activate for approved but switched-off audio).
- Edit wording or Duplicate on an on-air recording creates a new version and never touches the live row. After approval the page offers 'Deactivate previous version'.
- Upload flow: checkUploadFile, then saves the draft wording, then the signed upload with progress and cancel, with a confirmation before replacing approved audio.
- Unsaved editor or settings changes are guarded both on venue switch (ConfirmDialog) and on beforeunload. Deleting always asks for confirmation. Focus goes to the success notice after approval and to the recordings heading after a delete.

DEV PREVIEW /dev/preview/announcements?tts=on|off|rejected&scenario=default|review|empty renders AdminShell plus the real studio with EmeraldBar fixtures. All actions are no-ops returning success, and the fake api uses the demo audio at /api/dev/audio/emeraldbar-*.

### Cross-module requests

- admin-businesses owner (src/app/admin/businesses/**): point 'Manage announcements' and the detail panel's Announcements tab at `/admin/announcements?business=${id}`. The old /admin/businesses/[id]/announcements now 308-redirects there. You can add `&announcement=<id>` to open one recording in the editor.
- admin-businesses owner (src/app/admin/businesses/[businessId]/actions.ts): updateBusinessDetails revalidates `${businessPath}/announcements`. It should revalidate '/admin/announcements' instead, so recordings flagged by a branding change show up there. tests/admin/businesses/actions.test.ts line ~196 expects the old path.
- overview/data owner (src/lib/data/admin/overview.ts businessAnnouncementsHref and tests/auth/admin-overview.test.ts): change the href to `/admin/announcements?business=${id}`, optionally with `&announcement=<id>` for the Review/Approve/Fix items. Alternatively delete the module, as ui-foundation already suggested.
- venue-ui owner (optional): for 'Your station voice' labels, recordingLabel(placement) from '@/lib/announcements/labels' returns Station identity / Welcome message / Welcome & station identity.
- docs owner (docs/ARCHITECTURE.md §6/§7, docs/build-notes/features-api.md 'admin-announcements'): please record these changes. (a) /admin/announcements?business=<id>[&announcement=<id>] replaces /admin/businesses/[id]/announcements, which now permanently redirects. (b) New modules: src/lib/announcements/spoken.ts (spoken wording, counter, limits), src/lib/announcements/labels.ts, src/components/admin/announcements/{AnnouncementStudio, studio-model, studio-api, studio-hooks, …}; the old dialog, manager and card components were removed. (c) createAnnouncement/duplicateAnnouncement now return MutationOutcome.announcementId, and loadAnnouncementVenues was added. (d) Studio actions revalidate /admin/announcements, /admin/businesses/{id} and /admin/businesses. (e) The pronunciation typed in the editor only shapes that announcement's spoken_text; it never updates businesses.name_pronunciation. (f) 'Edit wording' on an on-air recording creates a new version; the original keeps playing until the new one is approved, then the UI offers to deactivate it.
- ui-foundation owner (optional): FileDropzone could offer a compact horizontal layout (icon left of the text) like the screen-07 dropzone. Also, SEGMENTED_TAB_CLASSES uses shrink-0/px-4, so full-width segmented tabs need `[&>*]:px-2!` on phones; a built-in `fill` option would help.

### Open issues

- No next dev/build run, and no live Supabase or ElevenLabs. Client interactions were verified only by unit tests, SSR tests and code review, not clicked in a hydrated browser. That covers: tab switching, the generate → preview → approve flow, the shared audio player and Safari autoplay handling, the dropzone and upload progress, the DropdownMenu row actions, confirm dialogs, VenueSelect keyboard commit (Enter or blur), and the beforeunload warning. The static visual QA had no hydration.
- router.refresh() runs inside startTransition after generation or upload so the result appears together with the fresh server data. If the App Router does not hold the transition until the refreshed payload commits, the preview card may flicker briefly between 'Generating…' and the new audio.
- Generation stays synchronous (route maxDuration 60 s, as before). If the connection drops mid-request the editor shows the network error; the page then polls every 3 s, capped at about 70 refreshes, while the row is `generating`, so the final result still appears.
- Updating a draft's spoken wording discards its previous generated audio before regenerating (existing statusAfterWordingEdit rule). A failed regeneration of an edited draft therefore leaves it without audio. On-air recordings are never edited in place, so live audio is never at risk.
- At 320px wide the 'Generate voice | Upload recording' strip scrolls inside itself; both labels fit from about 360px up. The preview waveform is clipped rather than shrunk on narrow screens.
- Dev preview audio uses /api/dev/audio/emeraldbar-*, which needs `npm run demo:audio` (supabase/seed/audio/manifest.json). Without it the preview player shows its error message. Whether ElevenLabs preview_url voice samples can be fetched publicly is still unverified (research §14).
- The Browser pane was shared with another agent's QA session. I once navigated their tab (localhost:4623/radio-playing.html) by mistake and restored it immediately. My scratch QA server (port 4617, scratchpad only) ends with this session.

