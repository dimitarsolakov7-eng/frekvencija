# Review findings (verified)

Five-dimension review + adversarial verification, 2026-09-25. Only confirmed/uncertain findings need action.

## Resolution status (2026-10-06)

All confirmed findings are resolved, each with regression tests: SEC-01/02, PLAY-01–06, REQ-02 (Skip
music-only), ANN-01, UPL-01, GEN-01, NAV-01/A11Y-06 (admin unsaved-changes guard), BIZ-01/02, REQ-01
(admin: access-request messages) + A11Y-08, A11Y-01–05, A11Y-07, A11Y-09, A11Y-11–15, and the delivery
findings REQ-01 (docs/TESTING.md), REQ-03–REQ-07. REQ-08 and A11Y-10 were refuted by verification.
Known follow-ups (not blocking): PLAY-01 server-side identity header; focus target after an
access-request card disappears under a status filter; track editor Save still sends all fields.
Found later in live testing and fixed: the venue shell imported its link list from a "use client"
module, so every venue link was undefined on the real /radio page (guarded by
tests/ui/server-client-boundary.test.ts).

## security

### SEC-01 — safeNextPath lets dot-segment paths through as protocol-relative URLs, so login and email-link redirects can go to another site

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/lib/auth/redirects.ts:26`

**Description.** safeNextPath checks the raw candidate (it must start with '/', must not start with '//', no backslash, no control characters). It then resolves the candidate with `new URL(candidate, PROBE_ORIGIN)` and returns `${resolved.pathname}${search}${hash}`. The WHATWG parser removes dot segments. An input such as "/.//evil.example", "/%2e%2e//evil.example" or "/a/..//evil.example" passes every raw check, but its normalised pathname is "//evil.example". That string is returned as the 'safe' relative path, and a browser reads it as a protocol-relative URL. The origin check does not catch it because the probe URL's origin is unchanged. I confirmed with tsx: safeNextPath("/.//evil.example/phish") returns "//evil.example/phish". resolvePostLoginPath("/.//evil.example/phish","business_user") and resolvePostLoginPath("/%2e%2e//evil.example","platform_admin") both return "//evil.example…". parseConfirmParams({token_hash, type:'recovery', next:'/.//evil.example'}).next is "//evil.example". Three sinks receive the value: (1) src/app/(auth)/login/page.tsx:33, which redirects signed-in viewers, so Next sets `Location: //evil.example` (app-render sets the header to the redirect URL as given); (2) src/app/(auth)/login/actions.ts:84, which redirects after sign-in; Next sends `x-action-redirect: //evil.example`, the client's assignLocation turns it into https://evil.example, and isExternalURL triggers a hard navigation; (3) src/app/auth/confirm/actions.ts:60. The existing tests (tests/lib/platform/redirects.test.ts) cover '//x' and '/a/../admin' but not dot segments followed by '//'.

**Failure scenario.** An attacker sends venue staff or an admin the link https://frekvencija.online/login?next=/.//evil.example/login. A viewer who is already signed in gets a 307 straight to https://evil.example/login. A viewer who is signed out sees the real login page, enters real credentials, and after sign-in lands on evil.example, which can show a fake 'session expired, sign in again' form and collect the credentials. The same works through /?token_hash=…&next=/.//evil.example, which is forwarded to /auth/confirm.

**Verifier reasoning.** Confirmed for one sink (signed-in viewers on /login). The signed-out credential-capture path and the /auth/confirm path are refuted.

safeNextPath (src/lib/auth/redirects.ts:15-26) runs its raw checks and then returns the WHATWG-normalised pathname. It never checks whether that result starts with '//'. I ran the real modules with tsx:
- safeNextPath('/.//evil.example/phish') returns '//evil.example/phish'.
- '/%2e%2e//evil.example', '/a/..//evil.example' and '/%2e//evil.example' all return '//evil.example'.
- resolvePostLoginPath returns the same for both roles. The NEVER_AFTER_SIGN_IN and area checks in src/app/(auth)/_lib/redirects.ts:30-34 do not match '//evil.example/...'.
- parseConfirmParams also returns '//evil.example' as next.

Working sink: src/proxy.ts / proxy-rules.ts:107-109 let a signed-in user reach /login. At src/app/(auth)/login/page.tsx:33 the page calls redirect(resolvePostLoginPath(params.next, viewer.role)). Next 16.3.6 app-render.js:2390-2397 sets `location` to addPathPrefix(url, basePath). With an empty basePath that is the URL unchanged, so the response is `307 Location: //evil.example/login`. If the shell had already streamed, the client RedirectBoundary and meta refresh still resolve the URL against the page and navigate off-site.

The finding's other two sinks are not reachable by a victim:
- Sign-in action: login/page.tsx:35 puts the already-normalised '//evil.example/login' into the hidden field (LoginForm.tsx:23). signIn then calls resolvePostLoginPath(formData.get('next')) at actions.ts:70. safeNextPath rejects the value because it starts with '//', so the user goes to their home page. A signed-out victim who signs in is NOT sent to evil.example.
- Email links: auth/confirm/page.tsx:66/72 also puts the normalised value into the form. confirm/actions.ts:18-24 re-parses it, it is rejected, and the destination falls back to /reset-password or '/'.
- An attacker cannot POST the raw value from another site, because Server Actions check the Origin header.

What an attacker can really do: send https://frekvencija.online/login?next=/.//evil.example/login to venue staff or an admin. Their venue devices stay signed in for playback, and they are bounced straight to evil.example, which can show a fake 'session expired' login page. The existing redirect tests do not cover dot segments followed by '//'.

**Fix guidance.** In src/lib/auth/redirects.ts, after `new URL(candidate, PROBE_ORIGIN)` and the origin check, add `if (resolved.pathname.startsWith("//")) return fallback;`. Optionally also reject a normalised pathname that contains a backslash. This makes safeNextPath idempotent and never lets it return a protocol-relative value. Add regression cases to the redirects tests: safeNextPath('/.//evil.example'), '/%2e//evil.example', '/%2e%2e//evil.example' and '/a/..//evil.example' must all return the fallback, and resolvePostLoginPath with either role must return the role's home page. Also add a parseConfirmParams case where `next` is one of these values and the result is defaultConfirmDestination(type).

### SEC-02 — Per-IP rate limits trust the client-supplied first X-Forwarded-For hop, so every per-IP limit can be bypassed

- Verdict: **confirmed** (severity low, reviewer said medium)
- Location: `src/app/(auth)/_lib/request.ts:22`

**Description.** clientIpFromHeaders keys every per-IP limit on `x-forwarded-for.split(',',1)[0]`, the left-most hop. That covers access-request:ip (5/hour, the flood protection for the public form), login:ip (50/10 min), reset:ip (20/hour) and the venue account reset. The left-most hop is the value the client sent. docs/SETUP.md §11 says 'Any Node host that runs Next.js works … npm run build and npm start'. With `next start` exposed directly, Next only fills the header when it is missing (node_modules/next/dist/server/base-server.js:612, `req.headers['x-forwarded-for'] ??= socket.remoteAddress`), so a client-supplied value is kept. Common reverse proxies (for example nginx with $proxy_add_x_forwarded_for, or load balancers that append) also keep the client's value as the first hop. Only hosts that overwrite the header, such as Vercel, are safe. The limiter's comment says failing closed means an unavailable limiter 'cannot be used to flood the list', but the limit can be bypassed while the limiter is working.

**Failure scenario.** On a self-hosted `npm start` deployment, or behind an appending proxy, a script calls the public requestAccess Server Action in a loop. Each request sends `X-Forwarded-For: 10.<i>.<j>.<k>` and a new random email. Every call lands in a new access-request:ip bucket and a new email bucket, so the admin's access-request inbox (and rate_limit_buckets) fills without limit. In the same way, login password-spraying across many accounts is limited only by the per-email limit (10 per 10 min), and reset emails can be triggered for many addresses without an IP cap.

**Verifier reasoning.** The code does what the finding says, but whether it can be exploited depends on the hosting, so I lowered the severity.

What the code does: clientIpFromHeaders (src/app/(auth)/_lib/request.ts:20-26) keys limits on the left-most X-Forwarded-For hop, and tests/auth/request.test.ts:8 pins this on purpose. It is the only IP input for four limits:
- access-request:ip (src/app/(public)/request-access/actions.ts:80-87)
- login:ip (login/actions.ts:43-46)
- reset:ip (forgot-password/actions.ts:60)
- the venue account reset (src/app/(venue)/account/actions.ts:42)

Why it can be spoofed: in Next 16.3.6, base-server.js:612 only fills the header when it is missing (`req.headers['x-forwarded-for'] ??= socket.remoteAddress`). No other Next server file touches XFF. So with `next start` exposed directly, the client's value is used as-is. It is also used as-is behind appending proxies (nginx `$proxy_add_x_forwarded_for`, Cloudflare). docs/SETUP.md:212-216 endorses 'Any Node host … npm start' with no proxy or XFF guidance, and docs/research/elevenlabs.md:921 says hosting is still UNVERIFIED.

Impact on such a deployment: a script that sends a new XFF value and a new email on each call to requestAccess gets past both the IP limit (5/h) and the email limit (3/day). The honeypot check at actions.ts:70-75 is easy for a script to avoid. The admin's access-request inbox and rate_limit_buckets then grow without bound. The login and reset per-IP caps can be bypassed the same way.

Why low rather than medium:
- On Vercel, the host SETUP.md names as its example, the platform overwrites X-Forwarded-For, and the code is safe there.
- Per-email limits still apply: login 10 per 10 minutes, reset 5 per hour.
- Nothing is approved automatically, so the damage is inbox and storage spam plus weaker secondary brute-force limits, not account compromise.

**Fix guidance.** Derive the client IP from a trusted source.

1. Choose the header from the deployment:
   - On Vercel, prefer `x-vercel-forwarded-for` or `x-real-ip`.
   - Otherwise, read a TRUSTED_PROXY_HOPS env var (default 0 for direct `next start`). With N trusted proxies, take the (N)th hop from the RIGHT of X-Forwarded-For.
   - With 0 hops, use the last hop. Because Next only fills XFF when it is absent, that value is not trustworthy on a bare `next start` either. The safest option there is to require a reverse proxy that OVERWRITES the header, and to document that requirement.
2. Update tests/auth/request.test.ts to match the chosen rule.
3. In docs/SETUP.md §11, state that the proxy in front of the app must overwrite X-Forwarded-For (for example nginx `proxy_set_header X-Forwarded-For $remote_addr;`).
4. In src/app/(public)/request-access/actions.ts, add a global fail-closed cap that does not depend on client headers, for example a consumeRateLimit key `access-request:global` with max ~50 per hour, so the public form cannot be flooded even when the IP is spoofed or rotated.
5. Consider bucketing IPv6 addresses by /64.

## playback

### PLAY-01 — A tab left open keeps playing after the browser signs in as another venue, and then plays that venue's announcements under this venue's branding

- Verdict: **confirmed** (severity low, reviewer said medium)
- Location: `src/lib/player/engine.ts:553`

**Description.** The engine never checks that API responses belong to the venue it was built for (config.userId/businessId). All player calls use the same cookies (api-client.ts `credentials: "same-origin"`). GET /api/player/announcements and POST /api/media/sign read the business from whoever is signed in right now (ctx.business.id), and neither AnnouncementsResponse nor SignedMedia includes a businessId. refreshAnnouncementsIfStale() applies whatever list comes back: scheduler.setAnnouncements, setEveryNTracks and announcementGain. Nothing tells the other tabs about a sign-out either: there is no BroadcastChannel and no auth-state listener in src/lib/player or src/components/player. queuePreferences() also keeps saving this tab's genre, volume and mute through PUT /api/player/preferences, which writes to the session user.

**Failure scenario.** Take a shared laptop at a hotel group. Tab 1 is signed in as Venue A and playing House. In tab 2, staff sign out and sign in as Venue B, which also has House. Tab 1 keeps playing its current song. At the next transition it refreshes the lists after 60/120 s and now gets B's announcements and B's everyN and volume. The next station announcement is signed with B's session and plays "You're listening to Venue B Radio", while tab 1 still shows Venue A's name, logo and station-voice card. Volume or genre changes made in tab 1 overwrite B's saved preferences. This breaks "Never substitute another business's recording". Also, signing out in tab 2 does not stop audio in tab 1 until the current song ends.

**Verifier reasoning.** The code path is as described. GET /api/player/announcements (src/app/api/player/announcements/route.ts:21) calls loadAnnouncementPlayback(supabase, ctx.business.id), so the business always comes from the current cookie session. POST /api/media/sign looks announcements up with ctx.business.id (sign/route.ts:57). PUT /api/player/preferences writes for the session user (preferences/route.ts:30). None of the three responses carries a business or user id. The engine's refreshAnnouncementsIfStale (engine.ts:553-556) applies whatever comes back to setAnnouncements, setEveryNTracks and announcementGain, and never compares anything with config.businessId or config.userId. src/ has no BroadcastChannel, no storage-event and no onAuthStateChange listener, so a sign-out in another tab only reaches tab 1 as a 401 on its next request. Tab 1 makes requests only at about 5 s into each track (preload) and at transitions, which leaves a window of about 2-3 minutes per track. If a sign-in as B happens inside that window, tab 1 continues on B's session. PlayerProvider is keyed by user:business (layout.tsx), but that only helps after a server re-render, and a radio tab left open on /radio never re-renders. I lowered the severity to low. It needs two venue accounts in one browser profile, and nothing crosses a tenant boundary: the browser holding the cookies really is signed in as B, and the server still limits everything to B. The effect is a mismatch between the page's branding (A) and the audio (B), plus B's saved preferences being overwritten from tab 1.

**Fix guidance.** Add `businessId` to AnnouncementsResponse and SignedMedia, or return it in an `X-Business-Id` response header on every /api/player/* and /api/media/sign response, and have api-client parse it. In the engine, after each getAnnouncements, getGenreTracks and signMedia result, compare it with this.config.businessId. On a mismatch call enterFatal("auth_expired"), which already stops audio and releases the media elements, and do not apply the payload. Add a `businessId` field to the preferences PUT and have the route return 409 on a mismatch. In signOutOfVenue, post a message on a BroadcastChannel (for example "frekvencija-session"). In PlayerProvider, listen on that channel and call store.destroyEngine() and show the session-ended state.

### PLAY-02 — Skip works on the venue's announcements, and pressing Skip while a station announcement is loading plays a different announcement

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/lib/player/engine.ts:633`

**Description.** The handoff says "Skip applies to music only", but canSkip() (line 1588) turns Skip on for announcements, even in single-track genres where it is otherwise off. skip() (line 310) then cuts the clip and resets the counter. So the same Skip button, the N shortcut and the media-key next track can silence any branded clip. When the next item is an announcement that is still loading, the behaviour is also inconsistent: skip() sees current === null and calls startTransition("skip", null). acquireNext() checks `previousKind !== "announcement" && scheduler.isDue()`, and isDue() is still true because the counter only resets when an announcement ends or is skipped while current. So it draws and signs the next rotation clip. The engine's own comment ("a second Skip skips them too") does not hold for announcements, and a rotation pick is wasted.

**Failure scenario.** I confirmed this with a scratch test on the real engine: everyN=1, rotation clips r1 and r2. A track ends and the engine starts signing r1 (status loading, canSkip true). The user presses Skip. The engine signs r2 and plays r2 instead of music. With a single rotation clip, the same clip is loaded again, so Skip appears to do nothing. Separately, when an announcement is playing, Skip or the N key cuts it and resets the counter, so staff can skip every branded clip.

**Verifier reasoning.** design/CLAUDE-HANDOFF.md:102 says "Pause freezes the current music or announcement. Skip applies to music only". The contrast with Pause makes the rule clear: announcements should not be skippable. canSkip() (engine.ts:1578-1589) only disables Skip for single-track genres, and its `kind !== "announcement"` clause actually re-enables Skip during announcements even in a single-track genre. skip() (engine.ts:300-313) cuts the clip and calls finishAnnouncement, which resets the counter. The PlayerBar button, the N shortcut (RadioScreen.tsx:65-67) and the media-session nexttrack handler (engine.ts:1495) all go through canSkip and skip. Scratch test on the real engine: a playing r1 has canSkip true and Skip moves on to track a2. In a single-track genre, canSkip is false on the track and true on the announcement. Skip while an announcement is loading: with everyN=1 and no preload, the track ends, the engine signs r1 (status loading, canSkip true), the user presses Skip, and the engine signs and plays r2. With a preloaded r1 and a stale track list (the transition waiting on getGenreTracks), Skip plays r1 anyway, so Skip appears to do nothing. The reason is that skip() with current===null calls startTransition("skip", null), and acquireNext (engine.ts:633) sees isDue() still true. That contradicts the comment at engine.ts:576 ("a second Skip skips them too") and uses up an extra rotation pick.

**Fix guidance.** Record the kind of item a transition is loading: add a field such as `transitionKind: ItemKind | null`, set it in acquireNext when the welcome or a rotation clip is chosen, and clear it in startTransition and promote. Then write canSkip() as `if (this.current?.item?.kind === "announcement" || this.transitionKind === "announcement") return false; return !this.bag.isSingleTrack;`, which drops the announcement exception from the single-track clause. skip() already checks canSkip(), so the button, the N key and the nexttrack handler all follow. Also return early from skip() when current===null and the transition has not yet chosen its item (transitionKind===null and scheduler.isDue()), so a Skip during the list refresh does not re-draw the rotation. Add engine tests for Skip during a playing announcement and during a loading announcement.

### PLAY-03 — The same station clip plays twice in a row after a genre change drops the preloaded announcement

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/lib/player/engine.ts:1139`

**Description.** preloadNext() takes the next rotation clip with scheduler.nextRotation() when it preloads, which removes it from the rotation bag. That pick is lost whenever the preload is thrown away: beginSession() unloads every non-current slot on a genre change (line 414), allocateSlot() can reclaim the announcement slot, and a preload media error drops it. The bag's rule against repeats (ShuffleBag.fixPlanStart / lastId) compares with the last clip taken from the bag, not the last clip actually played. So after a dropped pick, the next cycle can start with the clip that just played.

**Failure scenario.** I confirmed this with a scratch test in 12 of 12 random seeds: everyN=1, clips r1 and r2. r1 plays. During the next song the engine preloads r2. The venue changes genre, which drops r2. The next announcement is r1 again ("r1 -> r1", or "r2 -> r2" for other seeds). With the default everyN=4, this happens whenever the genre is changed during the song before an announcement (the preload starts 5 s into it). This breaks the rotation requirement and the scheduler's own "never the same one twice in a row when ≥ 2 exist" rule. The same root cause affects tracks: a track picked by a dropped or superseded preload or transition at a cycle boundary lets the track that just played start the next cycle.

**Verifier reasoning.** preloadNext (engine.ts:1138-1140) calls scheduler.nextRotation(), which takes the id out of the rotation ShuffleBag (shuffle.ts:103-109 sets lastId). beginSession unloads every non-current slot (engine.ts:414), and so do allocateSlot's reclaim (engine.ts:1236), a preload media error (engine.ts:1019-1021) and enterFatal/releaseAllMedia. None of them returns the pick to the bag. ShuffleBag.fixPlanStart (shuffle.ts:152-158) only keeps the next cycle from starting with the last id taken, not the last id played. With 2 clips the bag strictly alternates X,Y,X,Y, so dropping one Y always gives X,X. My scratch run with 12 seeds gave the same clip twice in all 12 (r1->r1 or r2->r2): start, the announcement plays, a track plays, the preload at 6 s takes the other clip, then selectGenre("g2") and the next announcement. This goes against the build prompt ("Rotate the business's approved recordings to avoid repeating the same wording unnecessarily") and the scheduler's own doc comment (announcements.ts:108). It only happens after a genre change (or a reclaim or error) during the song before an announcement, and the only effect is a repeated clip, so low is the right severity.

**Fix guidance.** Do not take a clip from the bag during preload. Add `peekRotation()` to AnnouncementScheduler (using `rotation.peek(1)`), use it in preloadNext, and call `nextRotation()` only when loadRotationAnnouncement claims the preloaded slot, checking that the id is the same and dropping the preload if it is not. Alternatively, add `ShuffleBag.putBack(id)`, which unshifts the id onto `remaining` and restores the previous lastId, plus `AnnouncementScheduler.returnRotation(id)`. Call it from unloadSlot whenever a slot with role nextAnnouncement is unloaded without having played. Add a regression test: 2 clips, genre change after the preload, and the next announcement must be the other clip.

### PLAY-04 — The welcome is lost for the whole session if the genre changes, or a request fails, while it is loading

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/lib/player/engine.ts:625`

**Description.** acquireNext() sets `welcomeConsidered = true` before it awaits signing and loading the welcome. The clip is only marked as played on its `playing` event. If that transition is cancelled, the new session's "start" transition skips the welcome, and it never plays for the rest of the engine's life. This happens on a genre change (beginSession → stopWork), on a network or 5xx error while signing (loadAnnouncement returns null), or when the welcome was promoted while paused and then the genre changed. The same thing happens if GET /api/player/announcements fails once at session start: the list is empty when the welcome is checked.

**Failure scenario.** I confirmed this with a scratch test: welcome w1 plus two genres. The user presses Start Radio and, while w1 is still being signed, clicks another genre card (for example, they meant a different genre). Result: track b1 plays, the welcome-played flag is still null, and the welcome never plays in this session. This contradicts "On the first explicit Start Radio action of a session, play one approved welcome announcement if available".

**Verifier reasoning.** acquireNext sets `welcomeConsidered = true` (engine.ts:625) before it awaits loadAnnouncement. The flag is never reset, and markWelcomePlayed only runs on the `playing` event (engine.ts:892) or on a skip. Both a genre change (beginSession, then stopWork) and a retry start a new "start" transition, and that transition skips the welcome block. Scratch test: welcome w1, Start, selectGenre("g2") while w1 is still signing. Result: b1 plays, the welcome key is still null, and the next tracks are b2, b3, b1 with no welcome. Second scratch test: getAnnouncements fails once at session start. The error is swallowed (engine.ts:548-550), the list is empty when the welcome is checked, and after the list loads later only rotation r1 ever plays, never w1. docs/build-notes/foundation-api.md:189 already lists "fails or is skipped before starting" as a known limitation. The genre-change, paused-then-genre-change and list-fetch-failure paths are not documented, and they contradict FUNCTIONAL-BUILD-PROMPT.md:72. The window is short (the time to sign and buffer one clip), or needs a transient error, so low.

**Fix guidance.** Set welcomeConsidered only when the matter is settled: when the welcome starts (markPlaying for an isWelcome item), when the user skips it, when signing returns ineligible (isIneligible, which already calls markFailed), or when the storage key shows it has played. In acquireNext, gate on `reason === "start" && !this.welcomeConsidered` as now, but leave the flag false if the transition is superseded (!alive()) or loadAnnouncement returns null because of a transient error. Also skip setting it when getAnnouncements failed at session start (have refreshAnnouncementsIfStale report success, and leave welcomeConsidered false while announcementsLoadedAt is still -Infinity). Add tests for a genre change during welcome signing and for an announcements fetch that fails once at start.

### PLAY-05 — An old "Preview finished. The radio is paused." panel comes back every time the radio stops later

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/player/use-voice-preview.ts:93`

**Description.** The reset during render only fires while the preview is loading or playing (isVoicePreviewActive). If the preview has already reached "finished" or "failed" and the radio is restarted from another control (the player bar's Play, Space, a genre's Play button, a media key), the reducer stays in finished/failed. describeVoicePreview() hides that state only while radioActive is true (voice-preview.ts:98). As soon as the radio is no longer active, the panel comes back. Only the reducer is tested; the hook itself has no tests.

**Failure scenario.** The radio is playing. The user presses Preview and the clip finishes, so the card offers "Resume radio". Instead, the user presses Play on the player bar and the radio plays, so the card looks idle. Later the user pauses, a phone call pauses the audio, or a network error happens. The station-voice card shows "Preview finished. The radio is paused." again, with Resume radio and Close buttons, and its role="status" region announces it again, even though no preview happened. During a network error this message is also wrong.

**Verifier reasoning.** use-voice-preview.ts:93 dispatches radio-resumed only while isVoicePreviewActive(state), that is in the loading or playing phase. When the phase is already "finished" or "failed" and the radio is restarted from the PlayerBar, Space, a genre Play button or a media key, the reducer stays in finished/failed. describeVoicePreview (voice-preview.ts:98) hides that state only while radioActive is true, and isAudioActive covers playing, buffering and loading (player-view.ts:109-111). Scratch test with the real reducer and describe function: start (radioWasPlaying true), playing, ended, then radioActive true gives view mode idle. Once radioActive is false again (pause, an external pause, or an error status) the view is {mode:'done', offerResume:true, status:'Preview finished. The radio is paused.'}, so the old panel, its Resume and Close buttons and the role=status announcement come back. RadioScreen stays mounted the whole time on /radio. The hook itself has no test (only voice-preview.test.ts covers the reducer).

**Fix guidance.** In use-voice-preview.ts:93, change the condition to `if (options.radioActive && state.phase !== "idle") dispatch({ type: "radio-resumed" });`. This is safe because start() calls commands.pause() synchronously before it dispatches "start", so the render that follows already sees radioActive === false. Add a hook-level test, or a reducer-plus-describe test that runs the finished, radio-active, radio-paused sequence, and check that the view is idle.

### PLAY-06 — destroy() clears the welcome-played flag on every unmount, not only on logout, so the welcome plays again in the same signed-in session

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/lib/player/engine.ts:395`

**Description.** destroy() always calls scheduler.clearWelcome(). ARCHITECTURE §9 says the welcome plays once per browser session and the key is "cleared on logout", and logout already clears it with clearPlayerSessionState() in signOutOfVenue. But PlayerProvider also destroys the engine whenever the (venue) layout unmounts for any other reason, and then the welcome key is removed too.

**Failure scenario.** On /account the user clicks "Change password now", a next/link to /reset-password in the (auth) group. PlayerProvider unmounts and engine.destroy() removes the welcome key from sessionStorage. The user saves the new password, returns to /radio in the same tab and presses Start Radio. The welcome plays a second time in the same signed-in browser session. Dev StrictMode and Fast Refresh remounts also clear it.

**Verifier reasoning.** destroy() always calls scheduler.clearWelcome() (engine.ts:395). PlayerProvider calls engine.destroy() in its effect cleanup whenever the (venue) layout unmounts (PlayerProvider.tsx:111-117). AccountView's "Change password now" is a ButtonLink to /reset-password (account/page.tsx:38, AccountView.tsx:144), which is in the (auth) route group, so following it unmounts the provider. After the password is saved, the reset-password action redirects to homePathForRole, which is /radio (actions.ts:62), in the same tab and the same sessionStorage. A new engine is built there, and the next Start Radio plays the welcome again. Scratch test: after start the welcome key is "1", and after destroy() it is null. Logout already clears every radio-player: key through clearPlayerSessionState() in signOutOfVenue (PlayerProvider.tsx:81, browser.ts:45-56), so the clear in destroy() is not needed there. It breaks "welcome once per browser session … cleared on logout" (ARCHITECTURE §9). Low, because the only effect is one repeated welcome after leaving the venue area.

**Fix guidance.** Remove `this.scheduler.clearWelcome()` from destroy() at engine.ts:395 and rely on clearPlayerSessionState() in signOutOfVenue for logout. Reword ARCHITECTURE.md §9 ("Logout: destroy() stops audio…; clearPlayerSessionState() clears welcome keys") to match. Add an engine test showing that destroy() keeps the welcome key and that a new engine with the same storage does not replay the welcome.

## admin

### ANN-01 — Uploading from the announcement studio wipes spoken_text and deletes existing TTS audio before the new MP3 is checked

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/lib/data/admin/announcements.ts:388`

**Description.** updateAnnouncementWording builds its input with `spokenText: text(raw, "spokenText")`, and text() turns a missing key into "". nullableText then maps "" to null, so `input.spokenText` is null, not undefined. The check at line 411 (`input.spokenText === undefined ? row.spoken_text : …`) therefore never keeps the stored value, and every save that leaves the field out clears spoken_text. This goes against the schema's own rule ("Update: omitted fields are unchanged"). The studio relies on that rule: ensureDraft("upload") (AnnouncementStudio.tsx:334) deliberately sends only text/placement/language. Once spoken_text is null, statusAfterWordingEdit sees the spoken wording as changed. For a TTS recording it then applies CLEARED_AUDIO_FIELDS, sets status to draft and removes the Storage object. All of this happens inside ensureDraft, before the MP3 is signed, uploaded or validated. I reproduced it with the repo's FakeSupabase: a placement-only change without spokenText on READY_TTS_ID gave status=draft, audio_path=null, spoken_text=null and a storage remove event.

**Failure scenario.** Venue EmeraldBar has name pronunciation "Emerald Bar", so its generated recording has spoken_text "Welcome to Emerald Bar…". It is Ready (or approved but switched off). The admin opens it in the editor, which lands on the Generate tab, changes placement from Welcome to Both, and drops an MP3 into "Upload your own recording". The server clears spoken_text and deletes the generated audio. If the MP3 is then rejected as invalid, or the admin presses Cancel, the recording is left as a draft with no audio, and any approval is gone. Even when the upload succeeds, the respelling is lost, so a later row "Retry" (which reads item.spokenText) speaks "EmeraldBar" as written.

**Verifier reasoning.** src/lib/data/admin/announcements.ts:218-221 text() returns "" for a missing key. At :388 spokenText=text(raw,"spokenText") passes "" to nullableText (src/lib/validation/fields.ts:33, emptyToNull), which returns null, never undefined. So the `input.spokenText === undefined ? row.spoken_text` branch at :411 is dead for form input. This contradicts the schema comment "Update: omitted fields are unchanged" (src/lib/validation/announcements.ts:39). The studio relies on omission: AnnouncementStudio.tsx:334 sets spokenText only when purpose==="generate", and wordingDiffers(..., false) (studio-model.ts:379) calls the update when only text, placement or language changed. statusAfterWordingEdit (state.ts:225-248) then sees spokenWording change from "Welcome to Emerald Bar…" to the text. For source tts it returns draft + audioInvalidated, the patch applies CLEARED_AUDIO_FIELDS, and removeAudioObject deletes the MP3. All of this runs inside ensureDraft (AnnouncementStudio.tsx:497), before api.uploadRecording validates anything. The upload-complete route (uploads/complete/route.ts:289-337) was written to delete the old audio only after the new file validated, and this pre-step defeats that. I reproduced it with the repo's FakeSupabase and seedWorld (READY_TTS_ID: status ready, spoken_text "Welcome to Emerald Bar. Enjoy the music."). I sent form {text (unchanged), placement:"both", language:"en"} with no spokenText. Result: ok, message "generated audio was removed", row status=draft, spoken_text=null, audio_path=null. Events: db:user:update:announcements then storage:admin:remove:announcements/…/aaaa….mp3. The upload route never clears spoken_text, which confirms the respelling is meant to survive an upload.

**Fix guidance.** In updateAnnouncementWording, build values only from keys that are present, e.g. `spokenText: formData.has("spokenText") ? text(raw, "spokenText") : undefined` (same for text/placement/language). Pass undefined to the schema so `.optional()` keeps it undefined, and line 411 then keeps row.spoken_text. Keep the echoed `values` record as strings, using ?? "" for display only. Add a mutations test: placement-only edit of READY_TTS_ID without spokenText keeps status ready, audio_path and spoken_text, and removes no storage object.

### UPL-01 — Leaving /admin/music mid-batch cancels the files in flight but silently keeps uploading the queued ones

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/lib/uploads/queue.ts:168`

**Description.** useUploadQueue calls queue.abortAll() when MusicLibrary unmounts. abortAll only aborts the jobs that currently have a controller. Each aborted job's `.finally()` (line 251-253) then calls pump(), which starts the next 'queued' items with fresh, un-aborted controllers. So after the page is gone, the rest of the queue keeps signing, uploading and creating tracks with no UI, while the first files are marked cancelled. Leaving via the admin sidebar (client-side next/link) shows no warning: the busy warning is only a beforeunload handler, which does not fire on in-app navigation. I confirmed with the real UploadQueue: add 4 files, call abortAll, flush → a/b 'cancelled', c/d 'signing' (runner called 4 times).

**Failure scenario.** The admin selects 10 MP3s in Music library and, while two are uploading, clicks "Genres" in the sidebar to create a genre. Files 1-2 are cancelled; files 3-10 upload invisibly in the background and appear in the catalogue later. When the admin returns, the queue panel is empty. Re-adding the batch creates duplicate tracks for files 3-10.

**Verifier reasoning.** src/lib/uploads/use-upload-queue.ts:46 calls queue.abortAll() on unmount. abortAll (queue.ts:168-170) only aborts jobs whose controller is set, i.e. in flight. Each aborted run's .finally (queue.ts:251-254) calls this.pump(), which starts the remaining 'queued' items with fresh AbortControllers (start(), :201-205), and nothing aborts those. This contradicts the hook's documented contract ("Transfers still in flight are aborted when the component unmounts"). MusicLibrary is rendered by src/app/admin/music/page.tsx:80, not the layout, and next.config has no cacheComponents/Activity, so a sidebar navigation (plain next/link in ShellNavLink.tsx) really unmounts it. beforeunload (use-upload-queue.ts:48-53) does not fire on client navigation. I ran a throwaway test with the real UploadQueue and a controllable runner: add a..d, abortAll, flush. Result: a:cancelled, b:cancelled, c:signing, d:signing, runner called 4 times. The complete route has no content-level dedup (paths are unique per sign), so re-adding the batch creates duplicate tracks.

**Fix guidance.** Add a disposed/aborting mode to UploadQueue. Make abortAll() mark every 'queued' item 'cancelled' (or set a `stopped` flag that pump() checks and returns early on), then abort the in-flight controllers. For Strict Mode (the effect cleanup runs on mount), either reset the flag on add() or let the hook's effect setup clear it (e.g. `useEffect(() => { queue.resume(); return () => queue.abortAll(); }, [queue])`). Add a queue test: 4 files, abortAll → all 4 cancelled and runner called only twice. Optionally register queue.busy with an in-app navigation guard (see NAV-01).

### GEN-01 — Genre editor Save silently re-activates a genre that was just deactivated while the form had unsaved edits

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/admin/catalog/GenreManager.tsx:169`

**Description.** The genre draft includes isEnabled (the Status switch), and genreDraftFormData always sends it (genre-draft.ts:85). The "Deactivate genre"/"Activate genre" button, and the card menu, change is_enabled right away through setGenreEnabledAction. When that happens while the draft is dirty, the resync branch at line 169 only updates `editor.syncKey`. Neither values.isEnabled nor baseline.isEnabled is rebased, so both keep the old value. The panel then shows Status "Active" while the button below says "Activate genre". Pressing Save sends isEnabled=true and saveGenreAction writes is_enabled=true. Pressing Discard instead restores the stale baseline, and because syncKey already matches, the draft never rebases. The stale flag stays and is written on the next save.

**Failure scenario.** The admin edits the description of "Jazz" (unsaved), clicks "Deactivate genre" and confirms (venues lose Jazz). Then they click "Save changes" to keep the description. The action patches is_enabled=true and Jazz is available to venues again without any notice.

**Verifier reasoning.** The draft carries isEnabled (genre-draft.ts:23,50), and genreDraftFormData always sends it (genre-draft.ts:85). saveGenreAction → genrePatch writes is_enabled whenever it is defined (src/app/admin/genres/actions.ts:180-188, 224-245). Deactivate confirm calls setEnabled(confirmGenre,false) (GenreManager.tsx:660), which applies an optimistic/confirmed isEnabled=false to items. editedGenre therefore changes, and targetSync = syncKey(editedGenre) (it includes isEnabled, :98-100) differs. When the draft is dirty, :169 only updates editor.syncKey. values.isEnabled and baseline.isEnabled stay true. The Save button is enabled (dirty) and sends isEnabled=true, re-enabling the genre. The Status switch shows "Active" (GenreEditor.tsx:182-186) while the button below says "Activate genre" (:267). Discard (GenreManager.tsx:335-338) sets values=baseline (stale true), the draft is then clean, and the syncKey already matches, so no rebase happens and the stale flag goes out on the next save. No guard blocks the toggle while dirty (GenreEditor.tsx:258-268 only disables while saving).

**Fix guidance.** In the resync branch at GenreManager.tsx:166-170, when the draft is dirty and editedGenre.isEnabled differs from editor.baseline.isEnabled, rebase that field: `setEditor({ ...editor, syncKey: targetSync, baseline: { ...editor.baseline, isEnabled: editedGenre.isEnabled }, values: editor.values.isEnabled === editor.baseline.isEnabled ? { ...editor.values, isEnabled: editedGenre.isEnabled } : editor.values })`. Better still, only send isEnabled from genreDraftFormData when it differs from the baseline, or drop it from the saved draft because a dedicated toggle exists.

### NAV-01 — Admin sidebar navigation discards unsaved edits in the music, genre, announcement and settings editors without warning

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/catalog/MusicLibrary.tsx:206`

**Description.** MusicLibrary ("Leaving the page with unsaved track edits asks first"), GenreManager (199-204), AnnouncementStudio (222-229) and SettingsForm protect unsaved work only with a beforeunload listener. The admin sidebar (AdminShell.tsx:55 → ShellNavLink → next/link) navigates client-side, so beforeunload never fires. None of these pages sits inside UnsavedChangesProvider, and the sidebar links are not GuardedLinks. The handoff asks to "Warn before discarding unsaved edits when appropriate".

**Failure scenario.** The admin edits a track's title and genres in "Selected track" (Save not pressed) and clicks "Businesses" in the sidebar. The page changes immediately and the edits are gone. The same happens with unsaved announcement wording in the studio or genre edits.

**Verifier reasoning.** The admin sidebar is AdminShell.tsx → SidebarNav → ShellNavLink.tsx, a plain next/link with no onClick guard. UnsavedChangesProvider exists only inside BusinessesDirectory.tsx:59 and SettingsForm.tsx:227, and the sidebar is outside both, so even those pages' guards don't cover it. MusicLibrary.tsx:206-212, GenreManager.tsx:199-204 and AnnouncementStudio.tsx:222-229 use only beforeunload listeners, which do not fire on client-side App Router navigation. There is no global click or popstate interceptor (grep found none). The handoff requirement is design/CLAUDE-HANDOFF.md:156 "Warn before discarding unsaved edits when appropriate." Unsaved track, genre, announcement and settings edits are therefore lost silently when the admin clicks another sidebar item.

**Fix guidance.** Move UnsavedChangesProvider up into AdminShell (or src/app/admin/layout.tsx) so every admin page shares one provider. Have MusicLibrary, GenreManager, AnnouncementStudio and the upload queue report their dirty or busy state via guard.setDirty(source, dirty) in effects, with cleanup on unmount. Give ShellNavLink (or an admin-specific variant) an onClick that calls guard.guardLinkClick(event, href). Drop the now-redundant nested providers in BusinessesDirectory and SettingsForm, or make them reuse the outer context.

### BIZ-01 — Business profile form is re-keyed on updatedAt, so a logo change or activation toggle throws away unsaved profile edits

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/businesses/BusinessDetailPanel.tsx:93`

**Description.** BusinessProfileForm is keyed by `${business.id}:${business.updatedAt}`. Uploading or removing the logo (BusinessIdentity.tsx:107 router.refresh / removeBusinessLogo) and activating/deactivating from the panel's menu all update the businesses row, which bumps updated_at. The detail page re-renders and the form remounts with the database values. The old instance's unmount cleanup clears its unsaved-changes registration, so no warning appears either.

**Failure scenario.** The admin types a new station name and pronunciation on the Profile tab (not saved), then uploads a logo in the identity block above. When the upload finishes, the form remounts and the typed station name and pronunciation are gone without notice.

**Verifier reasoning.** BusinessDetailPanel.tsx:93 keys BusinessProfileForm by `${business.id}:${business.updatedAt}` (updatedAt = row.updated_at, businesses.ts:270). businesses has a set_updated_at trigger (core_schema.sql:203). A logo upload updates businesses.logo_path (uploads/complete/route.ts:366) and BusinessIdentity.tsx:107 then calls router.refresh(). Activate/Deactivate (BusinessActionDialogs.tsx confirmStatus → setBusinessActive) also updates the row. Either bumps updated_at, the key changes, and the form remounts. Its inputs are uncontrolled defaultValue fields (BusinessProfileForm.tsx:136,161,220), so they reset to the DB values. useFormChangeTracking's unmount cleanup (unsaved-changes.tsx: `useEffect(() => () => guard.setDirty(source,false))`) clears the dirty registration, so nothing warns. Neither the logo upload nor the status dialog checks guard.hasUnsavedChanges().

**Fix guidance.** Key the form on business.id only. After a successful save, the form already calls markSaved(). If server-normalised values must be shown after save, bump a local `formKey` counter in the save success handler instead of using updatedAt. Alternatively, re-key on updatedAt only when useFormChangeTracking reports not dirty.

### BIZ-02 — Business detail Announcements tab counts deactivated approved clips as 'Ready for review' and misses flagged non-active clips

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/lib/data/admin/businesses.ts:108`

**Description.** summarizeAnnouncements sets `awaitingApproval: byStatus.ready`, which includes 'ready' rows that are still approved (switched off with Deactivate). BusinessAnnouncementsSummary labels that count "Ready for review – Audio ready, not approved yet". needsReview is only counted for status 'active' (line 93), so flagged ready/draft rows are never reported as needing review. The announcements page's summary (rules.ts summarizeAnnouncements) excludes approvedAt from awaitingApproval and counts every flagged item, so the two admin screens show different numbers for the same venue.

**Failure scenario.** A venue has 2 approved recordings that the admin deactivated, plus 1 ready recording flagged after a rename. The business detail tab shows "Ready for review: 3" and "Need review: 0". The announcements studio shows 0 awaiting approval and 1 needing review.

**Verifier reasoning.** summarizeAnnouncements in src/lib/data/admin/businesses.ts:82-111 counts needsReview only for status 'active' (:93-94), and sets awaitingApproval = byStatus.ready (:107). toSummaryRow (:113-124) does not select approved_at at all. deactivateAnnouncement sets status 'ready' while keeping approved_at (announcements.ts ~557, and the test "deactivates (keeping the approval)"). BusinessAnnouncementsSummary.tsx:42 labels the count "Ready for review" / "Audio ready, not approved yet", which is false for switched-off approved clips. The branding trigger (core_schema.sql:313-326) flags every announcement of the venue, including ready/draft rows, but this summary never counts flagged non-active rows. The studio's summarizeAnnouncements (components/admin/announcements/rules.ts:268-276) counts `ready && !approvedAt && !flagged` as awaiting approval and every flagged item as needs review, so the two admin screens disagree for the same venue. Example: 2 approved-then-deactivated clips give Business tab "Ready for review: 2" and studio "awaiting approval: 0".

**Fix guidance.** Select approved_at in the business-detail announcement query and add approvedAt to AnnouncementSummaryRow. Mirror rules.ts: flagged = needs_review || (approved_at !== null && branding_version !== business.branding_version); needsReview += flagged for any status; awaitingApproval counts status==='ready' && approved_at===null && !flagged; optionally add a separate 'switchedOff' count for ready && approved && !flagged. Better, share one pure summariser between both screens.

### REQ-01 — Access-request status conflict message is never shown because the card remounts

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/businesses/AccessRequestsView.tsx:266`

**Description.** RequestCard is keyed by `${request.id}:${request.updatedAt}` and keeps its error in local state. When updateAccessRequestStatus finds that the row no longer has the expected status (another admin changed it), it calls revalidateBusinesses() and returns "Someone changed this request in the meantime…" (requests/actions.ts:59). The refreshed payload carries the new updated_at, so the card remounts with error=null and the message is lost. Status failures are not toasted either. Any unsaved text in the card's notes textarea is also dropped by the remount.

**Failure scenario.** Two admins handle the same request. Admin B marks it Contacted; admin A, looking at a stale 'New' card, clicks Decline. A's click is rejected, but A sees no error, only the card quietly switching to 'Contacted', and any notes A was typing disappear.

**Verifier reasoning.** AccessRequestsView.tsx:266 keys RequestCard by `${request.id}:${request.updatedAt}` (updatedAt = row.updated_at, access-requests.ts:62). access_requests has a set_updated_at trigger (frekvencija.sql:82). When the expected status no longer matches, updateAccessRequestStatus (requests/actions.ts:56-61) calls revalidateBusinesses() → revalidatePath('/admin/businesses','layout'), and the action response carries the fresh tree. The other admin's change produces a new updatedAt (or, under a status filter, drops the card from the list), so the card remounts or unmounts. The error set via setError at AccessRequestsView.tsx:144 lives in the old instance's local state and is never shown. The failure path shows no toast (only success toasts at :143). The NotesForm textarea is uncontrolled (defaultValue, :113) inside the card, so any unsaved typed notes also reset on remount.

**Fix guidance.** Report status-change failures with toast.error("Couldn't update the request", { description: result.message }), which survives remounts, instead of (or in addition to) the card-local Alert. Key RequestCard by request.id only. The status pill and actions already read from props, and NotesForm can be keyed by request.adminNotes if the saved notes must refresh.

## requirements

### REQ-01 — Required test/verification record (docs/TESTING.md) is missing; ARCHITECTURE points to a file that does not exist

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `docs/ARCHITECTURE.md:590`

**Description.** FUNCTIONAL-BUILD-PROMPT §8 says: "Document browser playback checks and distinguish checks actually run from checks still needing real credentials or manual validation." ARCHITECTURE §12 (line 590) says `docs/TESTING.md` lists which checks ran and which still need real credentials or manual browser validation, but docs/ contains only ARCHITECTURE.md, REDESIGN.md, SEEDING.md, SETUP.md, build-notes/ and research/. The only record is spread over internal build notes (for example features-api.md:138, redesign-wave1.md:370, redesign-wave2.md:91-98 and 337-338), written as agent hand-off notes. They say no real-browser check was run, and some are out of date ("next build was not run" contradicts the current state). No deliverable document lists the acceptance flows ("Prove these flows work") with a status for each. ARCHITECTURE §7 (lines 452-457) is also stale: it says `/` redirects by role and `/set-password` is the password page, but `/` is now the public homepage and `/set-password` is a 308 redirect to `/reset-password`.

**Failure scenario.** The owner follows the delivery checklist and looks for the documented split between checks already run and checks still needing Supabase, ElevenLabs or a real browser. The file named in ARCHITECTURE §12 does not exist. The owner cannot tell which of the 7 acceptance flows were verified end to end (none were run against live Supabase or in a real browser) without digging through internal build notes.

**Verifier reasoning.** `ls docs` shows only ARCHITECTURE.md, REDESIGN.md, SEEDING.md, SETUP.md, build-notes/ and research/. There is no TESTING.md. docs/ARCHITECTURE.md:590-591 says `docs/TESTING.md` lists which checks ran and which still need credentials or manual browser validation. FUNCTIONAL-BUILD-PROMPT.md:128 ("Prove these flows work") and :137 ("Document browser playback checks and distinguish checks actually run from checks still needing real credentials or manual validation") make this an explicit delivery item. docs/build-notes/foundation-api.md:31 hands TESTING.md to "whoever owns" it, and no one wrote it. SETUP.md has no testing section either (grep for testing/manual/browser only hits the synthetic-demo and deployment notes). The §7 route table is also stale. ARCHITECTURE.md:454 says `/` redirects by role, but src/app/(public)/page.tsx renders the public homepage for everyone and only forwards auth callbacks. ARCHITECTURE.md:456 calls `/set-password` the invite/reset page, but src/app/(auth)/set-password/page.tsx only calls permanentRedirect("/reset-password"), and /reset-password and /request-access are not in the table. This is a gap in the delivered documents, not a runtime bug.

**Fix guidance.** Add docs/TESTING.md. List each flow from FUNCTIONAL-BUILD-PROMPT §8 lines 128-136 and give it a status. Automated: name the test file (e.g. tests/player/engine.announcements.test.ts for welcome→4 tracks→station announcement and for skipped tracks not counting; tests/db/* for RLS and storage isolation; tests/api/player/* for media signing). Needs live Supabase or ElevenLabs. Needs a manual browser or device check: give steps for /radio and /dev/player-lab in Chrome, Safari and iOS, covering autoplay block, background tab and lock screen. Say plainly that no flow was run against a live Supabase project or in a real browser. Update ARCHITECTURE §7: `/` is the public homepage, `/reset-password` is the password page, `/set-password` 308-redirects to it, and add `/request-access`, `/privacy`, `/terms`, `/admin/settings` and the other current routes.

### REQ-02 — Skip is enabled during welcome/station announcements, contrary to 'Skip applies to music only'

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/lib/player/engine.ts:1578`

**Description.** CLAUDE-HANDOFF §03/04: "Skip applies to music only and does not increment the completed-track announcement counter." canSkip() (lines 1578-1589) returns true while the current item is an announcement: it is only false for a single-track genre when the current item is not an announcement. skip() (line 300) then retires the announcement and calls finishAnnouncement(), which marks the welcome as played and resets the rotation counter. The PlayerBar Skip button, the N shortcut and the Media Session `nexttrack` handler (line 1495) all go through this path. No test covers skipping during an announcement.

**Failure scenario.** EmeraldBar presses Start Radio. The welcome "Welcome to EmeraldBar. Enjoy the music." starts, and staff press Skip or N (or a headset next-track key). The announcement is cut off and marked played, so the welcome never replays this session, and the rotation counter restarts at 0. The same happens to every station announcement after 4 songs, which defeats the product's defining feature through a control the spec limits to music.

**Verifier reasoning.** CLAUDE-HANDOFF.md:102 says "Skip applies to music only and does not increment the completed-track announcement counter." In src/lib/player/engine.ts:1578-1589, canSkip() is true for any playing/buffering/loading/paused/blocked state. The only exception is a single-track genre, and only when the current item is not an announcement, so an announcement is always skippable. skip() (engine.ts:300-313) retires the announcement slot and calls finishAnnouncement() (engine.ts:818-821), which runs scheduler.onAnnouncementPlayed() (resets the count to 0) and, for a welcome, markWelcomePlayed(). The comment at engine.ts:309 ("a skipped announcement counts as played") and announcements.ts:103 show this was a deliberate engine choice. It contradicts the owner's spec, and no owner-approved deviation is recorded in ARCHITECTURE §9. Every entry point is live. PlayerBar.tsx:88 disables Skip only on !snapshot.canSkip. RadioScreen.tsx:66 lets the N shortcut through when canSkip is true. The Media Session `nexttrack` handler (engine.ts:1495) calls skip(). I reproduced it with a throwaway test in the scratchpad (verify-requirements/skipann.test.ts, using tests/player/engine-harness). After start the welcome is current with snapshot.canSkip === true, and skip() cuts it off. After 2 completed tracks the station announcement is current with canSkip === true, and skip() cuts that off too. The test passed. No project test covers skipping during an announcement: the only skip test, engine.announcements.test.ts:68, skips tracks.

**Fix guidance.** In PlayerEngine.canSkip() (engine.ts:1578), return false when `this.current?.item?.kind === "announcement"`, and keep the single-track rule for music. skip() already checks canSkip(), so the N shortcut (RadioScreen.tsx:66), the PlayerBar button (PlayerBar.tsx:88) and the Media Session nexttrack handler (engine.ts:1495) all become no-ops during an announcement. Optionally give the disabled Skip button a title or aria-description such as "Skip is available for songs". Update the comment at engine.ts:309 and the doc comment at announcements.ts:103. Add engine tests: canSkip is false and skip() is ignored while the welcome and a rotation announcement play, and canSkip returns to true on the next track.

### REQ-03 — Documented Node minimum (20.9) is wrong: admin/seed scripts need Node 20.12+, and the test runner needs Node 22.12+

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `scripts/lib/env.ts:29`

**Description.** docs/SETUP.md:11 says "Node.js 20.9 or newer" and package.json declares `engines.node: ">=20.9.0"`. But loadLocalEnv() calls `process.loadEnvFile`, which exists only from Node 20.12.0 / 21.7.0. It is called by `npm run admin:create` (SETUP §6A, the recommended way to create the first admin) and by `npm run seed:dev`. The pinned vitest 5.0.1 declares engines `^22.12.0 || ^24.0.0 || >=26.0.0` and vite 8 needs `^20.19.0 || >=22.12.0`, so `npm test` and `npm run check` are unsupported on any Node 20.

**Failure scenario.** A developer on Node 20.10 (allowed by SETUP and engines) runs `npm run admin:create -- owner@example.com` with a .env.local present. It crashes with "TypeError: process.loadEnvFile is not a function" before doing anything. `npm run check` fails at the vitest step on Node 20.

**Verifier reasoning.** scripts/lib/env.ts:29 calls `process.loadEnvFile(file)`. That API was added in Node 20.12.0 / 21.7.0. The only callers are scripts/create-admin.ts:28 (`npm run admin:create`) and scripts/seed-dev.ts:70 (`npm run seed:dev`), and both run it whenever .env.local or .env exists, which is the normal setup. package.json:44-46 declares `engines.node: ">=20.9.0"`, and docs/SETUP.md:11 says "Node.js 20.9 or newer". The installed toolchain declares higher minimums: vitest 5.0.1 needs `^22.12.0 || ^24.0.0 || >=26.0.0` and vite 8.3.1 needs `^20.19.0 || >=22.12.0` (read from node_modules/*/package.json). So `npm test` and `npm run check` (package.json:11,16) are outside their supported range on every Node 20. The 20.9 floor is right only for the Next.js runtime (next engines >=20.9.0). The dev machine runs Node 24.19, so the mismatch never surfaced.

**Fix guidance.** Set `engines.node` to `>=22.12.0` and change SETUP.md §1 to "Node.js 22.12 or newer (developed on Node 24)". If a lower floor is wanted for the production runtime only, say so explicitly and state that the scripts and tests need 22.12+. Or replace `process.loadEnvFile` in scripts/lib/env.ts with `loadEnvConfig` from `@next/env` (already a Next dependency) or a small parser, but vitest 5 still needs 22.12+ for `npm test`.

### REQ-04 — README.md is still the create-next-app boilerplate

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `README.md:1`

**Description.** FUNCTIONAL-BUILD-PROMPT §8 asks to "Deliver the project files … a setup guide". The repository's front page is the untouched create-next-app README. It tells readers to edit `app/page.tsx`, which does not exist (the homepage is src/app/(public)/page.tsx), says the project uses the Geist font, and links to Vercel templates. It does not name the product and does not link to docs/SETUP.md, docs/SEEDING.md or docs/ARCHITECTURE.md.

**Failure scenario.** The owner or a new developer opens the repository and gets generic Next.js instructions. `npm run dev` without .env.local only shows /setup, and nothing points them to docs/SETUP.md (migrations, auth email templates, admin creation) or to the seed/demo scripts.

**Verifier reasoning.** README.md is the unmodified create-next-app template. It says "You can start editing the page by modifying `app/page.tsx`", but there is no src/app/page.tsx or app/page.tsx; the homepage is src/app/(public)/page.tsx. It says the project loads Geist, but src/app/layout.tsx:2 imports Inter. It links to Vercel templates. It never names the product and never points to docs/SETUP.md, docs/SEEDING.md or docs/ARCHITECTURE.md. The §8 "setup guide" requirement (FUNCTIONAL-BUILD-PROMPT.md:124) is met by docs/SETUP.md, so this is a misleading entry document, not a missing guide. Hence low severity.

**Fix guidance.** Replace README.md with a short project overview. Cover what Frekvencija is, the stack, and a quick start: npm install; copy .env.example to .env.local; apply every file in supabase/migrations/ in order; npm run admin:create -- <email>; npm run dev. Link docs/SETUP.md, docs/SEEDING.md, docs/ARCHITECTURE.md (and docs/TESTING.md once it exists). List the npm scripts: check, test, demo:audio, seed:dev, admin:create.

### REQ-05 — SEEDING.md prerequisites say 'the three migrations'; the app needs the fourth (20260926000100), and a local stack cannot be started from the repo

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `docs/SEEDING.md:98`

**Description.** SEEDING.md §2 says: "Prerequisites: the three migrations in supabase/migrations/ are applied". There are four, and the current app depends on the fourth: loadPlayerBootstrap selects businesses.business_type, and the public pages and settings read platform_settings and genres.cover_path. The seed itself only uses columns from the first three migrations, so it succeeds on a database missing the fourth. The failure then shows up only in the app. Separately, the seed's default safe target is a local Supabase stack, and seed-dev.ts:151 and create-admin.ts:46 tell users to run `supabase start`. But the repo has no supabase/config.toml, and neither SETUP nor SEEDING mentions `supabase init`, so that command fails in this repo.

**Failure scenario.** A developer follows SEEDING.md and applies migrations 100/200/300. `npm run seed:dev -- --yes` reports success. Then EmeraldBar logs in and /radio shows the "unavailable" venue status screen because the bootstrap query for business_type errors, and the homepage/settings queries fail on the missing tables and columns.

**Verifier reasoning.** docs/SEEDING.md:98 says "Prerequisites: the three migrations in `supabase/migrations/` are applied". The folder holds four files, and docs/SETUP.md:55-58 lists all four, including 20260926000100_frekvencija.sql. The app needs the fourth. That migration adds businesses.business_type (line 29-30), genres.cover_path (line 37-38), access_requests (line 52) and platform_settings (line 89). src/lib/data/player.ts:57-58 selects `business_type` for the venue bootstrap and :123 selects `cover_path`, and a query error throws through queryFailed(). The seed does not touch those columns (no grep hits for business_type, cover_path or platform_settings in scripts/), so it succeeds on a three-migration database. The breakage only shows up in the app. For the local-stack path, the repo has no supabase/config.toml (`ls supabase` shows only migrations/ and seed/). Yet scripts/create-admin.ts:46 and scripts/seed-dev.ts:151 tell users to run `supabase start`, which needs a config.toml from `supabase init`, and neither SETUP nor SEEDING mentions init. docs/research/supabase.md:690 notes config.toml is created by `supabase init`. A reader who looks at the folder may apply all four files anyway, but the prerequisite as written is wrong.

**Fix guidance.** Change SEEDING.md:98 to "every file in `supabase/migrations/` is applied, in filename order (currently four, including 20260926000100_frekvencija.sql)". Optionally add a preflight in seed-dev that selects `business_type` from businesses and `id` from platform_settings, and refuses with a clear "apply migration 20260926000100 first" message. For the local stack, either document `supabase init` (then copy or link the migrations) before `supabase start`, or change the two script hints to point at SETUP.md instead of `supabase start`.

### REQ-06 — Dev seed predates business_type: EmeraldBar and Hotel Aurora are seeded as type 'Other' and carry no visible example label

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `scripts/lib/seed-apply.ts:217`

**Description.** The businesses insert (lines 215-229) and DemoBusiness in scripts/lib/demo-catalog.ts have no business_type, so both venues get the column default 'other' from migration 20260926000100. The requirement is "two clearly labeled example businesses, EmeraldBar and Hotel Aurora". The only demo marker is the contact email demo+…@example.com. Business names, station names and types look like real venues in /admin/businesses, unlike the tracks, which are titled "(synthetic)".

**Failure scenario.** After `npm run seed:dev -- --yes`, /admin/businesses lists EmeraldBar as "Other" and Hotel Aurora as "Other". A type filter for Bar or Hotel hides both demo venues, and nothing in the list shows they are example data.

**Verifier reasoning.** The business insert in scripts/lib/seed-apply.ts:215-229 sets name, station_name, pronunciations, contact_email, language, is_active, every_n and volume, but no business_type. The DemoBusiness interface and the DEMO_BUSINESSES entries (scripts/lib/demo-catalog.ts:273-316) have no type field. Both venues therefore get the column default 'other' (supabase/migrations/20260926000100_frekvencija.sql:29-30). The admin list shows businessTypeLabel(item.businessType) under each name (BusinessList.tsx:76,108), and BusinessIdentity.tsx:147 does the same, so EmeraldBar and Hotel Aurora both read "Other". The venue Account page (AccountView.tsx:107) shows "Business type: Other" to the demo users too. One detail in the finding is wrong: the admin business list has no type filter, only search plus a status filter (BusinessList.tsx:140-141, 184-193), so "a type filter hides both" cannot happen. The "clearly labeled" part is partly met: the example.com contact email is the documented seed marker (SEEDING.md:132) and is searchable, and the users are named "… demo user". The marker is not visible in the list rows, though. The confirmed defect is the wrong type on the seed data.

**Fix guidance.** Add `businessType: BusinessType` to DemoBusiness, set `"bar"` for EmeraldBar and `"hotel"` for Hotel Aurora, and include `business_type: business.businessType` in the insert at seed-apply.ts:217. For re-runs, also update business_type on 'reuse' rows, or document that existing demo rows keep their old type. Show the type in the seed plan output and in the SEEDING.md businesses table. A visible demo marker (for example "(example)" in the business name or station name note) is optional.

### REQ-07 — SETUP.md tells admins to use UI labels that do not exist ('Generate with AI', 'Assigned only')

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `docs/SETUP.md:201`

**Description.** SETUP §10.3 says "In an announcement, choose **Generate with AI**", but the studio's mode tabs are "Generate voice" and "Upload recording" (AnnouncementStudio.tsx:1005-1006). The string "Generate with AI" appears only in a code comment. SETUP §8.1 (lines 154-156) says to make a genre "Assigned only", but the genre editor's availability choices are "All businesses" / "Selected businesses" (GenreEditor.tsx:53), and "Assigned only" appears nowhere in the UI.

**Failure scenario.** An owner configuring ElevenLabs for the first time follows SETUP step by step, cannot find a "Generate with AI" control or an "Assigned only" option, and cannot tell whether the integration or the per-venue genre setup is broken.

**Verifier reasoning.** docs/SETUP.md:201 says "In an announcement, choose **Generate with AI**". The announcement studio's mode tabs are labelled "Generate voice" and "Upload recording" (src/components/admin/announcements/AnnouncementStudio.tsx:1005-1006). "Generate with AI" appears only in a code comment (src/components/admin/announcements/generate-form.ts:2), and grep finds no such rendered label. docs/SETUP.md:154-156 tells admins to make a genre "Assigned only", but the genre editor's availability choices are "All businesses" / "Selected businesses" (src/components/admin/catalog/genre-draft.ts:14-15, GenreEditor.tsx:53, genre-helpers.ts:166,180). "Assigned only" does not appear anywhere in src/. An owner following SETUP word for word will not find either control.

**Fix guidance.** In SETUP.md §8.1, write "set Availability to **Selected businesses** and pick the venues". In §10.3, write "open the announcement in the studio and choose the **Generate voice** tab". Optionally have a doc test grep SETUP.md for bold-quoted labels and check each exists in src/components.

### REQ-08 — Public header hides 'How it works' and 'Genres' below 768 px with no drawer or menu

- Verdict: **refuted** (severity low, reviewer said low)
- Location: `src/components/public/PublicHeader.tsx:37`

**Description.** CLAUDE-HANDOFF §01: "Navigation: How it works scrolls to the three steps; Genres scrolls to the genre section". Responsive rules: "Mobile <640 px: navigation drawer or simple bottom tabs". The main nav is `<nav className="hidden md:block">`, and the public site has no mobile menu or drawer, so below 768 px (phones and small tablets) both section links disappear. The footer only has Contact/Privacy/Terms. Genres stays reachable through the hero's "Explore genres" button, but "How it works" has no navigation entry at all.

**Failure scenario.** A visitor on a 390 px phone (one of the handoff's review widths) sees only the logo, "Log in" and "Request access" in the header and has no way to jump to How it works.

**Verifier reasoning.** src/components/public/PublicHeader.tsx:37 does hide the two section links below md (`hidden md:block`), and the public site has no mobile menu. That is not a requirements violation. The rule the finding cites, CLAUDE-HANDOFF.md:154 ("Desktop >=1024 px: full sidebar and split panels. Tablet 640-1023 px: compact navigation… Mobile <640 px: navigation drawer or simple bottom tabs… admin detail panels become full width"), is about the app shell: sidebar navigation, admin panels and editors. The venue and admin areas meet it with AppShell's MobileTopBar/MobileTabBar (docs/REDESIGN.md:115-119). The public homepage is one scrolling page with no sidebar, and the handoff has no mobile homepage composition (design/screens has only 01-homepage-desktop.png). CLAUDE-HANDOFF.md:79 describes what the nav links do, and on desktop they do it (`/#how-it-works` → HowItWorks.tsx:13 `id="how-it-works"`, `/#genres` → the genre section). On a phone, How it works is the third section, straight after the hero and audience row (src/app/(public)/page.tsx: Hero, AudienceRow, HowItWorks, GenreCollection…), so ordinary scrolling reaches it. Genres is also linked from the hero's "Explore genres" button (Hero.tsx:88-89). No flow is blocked and no stated requirement is broken. It is a design-polish choice.

**Fix guidance.** No fix required. If wanted, add a compact row with the two anchor links under the header on small screens.

## a11y-ux

### A11Y-01 — Dropdown menu items have no visible keyboard focus indicator (Tailwind v4 outline-none cancels focus-visible:outline-2)

- Verdict: **confirmed** (severity high, reviewer said high)
- Location: `src/components/ui/DropdownMenu.tsx:252`

**Description.** Each menu item's classes combine `outline-none` with `focus-visible:outline-2`. The compiled CSS (.next/static/chunks/2ezo46quekoz8.css) has `.outline-none{--tw-outline-style:none;outline-style:none}` and `.focus-visible\:outline-2:focus-visible{outline-style:var(--tw-outline-style);outline-width:2px}`. Because `outline-none` sets `--tw-outline-style: none` on the same element, the focus-visible rule resolves to `outline-style: none`, so no ring is drawn. The global `:focus-visible` outline sits in @layer base and loses to the utility. The only remaining cue is `focus:bg-surface-3` on a `bg-surface-2` menu, which is a 1.15:1 change. This component is used for every "…" row menu (tracks, genres, businesses) and for the admin and venue account menus.

**Failure scenario.** A keyboard user opens "Actions for <track>" with Enter and presses ArrowDown through Edit, Preview, Replace file… and Remove from playback. They cannot see which item has focus, because the background changes by about 1.15:1 and there is no outline, so they can activate the destructive item by mistake. This fails the handoff's "Keep all focus outlines visible" and WCAG 2.4.7.

**Verifier reasoning.** src/components/ui/DropdownMenu.tsx:252 combines `outline-none` with `focus-visible:outline-2`. In the built CSS, `.outline-none` is `--tw-outline-style:none;outline-style:none` and `.focus-visible\:outline-2:focus-visible` is `outline-style:var(--tw-outline-style)`. On the same element that resolves to none. The global `:focus-visible` rule in globals.css:190 sits in `@layer base` and loses to the utility. I checked this live on the running dev server at /dev/preview/radio. I focused the account-menu trigger and pressed ArrowDown. The focused `A role=menuitem "Account"` matched `:focus-visible`, but its computed outline-style was `none` and `--tw-outline-style` was `none`. The only cue left is the item background, rgb(34,51,44) on the menu's rgb(26,40,35), which is 1.15:1. Every row "…" menu and both account menus use this component, so the handoff rule "Keep all focus outlines visible" (CLAUDE-HANDOFF.md:47) is broken, including on the danger items.

**Fix guidance.** In DropdownMenu itemClasses, delete `outline-none` and keep `focus-visible:outline-2 focus-visible:-outline-offset-2`. The base `:focus-visible` rule then supplies a solid 2px ring. Do NOT switch to `outline-hidden`: in the installed Tailwind 4.3.3 (node_modules/tailwindcss/dist/lib.js), `outline-hidden` also sets `--tw-outline-style:none`, so it breaks the ring in the same way. If you need to keep a resting outline suppression, add `focus-visible:outline-solid focus-visible:outline-ring` instead; at 0,2,0 specificity it beats `.outline-none`. Add a unit test that the item class string does not contain `outline-none` or `outline-hidden` unless `focus-visible:outline-solid` is also present.

### A11Y-02 — Venue shell's sticky top bar, player bar and tab bar together take up the whole viewport at 400% zoom or on a landscape phone

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/shell/AppShell.tsx:80`

**Description.** Below 1024px the venue shell pins three things at once: a 64px sticky header plus 1px border, a sticky bottom stack holding the PlayerBar card, and a 64px tab bar plus safe-area padding. The PlayerBar card is 56px (lg play button) + 20px padding + a 26px progress row + border ≈ 104px; its wrapper adds pt-4/pb-3, making ≈132px. Together that is ≈262px of sticky chrome. There is no height-based media query anywhere in globals.css or the shell to un-stick or compact these bars, and ShellMetrics only feeds scroll-padding. The handoff requires that the fixed player bar and tab bar never cover content.

**Failure scenario.** On a 1280×1024 screen at 400% zoom the viewport is 320×256 CSS px. The 262px of sticky header, player and tab bar covers the entire viewport, so no /radio, /account or /help content is visible at any scroll position (WCAG 1.4.10). On an 844×390 phone in landscape (about 340px usable height plus a 21px bottom inset), only about 55–60px of the genre grid and forms is visible between the bars.

**Verifier reasoning.** AppShell.tsx:58-60 makes the header sticky below lg, and AppShell.tsx:79-101 makes the bottom stack (player + tab bar) sticky. No height-based media query exists anywhere; ShellMetrics.tsx only publishes heights for scroll-padding. I measured the real /dev/preview/radio?state=playing page. At 320×256 the header is 65px and the bottom stack is 197px (player 132 + tab bar 65). The gap between header bottom and bottom-stack top is -6px at scroll offsets 0, 200, 400, 800 and 1200, so no content is ever visible. At 683×330 (a 1366×768 laptop at 200% zoom) only 60px of content shows between the bars. One nuance: WCAG 1.4.10's 256px-height case formally targets horizontally scrolling content. The 200%-zoom laptop case is still a real, common loss of usable area, and the handoff asks for review of "fixed-player overlap" (CLAUDE-HANDOFF.md:185).

**Fix guidance.** In AppShell, add a short-viewport variant such as `[@media(max-height:32rem)]:static` on the `<header data-shell-header>` and on the `data-shell-bottom` wrapper. Alternatively keep only the player sticky there, hide its mobile TrackProgress row with `[@media(max-height:32rem)]:hidden` in PlayerBar.tsx:117-124, and cut the wrapper's pt-4/pb-3. Update ShellMetrics to publish 0 for a bar whose computed `position` is not `sticky`, so scroll-padding stays correct. Check the result at 320×256 and at 844×390.

### A11Y-03 — The hero's big Play/Pause control is swapped for a different element type on state change, so keyboard focus drops to <body>

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/player/NowPlayingHero.tsx:45`

**Description.** PrimaryControl returns a raw `<button>` for kind "pause"/"resume" and the `<Button>` component for "start"/"unblock"/"retry". These are different element types at the same tree position, so React unmounts the focused DOM node and mounts a new one whenever the kind crosses that boundary. Start Radio becomes Pause as soon as the engine reports loading. Retry and Resume radio become Pause the same way. It also returns null for kind "none".

**Failure scenario.** A keyboard or screen-reader user tabs to "Start Radio" and presses Enter. Status goes to loading, the action becomes "pause", and the focused `<Button>` is replaced by a new round `<button>`. Focus falls to <body>, the screen reader loses its place, and the next Tab starts again from the skip link. The same thing happens after pressing Retry, or Resume radio after an autoplay block.

**Verifier reasoning.** NowPlayingHero.tsx:44-73 returns a host `<button>` for pause/resume and the `<Button>` component for start/unblock/retry. That is a different element type at the same position, so React unmounts the focused node. getPrimaryAction (player-view.ts:122-144) moves from start, unblock or retry to pause as soon as status becomes loading or playing. I reproduced it live at /dev/preview/radio?state=idle. I focused the hero's "Start Radio" and pressed Enter. `document.activeElement` became BODY, the old button was disconnected, and the hero now showed a new "Pause" button.

**Fix guidance.** Make PrimaryControl render the same element type for every kind. For example, always render a host `<button type="button">` and switch only its className (round size-18/sm:size-22 versus the pill `buttonClasses({size:'xl'})` plus `rounded-full px-7`), aria-label and children. Or always use `<Button>` with a conditional className. For kind "none", render the same button with `aria-disabled` rather than returning null when it had focus, or move focus to the status text or heading (tabIndex=-1) in a layout effect.

### A11Y-04 — "Play {genre}" button disappears as soon as it is pressed, dropping focus

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/player/GenreGrid.tsx:90`

**Description.** The IconButton labelled `Play ${genre.name}` is rendered only while `card.indicator === "play"`. Pressing it calls playGenre, and the selected genre's indicator changes to "loading" (a spinner) and then "playing" (text plus equaliser). The focused button is therefore unmounted, and no focusable control takes its place on that card.

**Failure scenario.** On /radio a keyboard user tabs to "Play Jazz" while House is playing and presses Enter. The button is replaced by a spinner and then by a "Playing" label, focus goes to <body>, and a screen reader announces nothing about where focus went. To continue, the user must tab from the top of the page through the shell again.

**Verifier reasoning.** GenreGrid.tsx:90-99 renders the `Play ${genre.name}` IconButton only while `card.indicator === "play"`. genreCardState (player-view.ts:205-207) switches the selected genre to "loading" or "playing" right after playGenre. I reproduced it live at /dev/preview/radio. I focused "Play Jazz" and pressed Enter. activeElement became BODY, the old button was disconnected, and no "Play Jazz" control remained.

**Fix guidance.** Keep a focusable control mounted in that slot in every indicator state. Render the IconButton always, and while loading or playing give it `aria-disabled="true"` (not `disabled`, which also drops focus), a label like "Jazz is loading" or "Jazz is playing", and the spinner or equaliser as its icon. Or make it a Pause toggle. As a fallback, a layout effect can move focus to that card's "Select {genre}" button when the play button unmounts while it had focus.

### A11Y-05 — Toasts shown while a modal drawer or dialog stays open are inert and drawn under the backdrop, so they are neither announced nor operable

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/ui/Toast.tsx:106`

**Description.** The toast live region is a normal `fixed z-50` element in the root layout. While any `<dialog>` is open via showModal() (Drawer and Dialog), the rest of the document is inert and the dialog sits in the top layer above its `backdrop:bg-black/70`. Toasts added in that state are therefore dimmed behind the backdrop, their Dismiss/Undo buttons cannot be clicked, and inert content is removed from the accessibility tree, so the aria-live addition is not announced. The mobile editors stay open as Drawers and report some results only through toasts: GenreManager.toggleActive ("Activate genre" success and error toasts only, GenreManager.tsx:292-303), the deactivate confirmation (toast after the nested ConfirmDialog closes while the drawer remains open), and MusicLibrary's "Replace file" result (MusicLibrary.tsx:688, the toast fires while the Selected-track drawer is still open).

**Failure scenario.** On a phone an admin opens a genre in the "Edit genre" drawer and taps "Activate genre". The server rejects the change, and the only feedback is toast.error, which is rendered behind the 70% black backdrop, cannot be dismissed, and is not announced by VoiceOver or TalkBack. The admin believes the genre was activated.

**Verifier reasoning.** The Toast region (Toast.tsx:102-111) is an ordinary `fixed z-50` section in the root layout. Drawer and Dialog open through `showModal()` (ui/internal/use-modal-dialog.ts:48), which puts the dialog in the top layer and makes the rest of the document inert. I reproduced it live on /dev/preview/genres at 375px. I opened "Edit House" (the drawer is `dialog:modal`), edited the name and saved. The toast "Saved. …" was rendered at 16,10 343×74, but `elementFromPoint` at its centre returned the drawer's H2, so the toast sits under the top-layer drawer. Its Dismiss button cannot be reached, and inert content is not exposed to assistive tech. GenreManager.toggleActive (GenreManager.tsx:292-301) reports the Activate result and error only through a toast while the drawer (617-625) stays open. MusicLibrary's replace result (MusicLibrary.tsx:685-689) also fires while the Selected-track drawer is open.

**Fix guidance.** While a modal dialog is open, render the toast viewport inside the topmost open `<dialog>`. For example, useModalDialog registers the open dialog in a small context or store, and ToastProvider uses createPortal into it with a persistent aria-live list. A `popover="manual"` region outside the dialog may still be inert under a modal dialog, so do not rely on that alone without verifying it. Also show these results inline in the editors: GenreEditor already has an aria-live line (GenreEditor.tsx:235) and TrackEditor has its status area. Report activate/deactivate errors there, not only in toast.error.

### A11Y-06 — Unsaved admin edits are discarded silently when leaving through the sidebar, breadcrumbs or "Manage tracks"

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/admin/catalog/GenreEditor.tsx:214`

**Description.** The admin editors track dirty state but only guard some exits. GenreManager (GenreManager.tsx:199-204), MusicLibrary (MusicLibrary.tsx:207-212) and AnnouncementStudio (AnnouncementStudio.tsx:224-229) rely on `beforeunload`, which never fires for Next.js client-side navigation. The UnsavedChangesProvider used by Businesses and Settings is mounted inside the page, so the AdminShell sidebar and top-bar links (plain ShellNavLink in AdminShell.tsx:53, plus the mobile drawer copy) are never guarded. The GenreEditor's "Manage tracks" ButtonLink and AnnouncementStudio's breadcrumb links ("Businesses" and the venue name, AnnouncementStudio.tsx:939) are plain next/link as well. The handoff requires warning before discarding unsaved edits, and the code explicitly offers "Discard unsaved changes?" dialogs for in-page switches.

**Failure scenario.** An admin renames a genre and changes its availability, so the panel shows "Unsaved changes · Discard". They click "Manage tracks" or "Music library" in the sidebar, and the app navigates immediately with no prompt, losing the edits. The same happens after editing a station name on /admin/businesses/<id> and clicking "Announcements" in the sidebar, or after typing announcement text and clicking the "Businesses" breadcrumb.

**Verifier reasoning.** AdminShell.tsx:53-56 and 86-92 build the sidebar and mobile-drawer navigation from SidebarNav and SidebarButton, which end in ShellNavLink.tsx:40, a plain next/link with no guard. UnsavedChangesProvider is mounted only inside BusinessesDirectory.tsx:59 and SettingsForm.tsx:227, so even those pages' guards never see sidebar or top-bar clicks. GenreManager.tsx:199-204, MusicLibrary.tsx:207-212 and AnnouncementStudio.tsx:222-229 rely only on `beforeunload`, which does not fire for App Router client navigation. GenreEditor.tsx:214 ("Manage tracks" ButtonLink) and the AnnouncementStudio breadcrumbs (940-941) are plain links too. No sessionStorage or other draft persistence exists (grep finds none in src/components/admin). Unsaved edits are therefore silently dropped on these exits, even though the handoff asks to "Warn before discarding unsaved edits" (CLAUDE-HANDOFF.md:156).

**Fix guidance.** Mount one client UnsavedChangesProvider around the whole admin shell, e.g. a client wrapper used in app/admin/layout.tsx or AdminShell. Remove the nested providers in BusinessesDirectory and SettingsForm, or make them delegate to the outer one, so there is a single registry. Have ShellNavLink (and SidebarButton links, UserMenu hrefs and PageHeading breadcrumbs) call `useUnsavedChanges().guardLinkClick(event, href)` in onClick; outside a provider this is a no-op. Replace GenreEditor's Manage tracks ButtonLink with GuardedButtonLink. Have GenreManager, MusicLibrary and AnnouncementStudio report `guard.setDirty('<source>', dirty)` from an effect instead of their own beforeunload listeners.

### A11Y-07 — Add-business and Settings forms remount after every failed submit: focus is lost and the error message is not announced

- Verdict: **confirmed** (severity medium, reviewer said medium)
- Location: `src/components/admin/businesses/NewBusinessForm.tsx:195`

**Description.** NewBusinessForm keys its `<form>` by `state.nonce`, and SettingsForm keys the whole SettingsFields by `${state.nonce}:${updatedAt}` (SettingsForm.tsx:237). Both actions return a fresh nonce on failure. After a server-side failure the entire form, including the focused submit button and the FormMessage `aria-live="polite"` container, is replaced by new DOM nodes. A live region inserted with its text already present is generally not announced, focus falls to <body>, and neither form moves focus to the first `aria-invalid` field, unlike RequestAccessForm, which does. The task requires that focus moves to errors and that errors are announced.

**Failure scenario.** The admin submits "Create business" and the server rejects it with a field error or a message such as a database or invite failure. The form re-renders with the red message under the field, but the screen-reader user hears nothing and their focus is now on the document body. The same happens when a platform settings save fails.

**Verifier reasoning.** NewBusinessForm.tsx:194-195 keys the whole `<form>` by `state.nonce`, and the failure result sets `nonce: Date.now()` (app/admin/businesses/actions.ts:95). The FormMessage (310) and the submit button are inside that subtree, so every failed submit replaces the focused button and the polite live region with new nodes. FormMessage.tsx:29 is a polite live region whose own doc comment relies on it being present before the text changes; a region inserted already filled is generally not announced. SettingsForm.tsx:236-237 keys SettingsFields by `${nonce}:${updatedAt}`, with FormMessage at 208 inside, and the failure path also returns a nonce (settings/actions.ts:19). Neither form moves focus to the first `aria-invalid` field. RequestAccessForm.tsx:129-130 does, and LoginForm uses a `role=alert` Alert keyed by nonce, so the project's own patterns differ here. Field errors (Field.tsx:95-96) are not live regions.

**Fix guidance.** Render the result message outside the keyed subtree. In NewBusinessForm, key only an inner wrapper around the inputs, not the `<form>` or FormMessage. In SettingsForm, move `<FormMessage>` into SettingsForm next to SettingsFields. Or follow LoginForm and render a `role="alert"` `<Alert key={state.nonce}>` for failures. Add `useEffect(() => { if (!state.ok && state.nonce) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [state.nonce])`, as RequestAccessForm does. Fall back to focusing the message container (tabIndex=-1) when no field is invalid.

### A11Y-08 — Saving access-request notes never shows its confirmation; the card is remounted by its updatedAt key

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/businesses/AccessRequestsView.tsx:266`

**Description.** RequestCard is keyed by `${request.id}:${request.updatedAt}`. saveAccessRequestNotes updates the row, the `set_updated_at` trigger changes updated_at, and revalidateBusinesses() re-renders the list, so the whole card, including NotesForm and its useActionState, is recreated with the initial idle state. The "Notes saved."/"Notes cleared." FormMessage returned by the action therefore never survives, and there is no toast fallback on this path. Focus on the "Save notes" button is also lost. Status changes on the card lose focus the same way.

**Failure scenario.** The admin types a note and presses "Save notes". The spinner stops and the card re-renders with no success message and no announcement, and focus is on <body>. The admin cannot tell whether the note was saved.

**Verifier reasoning.** AccessRequestsView.tsx:266 keys RequestCard by `${request.id}:${request.updatedAt}`. saveAccessRequestNotes (app/admin/businesses/requests/actions.ts) updates the row and calls revalidateBusinesses(), which is revalidatePath('/admin/businesses','layout') and covers /requests. The `set_updated_at` BEFORE UPDATE trigger on access_requests (frekvencija.sql:82 → core_schema.sql:190-198) changes updated_at, so the refreshed list gives the card a new key. The card remounts, and NotesForm's useActionState (line 93) restarts from IDLE. The "Notes saved."/"Notes cleared." FormMessage (line 123) is therefore never shown, and focus on "Save notes" is lost. The notes path has no toast; only status changes toast (line 143).

**Fix guidance.** Key RequestCard by `request.id` only. To reload the textarea's defaultValue after a save or refresh, key the inner `<div>` around the Field (line 101) by `${state.nonce ?? 0}:${request.updatedAt}` instead of keying the whole card. The status-change buttons keep their state then, and FormMessage stays mounted as a persistent live region.

### A11Y-09 — Genre and track editors fail client-side validation silently: no focus move and no announcement

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/catalog/GenreEditor.tsx:92`

**Description.** GenreEditor.handleSubmit sets `attempted` and returns when the name, description or slug is invalid. TrackEditor.handleSubmit (TrackEditor.tsx:98) returns when the title or artist is invalid. Both forms use noValidate. The resulting Field errors are plain text, not live regions, FormMessage only shows server errors, and focus stays on the submit button. Nothing tells a screen-reader user why pressing the button did nothing.

**Failure scenario.** In "Add genre" the admin presses "Create genre" with the name empty. "Enter a name" appears under the Genre name field, but focus remains on the button and nothing is announced. A screen-reader user hears no response and may press the button repeatedly.

**Verifier reasoning.** GenreEditor.tsx:89-94 sets `attempted` and returns when the name, description or slug is invalid. The form has noValidate (line 111). The resulting Field error (Field.tsx:95-96) is a plain div with no live role, FormMessage (line 229) shows only server errors, and focus stays on "Create genre". So in create mode, pressing Create with an empty name gives no announcement and no focus move. TrackEditor.tsx:96-100 also returns silently. Its impact is smaller because its title/artist errors show while the user types (lines 168 and 178), but the submit still does nothing audible.

**Fix guidance.** When handleSubmit blocks, move focus to the first problem. GenreEditor: `if (problems.name) nameRef.focus(); else if (problems.description) descriptionRef.focus(); else if (slugIssue) { detailsRef.open = true; slugRef.focus(); }`. Use local refs, because nameInputRef is only passed for the desktop copy. Do the same with the title and artist inputs in TrackEditor. Alternatively write a summary such as "Fix 1 field: Genre name" into the existing aria-live line (GenreEditor.tsx:235).

### A11Y-10 — "Move down" from a genre card's … menu loses keyboard focus

- Verdict: **refuted** (severity low, reviewer said low)
- Location: `src/components/admin/catalog/GenreManager.tsx:264`

**Description.** The menu's activate() focuses the trigger, and onSelect then calls move(), which applies an optimistic reorder. For a move down ([X, Y] to [Y, X]), React's keyed reconciliation keeps Y in place and physically moves X's `<li>` with insertBefore. X's card contains the focused … trigger, and removing and re-inserting a node blurs it, so focus goes to <body>. Only the drag-handle keyboard path sets `pendingFocus` to restore focus (handleHandleKeyDown); move() does not. "Move up" happens to keep focus because the other card is the one that moves. Move up/Move down is the keyboard alternative the handoff explicitly requires.

**Failure scenario.** A keyboard user opens "Actions for Lounge" and chooses "Move down". The order is saved and announced, but focus is now on <body>. Pressing "Move down" again requires tabbing back through the whole page to find the card.

**Verifier reasoning.** Reproduced on /dev/preview/genres (GenreManager with preview actions): opened "Actions for House" with Enter, ArrowDown to "Move down", Enter. The order became Deep House, House, … and document.activeElement was still the same, still-connected "Actions for House" button. A second instrumented run logged `focus trigger` (close(true)), then `blur trigger, active=BODY` (the `<li>` move), then `focus trigger` again. The re-focus is React DOM's commit step: after mutation effects it restores focus to the previously focused element if that element is still in the document (the next/dist/compiled/react-dom client dev bundle, around lines 19571-19583: `curFocusedElem !== priorFocusedElem && containsNode(documentElement, priorFocusedElem)` then restores it). A keyed reorder never unmounts the trigger, so focus comes back. The claimed focus loss does not happen.

**Fix guidance.** No change needed. Optionally add pendingFocus in move() for symmetry, but it is not required.

### A11Y-11 — Player keyboard shortcuts fire while typing in the open account menu on /radio

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/player/shortcuts.ts:25`

**Description.** playerShortcutFor() ignores only text-entry targets for letter keys, and `[role="menuitem"]` appears only in the Space exclusion list. DropdownMenu's first-letter typeahead does not call preventDefault, so a letter pressed while a menu item has focus reaches the document keydown listener that RadioScreen installs through usePlayerShortcuts. Shortcuts are on by default. The venue account menu (Account, Help, Sign out) is shown in the /radio header.

**Failure scenario.** On /radio a keyboard user opens the account menu and presses "n" or "m" while navigating it, as typeahead or by accident. The current song is skipped, or the radio is muted, in the venue while the menu is open.

**Verifier reasoning.** shortcuts.ts:25-30 exempts `[role=menuitem]` only for Space. DropdownMenu's typeahead (DropdownMenu.tsx:237-246) does not call preventDefault, so the keydown reaches usePlayerShortcuts' document listener (hooks.ts:106-118). isModalDialogOpen does not match a popover menu. I reproduced it live on /dev/preview/radio: with the account menu open and focus on the "Account" menuitem, pressing `m` switched the player's Mute button to aria-pressed="true" while the menu stayed open. Impact is limited: the venue menu has no items starting with K, M or N, and the shortcuts can be switched off, so WCAG 2.1.4 is met. Still, a letter pressed inside a menu, which owns printable keys for typeahead, mutes or skips live playback.

**Fix guidance.** In DropdownMenu.handleMenuKeyDown, call `event.preventDefault()` whenever it handles a printable key (the `event.key.length === 1` branch), whether or not an item matched. playerShortcutFor already returns null for defaultPrevented events, and React's root listener runs before the document listener. Alternatively return null from playerShortcutFor when `target.closest('[role="menu"],[role="listbox"]')` matches.

### A11Y-12 — Track table selection checkboxes are 20×20px and a near-miss opens the editor

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/catalog/TrackTable.tsx:217`

**Description.** The row and header checkboxes are `size-5`, i.e. 20px, with no enlarged hit area. The surrounding `<td>` (48px wide) is not a label, and the row's onClick opens the track editor unless the target is an interactive element. A tap on the cell padding around the checkbox therefore opens the Selected-track drawer on mobile. This is below the handoff's 44px minimum and WCAG 2.5.8's 24px.

**Failure scenario.** At 390px an admin tries to tick three tracks for a bulk "Remove from playback". A tap a few pixels off the 20px box opens the full-screen "Selected track" drawer instead, and the admin has to close it and try again.

**Verifier reasoning.** TrackTable.tsx:176-186 (header) and 214-221 (rows) render `size-5` (20×20px) checkboxes in a `w-12` cell. The cell is not a label. The row's onClick (handleRowClick at 166-169) opens the editor unless the target matches INTERACTIVE (line 50: button, a, input, label…). A tap on the cell padding just outside the 20px box therefore hits the `<td>` and opens the track editor, which is the Selected-track drawer below lg. This is below the handoff's 44×44px target size (CLAUDE-HANDOFF.md:41) and WCAG 2.5.8's 24px, and the spacing exception does not help because the surrounding row is itself a click target.

**Fix guidance.** Wrap each checkbox in a `<label className="-m-2 flex size-11 items-center justify-center cursor-pointer">` (or make it fill the cell) that holds the existing input. `label` is already in INTERACTIVE, so taps on it toggle the checkbox and never open the editor. Do the same for the select-all checkbox.

### A11Y-13 — Announcement settings field errors are not linked to their controls

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/announcements/AnnouncementSettingsCard.tsx:110`

**Description.** The server field errors for announcementEveryNTracks and announcementVolumePercent (lines 110 and 138) are rendered as `<p>` elements without ids. The Select, custom Input and Slider set aria-invalid but point `aria-describedby` only at their hint ids, so the error text is never associated with the field. The task requires field-level errors linked through aria-describedby.

**Failure scenario.** The admin enters a custom interval outside the allowed range that the server rejects and tabs back to the field. The screen reader says "invalid entry" but does not read the reason, because the error paragraph is not referenced.

**Verifier reasoning.** AnnouncementSettingsCard.tsx:110 and 142 render the server field errors as `<p>` elements with no id. The Select (62-66), the custom Input (84-95) and the Slider (119-133) point aria-describedby only at hintId or volumeHintId, and the Slider never gets aria-invalid. The form is `noValidate` (line 55), so out-of-range custom values do reach the server and come back as fieldErrors. The error text is never associated with its control.

**Fix guidance.** Add `const intervalErrorId = useId(); const volumeErrorId = useId();` and put these ids on the error paragraphs. Set `aria-describedby={[hintId, intervalError && intervalErrorId].filter(Boolean).join(' ')}` on the Select and the custom Input, and do the same for the Slider with volumeErrorId, plus `aria-invalid={volumeError ? true : undefined}`. Alternatively wrap these controls in `<Field>`, which already does this wiring.

### A11Y-14 — Opening a business from the list on tablet or phone hides the focused link without moving focus

- Verdict: **confirmed** (severity low, reviewer said low)
- Location: `src/components/admin/businesses/BusinessesDirectory.tsx:77`

**Description.** Below 1024px, selecting a business (GuardedLink with scroll={false}) sets `showsDetail`, which gives the list section `hidden lg:block` (display:none) and so hides the focused link. With scroll={false}, Next.js performs no scroll or focus handling, and nothing focuses the detail panel's heading. The "All businesses" back link, which is itself hidden when the list reappears, has the same problem in reverse.

**Failure scenario.** On a 768px tablet with a keyboard, or with VoiceOver on a phone, the admin activates "EmeraldBar" in the list. The detail panel appears, but focus is lost to <body>, so the user must re-traverse the header, the "All businesses" link and more to reach the form.

**Verifier reasoning.** BusinessesDirectory.tsx:77 hides the list section (`hidden lg:block`) once a business is selected. The row links are GuardedLink with scroll={false} (BusinessList.tsx:~101), and with scroll=false Next's layout-router does no scroll or focus handling. No code focuses the detail panel; the only `.focus()` calls in admin/businesses are in AccessLinkDialog. I reproduced it live at 768px on /dev/preview/businesses. I focused "EmeraldBar" and pressed Enter. The URL changed, the list became display:none, and activeElement was BODY. The next Tab landed on "Skip to content" at the top of the page, so the user does have to go through the header again.

**Fix guidance.** In BusinessesDirectory, add a ref on the detail column, or on the detail heading with tabIndex={-1}. In an effect keyed on `selected`, when the viewport is below lg and the selection changed from the list, focus that heading. When returning to the list (selected becomes null), focus the previously selected row's link, found e.g. via a `data-business-id` attribute and the previous selectedId held in a ref.

### A11Y-15 — Text-field boundaries are 1.35–1.43:1 against their surroundings (WCAG 1.4.11)

- Verdict: **uncertain** (severity low, reviewer said low)
- Location: `src/components/ui/internal/control-styles.ts:5`

**Description.** Inputs, selects, textareas and search fields are identified only by `border-border` (#26382F) on a `bg-control` (#101A16) well inside `bg-surface` (#15201C) cards. The border contrast is 1.35:1 against the card and 1.43:1 against the well, and the well itself differs from the card by about 1.1:1. Even the hover border (#365044) reaches only 1.9–2.0:1, so resting text fields fall below the 3:1 non-text contrast needed to perceive the control boundary. The accent-on-dark-text (6.91:1), muted text (7.51:1) and warning/danger pill combinations all pass.

**Failure scenario.** A low-vision admin on the Settings or Add business form sees labels floating over an almost uniform dark card and cannot tell where the input areas are or how wide they are, especially empty fields without placeholders such as "Contact phone".

**Verifier reasoning.** The contrast numbers are right. control-styles.ts:5-10 uses border-border #26382F on bg-control #101A16, which is 1.35:1 against the card #15201C and 1.43:1 against the well; the well differs from the card by 1.06:1; hover #365044 gives 1.90 to 2.02:1. But #26382F is the owner-mandated "Border" token in CLAUDE-HANDOFF.md:29. WCAG 1.4.11 does not strictly require a 3:1 field boundary when the label placement identifies the input, and auditors disagree on this case. So this is a design-token decision rather than a clear build defect. Also, the suggested #4F6B5E is only 2.87:1 against #15201C, not 3:1 as the finding claims.

**Fix guidance.** If the owner agrees, add a dedicated control-border token and use it only in CONTROL_CLASSES (hover one step lighter), keeping #26382F for card and table hairlines. The token needs at least #577567 (3.30:1 on #15201C, 3.51:1 on #101A16, 3.02:1 on surface-2 #1A2823). #4F6B5E is not enough.

