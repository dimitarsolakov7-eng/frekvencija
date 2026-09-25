# Browser audio playback: research notes for PlayerEngine

Researched 2026-09-25 for `src/lib/player/` and `src/components/player/PlayerProvider.tsx` (see
`docs/ARCHITECTURE.md` §9). Scope: a continuous radio built on pooled `HTMLAudioElement`s in a
React 19 / Next 16 client component. Signed Supabase Storage URLs are the media source.

**Evidence labels**

- **[SPEC]** WHATWG HTML (media elements, user activation) and the Web Audio spec (`WebAudio/web-audio-api`
  `index.bs`), fetched 2026-09-25.
- **[MDN]** MDN pages fetched 2026-09-25. **[BCD]** `mdn/browser-compat-data` main, fetched the same day.
- **[SRC-C]** Chromium main, read 2026-09-25: `autoplay_policy.cc`, `html_media_element.cc`,
  `multi_buffer_data_source.cc`, `web_media_player_impl.cc`, `media_switches.cc`,
  `user_activation_state.h`, `media_session.cc`, `media_element_audio_source_node.cc`.
- **[SRC-W]** WebKit main at commit `4d1f8e8e` (2026-09-24): `HTMLMediaElement.cpp`, `MediaElementSession.cpp`,
  `Document.cpp`, `UserGestureIndicator.*`, `LocalDOMWindow.cpp`, `UnifiedWebPreferences.yaml`. This is
  **source reading only**: no Safari or iOS device was available. Shipping Safari versions may be older than main.
- **[SRC-G]** Firefox main (`mozilla-firefox/firefox`), read 2026-09-25: `HTMLMediaElement.cpp`,
  `AutoplayPolicy.cpp`, `StaticPrefList.yaml`, `domerr.msg`.
- **[SRC-S]** `supabase/storage` master: signed-object route, error codes, renderer.
- **[LAB]** Run in **Chromium 152.0.7977.130**, the Claude desktop browser pane (Electron), against a
  local Node server. The server sends Range responses (206) and returns a Supabase-like `400` JSON
  once a URL's `exp` has passed. The harness and the helper module are in the session scratchpad
  (`scratchpad/browser-audio/`), not in the repo.
  - Lab limits: the pane's autoplay policy is relaxed (`play()` succeeded with no activation), and
    `visibilityState` read `hidden`, yet rAF and timers were **not** throttled.
  - Autoplay-gesture and background-throttling claims are therefore **not** lab-verified.
- **[TSC]** The code in §11 was typechecked with the project's TypeScript 5.9.3 (`strict`, `lib: dom`) and
  run in the [LAB] browser.
- **UNVERIFIED**: my inference, or third-party reports.

---

## 0. TL;DR decisions

1. **Handle `play()` rejections by `err.name` only.** Messages differ per browser.
   - `NotAllowedError` → `blocked`. Show a "Start audio" button whose click handler calls `play()`
     synchronously.
   - `AbortError` → never show an error. Re-read the element's state (it is benign only if we caused it).
   - `NotSupportedError` → the source failed (§4).
   - Also wrap every `play()` in a timeout: with no `src` its promise stays **pending forever** [LAB].
2. **Treat Chrome and Firefox as per-document: any element may play after the first gesture (sticky activation).
   Treat WebKit (Safari, all iOS browsers) as per-element:**
   - Create or unlock every pooled element **inside the Start click handler, synchronously**: call
     `el.load()` on each idle element [SRC-W].
   - Never create a new `Audio` per track (§1.3).
3. **Truth comes from events plus progress, not from `paused`.** Status is `playing` only after a `playing`
   event, while `!paused && !ended && error === null && readyState >= 3`, with `currentTime` advancing.
   - `paused` stays `false` while buffering, and **after a mid-playback network error** [LAB].
   - A natural end fires `pause` **before** `ended`, with `el.ended === true` [LAB].
4. **Bound preloading.** Keep one idle "next" element with `preload="auto"`.
   - Chrome buffers only about 85 s of a 320 kbps file on an idle element (about 3.4 MB), then suspends [LAB].
   - Cancel with `pause(); removeAttribute('src'); load()`. This was verified to close the HTTP connection
     [LAB]. **Never** set `src = ''`, which fires `error` code 4 [LAB].
5. **An expired signed URL mid-track gives `MEDIA_ERR_NETWORK` (2)** on the next Range request; an expired URL
   before metadata gives code 4 plus `NotSupportedError`.
   - Evidence: [LAB] Chromium; the same mapping appears in [SRC-G] Firefox.
   - Recover with: re-sign → `el.src = fresh; el.currentTime = pos` (allowed before metadata) → `play()`.
     Verified to resume at `pos` [LAB].
6. **Fades use `element.volume` ramps timed by the wall clock with `setInterval`.**
   - Not `requestAnimationFrame`: it does not run in hidden tabs [MDN].
   - Not Web Audio in v1. A cross-origin element without CORS plays **silence** through the graph
     while every media event says "playing" [LAB, SPEC].
   - Feature-detect a writable volume **asynchronously**; iPhone reverts it one task later [SRC-W].
   - Never start a fade at volume 0 (§5.3).
7. **Media Session:** register `play`, `pause`, `stop` and `nexttrack` (each in its own try/catch), and set
   `previoustrack` and the seek actions to `null`.
   - Set `playbackState` from the engine's truth.
   - Guard `setPositionState` (it throws on a `NaN` duration and on position > duration) [LAB], or don't use it.
8. **Background tabs and sleep:**
   - Audible pages are exempt from Chrome timer throttling, but a silent stall in a hidden tab is not.
   - Device sleep, browser termination and mobile background suspension can stop audio, and **we must say so
     in the UI and docs** (§7).

---

## 1. Autoplay, user activation and `play()` rejections

### 1.1 `play()` promise outcomes

`play()` returns a promise. It resolves when playback starts (Chrome resolves it together with the
`playing` event [SRC-C `ScheduleNotifyPlaying`]) and rejects with a `DOMException` [MDN].

| `err.name` | When | Our handling |
|---|---|---|
| `NotAllowedError` | Autoplay policy: no qualifying user activation (see 1.2). On WebKit, an element that was started silently (muted or volume 0) without a gesture is **paused** and its pending promises rejected when its volume is raised outside a gesture [SRC-W `setVolume`]. Unmuting outside a gesture probably behaves the same (`setMutedInternal` → `updateShouldPlay`); that path is UNVERIFIED. | `blocked`: show "Start audio". Its click handler calls `play()` on the current element **synchronously, before any `await`**. |
| `AbortError` | A pending play was interrupted by `pause()`, `load()`, a new `src`, or `removeAttribute('src')`+`load()` [SPEC, LAB]. Chrome also uses it for UA-initiated pauses: "by end of playback", "because the media was removed from the document", "because the containing page was frozen", "because a pause was requested by the browser/user", and background power saving [SRC-C `RejectScheduledPlayPromises`]. | Never show an error. If the element or generation is no longer current, ignore it. Otherwise re-derive: if `el.paused` and the engine did not request the pause, set status `paused` (external) with a Resume button. |
| `NotSupportedError` | `el.error.code === 4` (the resource selection failed): 4xx including an expired signed URL, a CORS failure with `crossOrigin` set, or an unsupported file [SPEC, LAB]. | Same as media error `source` (§4.3). |
| *(stays pending)* | `play()` on an element with no `src`: still pending after 1.5 s [LAB]. A long initial buffer also leaves it pending. | Wrap in `safePlay(el, timeoutMs)` (§11). Late settles are ignored via the generation number. |

The messages are not portable, so match on `name` only:

- Chrome NotAllowedError: "play() failed because the user didn't interact with the document first."
- Chrome AbortError: "The play() request was interrupted by a call to pause()." or "…by a new load request."
- Firefox AbortError: "The fetching process for the media resource was aborted by the user agent at the
  user's request." [SRC-G `domerr.msg`]

The AbortError is benign **only as an error to show**. It still means "this element is not playing
because of X", so the engine must reconcile state.

### 1.2 How activation works and how long it lasts

- **Sticky activation** is set on the first activation-triggering input and **never resets for the lifetime of
  that document (Window)** [SPEC, MDN].
  - Activation-triggering inputs: a trusted `keydown` (not Esc and not a UA-reserved shortcut), `mousedown`,
    `pointerdown` (mouse), `pointerup` (non-mouse) or `touchend`.
  - Next.js client-side navigation keeps the same document, so activation survives `/radio` ↔ `/account`.
  - A reload or hard navigation starts a new document without activation. Chromium can carry activation
    across some same-origin navigations behind a feature flag [SRC-C]. **Do not rely on that.**
- **Transient activation** lasts **5 s** in Chrome (`kActivationLifespan`) [SRC-C], 5000 ms in Firefox
  (`dom.user_activation.transient.timeout`) [SRC-G] and 5 s in WebKit (`defaultTransientActivationDuration`)
  [SRC-W]. `play()` does not consume it.
- `navigator.userActivation.hasBeenActive` and `.isActive` are supported in Chrome 72, Firefox 120 and Safari 16.4 [BCD].
  - Use `hasBeenActive === false` at bootstrap to show "Start Radio" without even trying `play()`.
  - It is only a hint on WebKit, whose gate is per element.
- `navigator.getAutoplayPolicy()` is **Firefox-only** (112+; Chrome and Safari: no) [BCD], and it is not in
  TS 5.9 `lib.dom`. Don't build on it.
- Chrome's muted-autoplay exemption applies **only to `<video>`**. A muted `<audio>` before activation still
  rejects [SRC-C `IsEligibleForAutoplayMuted`]. Muting is not a workaround.
- Chrome uses the same document-level policy on desktop **and Android**: `kUnifiedAutoplay` is enabled by
  default, which selects `document-user-activation-required` [SRC-C `media_switches.cc`].
- Installed-PWA scope in Chrome has no gesture requirement (`IsInWebAppScope`) [SRC-C]. That is a bonus,
  not a design assumption.
- **Managed venue machines (optional):** Chrome enterprise policy can allow autoplay for our origin. The
  prefs `media.autoplay_allowed` and `media.autoplay_whitelist` return `kNoUserGestureRequired` in
  `DetermineWebContentsAutoplayPolicy` [SRC-C]. The admin-facing policy names `AutoplayAllowed` and
  `AutoplayAllowlist` are UNVERIFIED here. This is a deployment tip only. The app must still work with the
  default policy.
- Do not send `Permissions-Policy: autoplay=()` or `media-playback-while-not-visible=()`. The second one makes
  Chrome reject `play()` and pause media while the frame is hidden [SRC-C `CanPlayWhileHidden`].

### 1.3 Playing a second element later, for example from `ended`

| Engine | Gate | Can a *different*, preloaded element play later without a new gesture? |
|---|---|---|
| Chrome desktop/Android | `kDocumentUserActivationRequired`: the element is not locked. `IsDocumentAllowedToPlay` checks the frame's (or an ancestor's) **sticky** activation, or high Media Engagement [SRC-C]. | **Yes**, any element, any time after the first gesture in this document. |
| Firefox | `media.autoplay.default=1` (block audible) and `media.autoplay.blocking_policy=0` (sticky activation of the window) [SRC-G]. | **Yes**, the same as Chrome. |
| WebKit (Safari macOS when the site's Auto-Play setting is "Stop Media with Sound"; every iOS/iPadOS browser) | A **per-element** restriction, `RequireUserGestureForAudioRateChange` (on by default on iOS) [SRC-W]. It is lifted for that element forever by `play()`, `load()`, setting `autoplay`, or changing `volume`/`muted` **while a gesture is being processed**, or by **creating** the element during a gesture [SRC-W]. "During a gesture" (`mediaUserGestureReason`) means: an active gesture token (the synchronous handler, forwarded 1 s through timers and 10 s through `fetch`), transient activation (5 s), or **1 s after an unlocked element fired `ended`** [SRC-W `Document.cpp`]. | **Only if that element was unlocked**, or if `play()` happens within 1 s of the previous (unlocked) element's `ended`, or within 5 s of a gesture. Async work in the `ended` handler (for example re-signing) can exceed the 1 s grace. **Pre-unlock the whole pool at Start.** |

**iOS extras [SRC-W]**

- **Preloading is capped at `metadata`** for elements that are not unlocked yet (`AutoPreloadingNotPermitted`,
  because `MediaDataLoadsAutomatically=false` on iOS). One more reason to unlock the pool at Start.
- **Volume is locked on iPhone** (`defaultVolumeLocked()` = iOS small-screen idiom).
  - An assignment is stored and then **reverted in a queued task**, with no `volumechange` event.
  - A synchronous read-back therefore lies. Probe asynchronously (`detectVolumeWritable`, §11).
  - BCD says iOS `volume` "is always 1, and setting a value has no effect" [BCD].
  - Per current source, iPad (not small-screen) is **not** locked. UNVERIFIED on a device.
  - `muted` works everywhere.
- **Consequences on iPhone:**
  - No fades.
  - `MUSIC_GAIN` and `announcement_volume` **cannot be applied**; announcements play at file level.
  - Master volume is the hardware buttons: hide or disable our slider when the volume is not writable.
- Interruptions (a phone call, Siri, another app taking audio) pause the element. We see a `pause` event we did
  not request, and resuming may need a gesture. UNVERIFIED on a device.

**Unlock recipe.** In the Start/Resume click handler, run these synchronously (no `await` before them):

1. `ensurePool()`: create the elements if they are missing (creation during a gesture already unlocks on WebKit).
2. `unlockIdleMediaElements(pool)`: `load()` on each element that has no `src`.
3. Then start the async bootstrap (fetch the track list, sign, set `src`, `play()`).

Keep reusing the same 3 elements for the whole session. Swap *roles*, not `src`: copying a `src` into
another element re-downloads it.

---

## 2. Events: what they mean, and what "actually playing" is

### 2.1 Semantics

Sources: [MDN], [SPEC], plus [LAB] observations.

| Event | Meaning | Engine use |
|---|---|---|
| `loadstart` | The UA started loading a resource (new `src` or `load()`). | Current element → `loading`. |
| `durationchange` / `loadedmetadata` | Duration known, `readyState ≥ 1` (`HAVE_METADATA`), seeking allowed. | Read `duration` for the URL-expiry window. |
| `loadeddata` | Data for the current position (`readyState ≥ 2`). | None. |
| `canplay` | `readyState ≥ 3`: can start, but may stall. | None. **Not audible.** |
| `canplaythrough` | UA *estimates* it can play to the end (`readyState 4`). | Informational only. [LAB]: fired 0.4 s into a 200 KB/s download that later ran dry. |
| `play` | `paused` flipped to `false` because `play()` was called. | Intent only. **Not audible.** |
| `playing` | Playback started or resumed after a pause or a data starvation. | → `playing` (if current, `!ended`, `error === null`). Reset the progress tracker. |
| `waiting` | Stopped for lack of data while not paused (`readyState < 3`). [LAB]: also fires **immediately after `play()`** on a fresh element, before `loadstart`. | Before the first `playing` of this item → `loading`. After it → `buffering`. |
| `stalled` | Fetching, but no data for about 3 s. | **Unreliable.** [LAB]: fired about 3.3 s into one server stall, and did not fire in another 9 s stall. Use our own watchdog. |
| `suspend` | The UA intentionally stopped fetching (enough buffered, or `preload=metadata`). | Benign. Never an error. |
| `progress` | Bytes arrived. | Optional: reset a network-stall timer. |
| `timeupdate` | `currentTime` changed (every 15–250 ms while playing). | Feed the progress tracker. |
| `pause` | `paused` flipped to `true`: our `pause()`, a **natural end** (fires before `ended` with `el.ended === true` [LAB]), or a UA/OS pause (interruption, headphones unplugged, Media Session default, AbortError reasons). | If `el.ended`, ignore (let `ended` handle it). If the engine did not request it, set `paused` (external) and update the Media Session. |
| `ended` | Reached the end. | The track completed (counts toward `everyNTracks`). Advance. |
| `error` | `el.error` is set (§4). | Classify by `el.error.code`. |
| `emptied` | The element was reset by the load algorithm (new `src` or `load()` with a previous resource). [LAB]: fires with `abort`. | Expected after our own swaps. Ignore when the engine initiated it. |
| `abort` | The fetch was aborted, not because of an error. | Same as `emptied`. |

**[LAB] sequences (Chromium 152)**

- **Fresh play:** `play → waiting → loadstart → (suspend) → durationchange → loadedmetadata → loadeddata →
  canplay → playing → canplaythrough`. At the end: `pause (ended=true) → ended`.
- **Data starvation:** `waiting` (readyState 2, paused=false, currentTime frozen) `→ canplay → playing →
  canplaythrough`.
- **Mid-playback network error:** `seeking → waiting → error(code 2)`. Afterwards `paused` is still
  **false**, `readyState` is 1, and **no `pause` event** fires.
- **`removeAttribute('src'); load()`:** `abort → emptied`, then `networkState` goes to 0. **`currentSrc` still
  shows the old URL** right afterwards, so track item identity ourselves.

### 2.2 Definition of "actually playing"

Report `playing` only when all of these hold:

- the `playing` event was seen for the current item;
- `!el.paused && !el.ended && el.error === null`;
- `el.readyState >= HAVE_FUTURE_DATA`;
- `currentTime` advanced within about 2 s. Sample it on `timeupdate` and on a 1 s watchdog tick.

`ProgressTracker` in §11 implements this. `muted` is a separate UI state: show "Muted", not "stopped".

**Buffering watchdog** (ARCHITECTURE §9):

- A `waiting` after `playing`, or no advance for more than 2 s while `!paused`, means `buffering`.
- Buffering for more than 15 s: re-sign, `reloadAt(currentTime)`, and play, once.
- Buffering for more than 45 s: the track failed.
- Compute elapsed time with `performance.now()` deltas, never by counting ticks (timers may be throttled, §7).

---

## 3. Preloading, cancelling and memory hygiene

- `preload` is **only a hint**. The values are `none`, `metadata` and `auto` (`""` means `auto`), the default
  differs per browser, and `autoplay` overrides it [MDN].
- **Idle element, 320 kbps / 9.6 MB MP3, after 2.5 s [LAB]:**

  | `preload` | Requests | Buffered |
  |---|---|---|
  | `none` | none | 0 |
  | `metadata` | one | about 5 s (about 200 KB) |
  | `auto` | one | about 85 s (about 3.4 MB), then suspended |

  This matches the Chromium buffer maths:
  - preload window `clamp(10 s × bitrate, 2 MB, 50 MB)`, plus up to 10 % of the bytes read, plus a 1 MB
    high-water mark;
  - `metadata` shifts it right by 6 bits (about 48 KB) [SRC-C `multi_buffer_data_source.cc`].
- Firefox reads ahead **60 s** and resumes below 30 s (`media.cache_readahead_limit`,
  `media.cache_resume_threshold`) [SRC-G].
- iOS caps non-unlocked elements at `metadata` [SRC-W].
- **Consequence:** no mainstream browser downloads a whole 4-minute track up front. **Later Range requests
  hit the signed URL mid-track** (§4).
- **Bounded-prefetch rules:**
  - At most 1 idle next-track element plus 1 idle next-announcement element, both `preload="auto"`.
  - Set the next track's `src` only after the current item has been `playing` for about 5 s, so it does not
    compete with the current item's startup buffer.
  - Set the announcement's `src` only when it is due at the next transition.
- **Cancel an in-flight download** with `unloadMedia(el)`: `pause(); removeAttribute('src'); load();`.
  - [LAB] verified: the server saw the connection close early, the element fired `abort` and `emptied`,
    `networkState` went to 0, and any pending `play()` rejected with `AbortError`.
  - `el.src = ''` instead produces **`error` code 4 "Empty src attribute"** [LAB]. That would trip our error
    handling.
- **On genre change, stop or destroy:**
  - bump the generation;
  - abort the `AbortController`s for sign/list fetches;
  - `unloadMedia` every pooled element that is not intentionally kept;
  - clear the fade and watchdog timers.
- **On `destroy()` (logout):**
  - `unloadMedia` every element and remove every listener;
  - drop the element references;
  - clear the Media Session;
  - release the wake lock.
- Never create an element per track. Pooling bounds memory and decoder count, and keeps the WebKit unlock.
- **Re-validate before promotion without throwing away the buffer:**
  - If `/api/media/sign` confirms the track is still eligible and the **existing** URL's `expiresAt` is still
    enough (§4.1), keep the element's current `src`.
  - Swapping to a newly signed URL means a new load. The token query differs, so it is a cache miss, and the
    preloaded buffer is lost.
  - Have the endpoint return `expiresAt`, and only swap when the existing URL's lifetime is short.

---

## 4. Signed URL expiry, network errors and recovery

### 4.1 What happens

- **Supabase Storage [SRC-S]:**
  - An expired or invalid download token returns **HTTP 400** with a JSON body: `InvalidJWT`, or
    `ExpiredToken` "The provided token has expired.". It is not a 403.
  - Signed objects support `Accept-Ranges: bytes` / `Content-Range` (206) and send `Expires` = token expiry.
  - CORS is not set by the storage server itself ("kong should take care of cors"). The hosted gateway's
    `Access-Control-Allow-Origin` is **UNVERIFIED**: there are no credentials to test with.
- **Error code depends on `readyState` when the fetch fails** (the same mapping in Chrome
  `MediaLoadingFailed` [SRC-C] and Firefox `NetworkError()` [SRC-G]):
  - `readyState ≥ HAVE_METADATA` → `MEDIA_ERR_NETWORK` (**2**). [LAB]: the URL expired during playback; a
    later seek made a new Range request, which got 400, then `error` code 2, "PIPELINE_ERROR_READ".
  - `HAVE_NOTHING` → `MEDIA_ERR_SRC_NOT_SUPPORTED` (**4**), and `play()` rejects with `NotSupportedError`.
    [LAB]: an already-expired URL, and a plain 404, both give code 4 "MEDIA_ELEMENT_ERROR: Format error".
    **Code 4 cannot tell "expired/403/404" from "bad file" or "CORS".**
  - WebKit mapping: UNVERIFIED. Handle both codes the same way everywhere.
- Codes [MDN/SPEC]: 1 `MEDIA_ERR_ABORTED`, 2 `MEDIA_ERR_NETWORK`, 3 `MEDIA_ERR_DECODE`,
  4 `MEDIA_ERR_SRC_NOT_SUPPORTED`. `MediaError.message` is diagnostic only.

### 4.2 Proactive rules

- Before starting an item: re-sign if `expiresAt - now < duration + 120 s` (ARCHITECTURE §9). Use
  `duration` from metadata or from the DB.
- **On resume after a pause:** if `expiresAt - now < (duration - currentTime) + 120 s`, run
  `reloadAt(el, freshUrl, el.currentTime)` before `play()`. Long pauses are the common way to cross the TTL
  mid-track.

### 4.3 Recovery pattern

**Verified [LAB]:** after a code-2 error at 200 s, `el.src = fresh; el.currentTime = 120; play()`:

- fired `abort → emptied → play → waiting → loadstart → loadedmetadata → seeking → seeked → playing`;
- made one Range request at the right byte offset;
- resumed at 120 s.

Setting `currentTime` while `readyState` is `HAVE_NOTHING` sets the "default playback start position" [SPEC].
Assigning a new `src` also resets `paused` to `true` [LAB], so call `play()` again.

| `classifyMediaError(el)` | Action (per item, max 2 recoveries, then exclude the track for the session and advance) |
|---|---|
| `network` (2) | `pos = el.currentTime` → re-sign (the server re-checks eligibility) → `reloadAt(el, url, pos)` → `safePlay`. If the sign call itself fails with a network error: status `error(network)`, bounded retry with backoff, plus a retry on `online`. |
| `source` (4) | Re-sign once and retry from the same position. It is probably an expired URL, a 4xx or CORS. If it fails again, treat it as a bad file: exclude it and advance. |
| `decode` (3) | Exclude it and advance. Do not retry. |
| `aborted` (1) | Ignore if engine-initiated. Otherwise treat it like `network`. |
| Sign returns 401 | `auth_expired`: stop and ask the user to sign in. |
| Sign returns 403/404 (no longer eligible) | Exclude it and advance. |

Announcement failures skip straight to music. `min(5, poolSize)` consecutive failures put the engine
in `error(catalogue_unavailable)` (ARCHITECTURE §9).

---

## 5. Short fades

### 5.1 Recommendation: element `volume` ramps, not Web Audio

| | `el.volume` ramp (chosen) | Web Audio `GainNode` via `createMediaElementSource` |
|---|---|---|
| Works cross-origin without CORS | Yes | **No.** The node must output **silence** for CORS-cross-origin media [SPEC]. [LAB]: without `crossOrigin` the peak level was **0.000** while `play()` resolved and every event said "playing". |
| If `crossOrigin="anonymous"` is set but the server lacks CORS | Only relevant if we set it | **The load fails entirely**: code 4 and `NotSupportedError` [LAB]. |
| Autoplay | Element policy only | Plus `AudioContext`: starts `suspended`, "allowed to start" only with sticky activation [SPEC], and must be `resume()`d in a gesture. |
| Binding | None | One source node per element for the element's lifetime: the second call throws `InvalidStateError` [LAB, SRC-C]. The element's audio is rerouted into the graph for good [MDN]. |
| iPhone | Volume locked: no fades, no gain | It would work (UNVERIFIED on a device), but only with CORS plus context management. |
| Hidden tab | Timer ramps still finish (see 5.2) | Scheduled `linearRampToValueAtTime` runs on the audio clock, which is good but not worth the risks above. |

**Decision for v1:**

- Use `el.volume` ramps only when `detectVolumeWritable()` is true and the page is visible.
- Otherwise switch instantly (sequential playback). This is always correct, and fades are cosmetic.
- Do **not** set `crossOrigin` on media elements. Nothing in v1 reads the samples.
- Revisit Web Audio only after the hosted Supabase CORS headers are confirmed and there is a strong need
  (for example iPhone announcement gain). Prefer loudness-normalising announcement files server-side instead.

### 5.2 Ramp mechanics

- Drive the ramp with `setInterval(…, 20)`, and compute `k = (performance.now() - t0) / duration` on **every tick**.
  - A throttled tick (1 s, or even 1 min in a hidden tab) then simply finishes the ramp at its target.
  - `requestAnimationFrame` **stops in background tabs** [MDN, Chrome blog]. A rAF fade would hang
    mid-volume in a hidden tab.
- If `document.visibilityState === 'hidden'` at the start or at any tick, jump to the target and resolve.
- Clamp values to [0, 1]. Out-of-range values throw `IndexSizeError` [SRC-W `setVolume`].
- Cancel with an `AbortSignal`. Every skip, pause, genre change or destroy aborts the running fade before
  starting a new action.
- [LAB] measured: 250 ms target → 267 ms actual, samples 0.15 → 0.83 → 0.85. An abort left the volume
  mid-way (0.59). Hiding mid-ramp finished within 21 ms at the target.
- Element volume = `master × gain` (ARCHITECTURE §9). A fade multiplies on top of that:
  `el.volume = master × gain × fadeFactor`.

### 5.3 The "volume 0" traps

- **WebKit:** the play gate skips silent elements (`!muted && volume` in
  `playbackStateChangePermitted`) [SRC-W].
  - So `play()` at `volume = 0` **succeeds even on a locked element**.
  - The first non-zero volume step outside a gesture then **pauses** the element and rejects its promises
    with `NotAllowedError` [SRC-W `setVolume`]. The result is a silent, confusing stop mid fade-in.
  - **Start fade-ins at ≥ 0.02 (× target), never 0.** Any autoplay block then surfaces at `play()` as a
    clean `blocked`.
- **Chrome Android:** `kPauseMutedBackgroundAudio` is **enabled by default on Android**. A hidden page with a
  playing element at `volume == 0` gets paused [SRC-C].
  - Never leave an element playing at volume 0.
  - A fade-out ends with `pause()` in the same tick.
  - The Mute feature uses `el.muted` (the UI shows "Muted").
  - Still handle an unexpected `pause` if the tab is hidden while muted. UNVERIFIED whether `muted` triggers
    it; the check reads the effective volume.

---

## 6. Media Session API

- **Support [BCD]:** Chrome 73 (Android 57), Firefox 82, Safari 15; `setPositionState` Chrome 81.
- **Feature-detect** with `'mediaSession' in navigator`.
- **TS 5.9 types:**
  - `MediaSessionAction` = `nexttrack | pause | play | previoustrack | seekbackward | seekforward | seekto | skipad | stop`.
  - `MediaSessionPlaybackState` = `none | paused | playing`.
  - `setPositionState(state?: MediaPositionState): void`.
  - `setActionHandler(action, handler | null)`.
- **`setActionHandler`:**
  - An unsupported action name throws `TypeError` ("…not a valid enum value of type MediaSessionAction") [LAB].
  - Wrap each call in try/catch [MDN].
  - Pass `null` to remove a handler.
- **`playbackState`** is a *hint* for the OS UI. It does not control the media. An invalid value is silently
  ignored [LAB].
  - Set it from the engine's truth: `playing` only when "actually playing" holds; `paused` for
    paused/blocked/buffering-after-pause; `none` when idle or destroyed.
- **`metadata = new MediaMetadata({ title, artist, album, artwork: [{ src, sizes, type }] })`**:
  - relative artwork `src` values are resolved to absolute URLs [LAB];
  - use `album` for the station/venue name;
  - use the venue logo as artwork only if it is a stable URL (a signed logo URL that expires breaks the
    artwork later, so use a long TTL or the default icon).
  - Set `metadata = null` on destroy.
- **`setPositionState`** throws `TypeError` for a `NaN` duration (before metadata) and for position > duration.
  `Infinity` is accepted [LAB]. For a radio, **do not set it** (or clear it with `setPositionState()`), so
  the OS doesn't offer seeking.
- **Handlers:**
  - `play` → `engine.resume()`; `pause` and `stop` → `engine.pause()`; `nexttrack` → `engine.skip()`.
  - `previoustrack`, `seekto`, `seekbackward` and `seekforward` are set to `null`.
  - Without our handlers the browser toggles the element directly, bypassing the engine.
- **Activation:** Chromium **grants user activation** for Media Session actions **except pause/stop**
  [SRC-C `media_session.cc`], so a hardware Play key can start audio. WebKit: UNVERIFIED. Always handle
  `NotAllowedError` from a Media Session `play`.
- The OS or UA can pause without calling our handler (headphones removed, a call). That arrives as a plain
  `pause` event (§2.1).

---

## 7. Background tabs, timers, freezing and device sleep

**Chrome timer throttling** [Chrome blog "timer-throttling-in-chrome-88", MDN]:

- **Minimal** (normal): the page is visible, **or made sound in the last 30 s**.
- **Throttled:** timers are checked **once per second** while the page is hidden.
- **Intensive:** timers are checked **once per minute** when all of these hold:
  - the page has been hidden for more than 5 min;
  - the timer chain count is 5 or more;
  - the page has been **silent** for 30 s or more;
  - there is no WebRTC.
- rAF waits for visibility.
- Firefox desktop clamps inactive-tab timers to 1 s minimum. Firefox Android uses 15 min and may unload the tab.
  Tabs playing audio are treated as foreground [MDN].

**Consequences for us:**

- While music plays, our timers run normally, even in a hidden tab.
- During a **silent** failure in a hidden tab (a buffering stall, an error, the gap while re-signing), the 15 s
  and 45 s watchdogs can fire up to about 1 s late, and after 5 hidden minutes up to about 1 min late.
  - Mitigation: rely on media events (`waiting`, `error`, `ended`, `pause`), which are not timer-throttled.
  - Mitigation: compute elapsed time with `performance.now()`.
  - Mitigation: run a catch-up `check()` on `visibilitychange` → `visible`.
- **Fades:** skip them when hidden (§5.2).

**Freezing and discarding:**

- Chrome freezes or discards hidden tabs to save resources, but **not** pages observed playing audio, except
  under critical memory pressure [Page Lifecycle].
- A *paused* player in a background tab can be frozen or discarded. On return, `document.wasDiscarded` is true
  after a reload, and the player must show "Start".
- Don't rely on `unload`/`beforeunload`. Use `visibilitychange` and `pagehide`.

**Device sleep, and what to state honestly** (the prompt requires this):

- System sleep, lid close, browser quit, OS memory kills, low-power modes and mobile background policies can
  stop audio.
- Media can stop without our JS running. We can't prevent that and can't promise continuity.
- On wake we typically see one of: an `error` (network changed; a Range request failed; the URL may have
  expired), an external `pause`, or a frozen `currentTime`. The engine then shows `paused` or `error` with a
  Retry/Resume button. It never shows "playing".
- Suggested UI or help text: "Keep this tab open and the device awake and plugged in. Audio stops if the
  computer sleeps, the browser closes, or a phone or tablet suspends the browser. The player always shows
  when audio has stopped."
- **Optional mitigation (UNVERIFIED in our app): Screen Wake Lock.**
  - Call `navigator.wakeLock.request('screen')` while the player is visible and playing.
  - Support: Chrome 84, Firefox 126, Safari 16.4, iOS Safari 18.4 [BCD]. It needs a secure context.
  - It rejects with `NotAllowedError` when the page is hidden or the battery is low [MDN].
  - The lock is released when the page is hidden. Re-request it on `visibilitychange` → `visible`.
  - It only stops *screen* sleep. It does not stop system sleep on a closed laptop.

---

## 8. `online` / `offline`

- `navigator.onLine` and the `online`/`offline` events on `window` are **heuristics** [MDN].
  - A LAN connection counts as online without internet access.
  - On Windows, the status depends on reaching a Microsoft server.
  - "You should not disable features based on the online status."
- **On `offline`:**
  - Don't stop playback. Buffered audio keeps playing (Chrome about 85 s at 320 kbps [LAB]; Firefox up to 60 s).
  - Set a `connectionSuspect` flag ("Connection lost — playing buffered audio") and pause any prefetch or
    list refresh.
- **On `online`:** if the status is `error(network)`, retry immediately (re-sign → `reloadAt` → `play`).
  Clear the flag.
- **Independently of events,** retry network errors with bounded backoff (for example 2 s, 5 s, 10 s, 30 s,
  then stop with Retry), because the events can be wrong in both directions. `fetch` rejecting with a
  `TypeError` is a network failure, not an HTTP error.

---

## 9. Keyboard and screen-reader accessibility

- **Native `<button>`s** give Space/Enter activation for free [APG].
- **Play/Pause** changes its label ("Play" ↔ "Pause"), so **do not use `aria-pressed`** [APG: if the label
  changes, it is not a toggle].
- **Mute** keeps a fixed label "Mute" with `aria-pressed={muted}` [APG].
- **Volume:** `<input type="range">` with `aria-label="Volume"` and `aria-valuetext="60%"`.
- **Status:**
  - Use one visually hidden `role="status"` element (implicitly `aria-live="polite"` and `aria-atomic="true"`)
    [MDN]. It must be **in the DOM, empty, before** the first update, so render it at mount.
  - Announce state transitions and the now-playing title only: "Playing: Title – Artist", "Paused",
    "Buffering…" (only if it lasts more than 2 s), "Connection lost", "Audio blocked by the browser. Press
    Start audio.", "Stopped: …".
  - Never announce progress. Avoid `assertive` [MDN].
- **Shortcuts on the player page:** Space and K play/pause, M mute, N skip (ARCHITECTURE §10).
  Use `playerShortcutFor(e)` from §11 [LAB-tested]. It ignores:
  - events that already had `defaultPrevented`;
  - `repeat` and IME composition;
  - any Ctrl/Meta/Alt chord;
  - text-entry targets (`input`, `textarea`, `select`, contenteditable, textbox/combobox/slider/spinbutton roles);
  - Space when focus is on something Space activates (a button, link, summary or `role=button/switch/…`).
    Otherwise the button toggles on keyup **and** we toggle on keydown: a double toggle.
- **Wiring the shortcuts:**
  - Call `preventDefault()` only when handled, so Space doesn't scroll the page.
  - Also ignore keys while a modal dialog is open (for example `document.querySelector('[aria-modal="true"]')`).
  - Listen on `document` from the player page's client component. Remove the listener on unmount.
- **WCAG 2.2 SC 2.1.4 Character Key Shortcuts (Level A):** single-character shortcuts (K, M, N) need a
  way to **turn them off or remap them**, or must be active only when the component has focus.
  - Add a "Keyboard shortcuts" switch (per-viewer `localStorage`, wrapped in try/catch) and list the keys
    next to it.
  - A keydown is an activation-triggering input [SPEC], so Space/K may call `play()` directly. Call it
    synchronously in the handler.
- Keep focus rings visible and never move focus automatically, even when the "Start audio" button appears.
  Announce it via the status region instead. Respect `prefers-reduced-motion` for any equaliser or animation.

---

## 10. React 19 / Next 16 integration notes

- **The engine is plain TS and owns its elements.**
  - Create them with `document.createElement('audio')`, never in JSX and never during render (SSR has no
    `window`).
  - Detached elements play fine: every [LAB] test used detached elements.
  - Removing a *playing* element from the document pauses it (Chrome AbortError "…removed from the
    document") [SRC-C]. Never insert and remove them.
- **Expose state with `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`** [@types/react 19.3.0
  signature verified]. `getSnapshot` must return the **same object until state changes**, or React loops
  ("The result of getSnapshot should be cached") [react.dev].
  - Keep `subscribe` stable (a bound method created once), or React re-subscribes on every render.
  - `getServerSnapshot` is required for SSR'd client components.
- **Strict Mode (on by default in the App Router)** mounts, unmounts and mounts effects in dev
  (`docs/research/nextjs-16.md` §6).
  - `destroy()` is idempotent.
  - Construct the engine without side effects, and create the element pool lazily in `start()`, inside the
    gesture, which is also the WebKit unlock.
- **Register listeners once per pooled element.**
  - Each handler first checks `el === this.current` (or the element's role) **and** the captured generation.
  - A `playing` event from a non-current element pauses that element (the exclusivity invariant).
- **Wire commands straight from event handlers** (`onClick={() => engine.togglePlay()}`) so `play()` runs
  inside the gesture. Don't route them through state plus `useEffect`, which loses the gesture on WebKit
  older than transient-activation support.

---

## 11. Reference helpers ([TSC] + [LAB])

The file is `media-utils.ts` (scratchpad). The suggested home is `src/lib/player/media.ts`. It was
typechecked with the project's TS 5.9.3 in strict mode. [LAB] results in Chromium 152:

| Check | Result |
|---|---|
| `safePlay` → `playing` | pass |
| `safePlay` → `superseded` (after an immediate `pause()`) | pass |
| `safePlay` → `unsupported` (expired URL), and `classifyMediaError` → `source` | pass |
| `safePlay` → `timeout` (no `src`) | pass |
| `rampVolume` timing, abort and hidden jump | pass (see §5.2) |
| `detectVolumeWritable` | `true` |
| `ProgressTracker.isAudible` | playing `true`, paused `false` |
| `playerShortcutFor` | Space on body → toggle, Space on button → null, `k` in input → null, `K` → toggle, Ctrl+K → null, repeat → null |
| Media Session bind, update and cleanup | pass |

```ts
export type PlayOutcome =
  | { kind: 'playing' }
  | { kind: 'blocked' } // NotAllowedError: needs a user gesture (autoplay policy)
  | { kind: 'superseded' } // AbortError: interrupted by pause()/load()/src change/UA pause
  | { kind: 'unsupported' } // NotSupportedError: source failed (4xx/expired URL/CORS/bad file)
  | { kind: 'timeout' } // promise still pending (e.g. no src, or never reached playable)
  | { kind: 'failed'; error: unknown };

export function classifyPlayError(err: unknown): PlayOutcome {
  const name =
    typeof err === 'object' && err !== null && 'name' in err ? (err as { name: unknown }).name : undefined;
  switch (name) {
    case 'NotAllowedError':
      return { kind: 'blocked' };
    case 'AbortError':
      return { kind: 'superseded' };
    case 'NotSupportedError':
      return { kind: 'unsupported' };
    default:
      return { kind: 'failed', error: err };
  }
}

/**
 * Calls el.play() synchronously (an async function runs synchronously up to its first await), so
 * calling safePlay() directly inside a click/keydown handler keeps the user gesture.
 * Never throws. A late settle after 'timeout' is ignored by the caller's generation check.
 */
export async function safePlay(el: HTMLMediaElement, timeoutMs = 15_000): Promise<PlayOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const played = el.play().then((): PlayOutcome => ({ kind: 'playing' }), classifyPlayError);
    const timedOut = new Promise<PlayOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    });
    return await Promise.race([played, timedOut]);
  } catch (err) {
    return classifyPlayError(err);
  } finally {
    clearTimeout(timer);
  }
}

/** Cancel any in-flight download and release the decoder. Never use `el.src = ''` (fires error code 4). */
export function unloadMedia(el: HTMLMediaElement): void {
  el.pause();
  if (el.hasAttribute('src')) el.removeAttribute('src');
  el.load(); // aborts fetch; fires abort+emptied if a resource was loaded; networkState -> NETWORK_EMPTY
}

/**
 * WebKit (iOS) keeps a per-element "user gesture required" restriction. load()/play() on an element
 * while a gesture is being processed removes it (WebKit prepareForLoad/play ->
 * removeBehaviorRestrictionsAfterFirstUserGesture). Call synchronously in the Start click handler,
 * before any await, on pooled elements that are idle.
 */
export function unlockIdleMediaElements(els: readonly HTMLMediaElement[]): void {
  for (const el of els) {
    if (!el.hasAttribute('src') && el.networkState === HTMLMediaElement.NETWORK_EMPTY) el.load();
  }
}

/** Reload a (fresh) URL and resume from `position` seconds. Follow with safePlay(el). */
export function reloadAt(el: HTMLMediaElement, url: string, position: number): void {
  el.src = url; // load algorithm: abort+emptied, paused=true, pending play() promises reject AbortError
  if (Number.isFinite(position) && position > 0) el.currentTime = position; // HAVE_NOTHING: default start position
}

export type MediaFailure = 'aborted' | 'network' | 'decode' | 'source' | 'unknown';

export function classifyMediaError(el: HTMLMediaElement): MediaFailure | null {
  const e = el.error;
  if (!e) return null;
  switch (e.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'aborted';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'network'; // failed after metadata (e.g. expired signed URL on a later Range request)
    case MediaError.MEDIA_ERR_DECODE:
      return 'decode';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'source'; // failed before metadata: 4xx/expired URL/CORS/unsupported file
    default:
      return 'unknown';
  }
}

/**
 * Element volume is ignored on iPhone (WebKit locks it; the assignment is reverted in a queued task,
 * so a synchronous read-back lies). Probe asynchronously once and cache the result.
 */
export async function detectVolumeWritable(): Promise<boolean> {
  const probe = document.createElement('audio');
  try {
    probe.volume = 0.5;
  } catch {
    return false;
  }
  if (probe.volume !== 0.5) return false;
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
  return probe.volume === 0.5;
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/**
 * Linear volume ramp driven by wall-clock time, so a throttled timer (hidden tab: 1 s or 1 min
 * alignment) still finishes on its next tick. requestAnimationFrame is NOT used: it does not run in
 * hidden tabs. Resolves when done or aborted (volume left where it is on abort).
 */
export function rampVolume(
  el: HTMLMediaElement,
  to: number,
  durationMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const target = clamp01(to);
  const from = el.volume;
  if (signal?.aborted) return Promise.resolve();
  if (durationMs <= 0 || from === target || document.visibilityState === 'hidden') {
    el.volume = target;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    const finish = () => {
      clearInterval(id);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / durationMs);
      el.volume = clamp01(from + (target - from) * k);
      if (k >= 1 || document.visibilityState === 'hidden') {
        el.volume = target;
        finish();
      }
    }, 20);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * "Actually audible" = element not paused, not ended, no error, has future data, and currentTime
 * advanced recently. `paused` alone lies: it stays false while buffering ('waiting') and after a
 * mid-playback MEDIA_ERR_NETWORK.
 */
export class ProgressTracker {
  private lastTime = -1;
  private lastAdvanceAt = 0;

  constructor(private readonly el: HTMLMediaElement) {}

  /** Call from 'timeupdate' and from a 1 s watchdog tick. */
  sample(now = performance.now()): void {
    const t = this.el.currentTime;
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.lastAdvanceAt = now;
    }
  }

  /** Reset when a new item starts, after a seek, or on 'playing'. */
  reset(now = performance.now()): void {
    this.lastTime = this.el.currentTime;
    this.lastAdvanceAt = now;
  }

  msSinceAdvance(now = performance.now()): number {
    return now - this.lastAdvanceAt;
  }

  isAudible(now = performance.now(), graceMs = 2_000): boolean {
    const el = this.el;
    return (
      !el.paused &&
      !el.ended &&
      el.error === null &&
      el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
      !el.muted &&
      this.msSinceAdvance(now) < graceMs
    );
  }
}

export type PlayerShortcut = 'toggle' | 'mute' | 'skip';

const TEXT_ENTRY =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [role="slider"]';
const SPACE_ACTIVATES =
  'button, a[href], summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="tab"], [role="option"]';

/** Map a keydown to a player command, or null if the key belongs to something else. */
export function playerShortcutFor(e: KeyboardEvent): PlayerShortcut | null {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(TEXT_ENTRY)) return null;
  if (e.key === ' ') return target?.closest(SPACE_ACTIVATES) ? null : 'toggle';
  switch (e.key.toLowerCase()) {
    case 'k':
      return 'toggle';
    case 'm':
      return 'mute';
    case 'n':
      return 'skip';
    default:
      return null;
  }
}

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  nexttrack(): void;
}

/** Registers handlers (each in try/catch: unsupported actions throw TypeError). Returns cleanup. */
export function bindMediaSession(h: MediaSessionHandlers): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => {};
  const ms = navigator.mediaSession;
  const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
    ['play', () => h.play()],
    ['pause', () => h.pause()],
    ['stop', () => h.pause()],
    ['nexttrack', () => h.nexttrack()],
    // A radio has no seeking or "previous": make sure no default/stale handler lingers.
    ['previoustrack', null],
    ['seekto', null],
    ['seekbackward', null],
    ['seekforward', null],
  ];
  for (const [action, handler] of actions) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action not supported by this browser */
    }
  }
  return () => {
    for (const [action] of actions) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
    ms.metadata = null;
    ms.playbackState = 'none';
  };
}

export interface NowPlaying {
  title: string;
  artist: string;
  album: string; // station / venue name
  artworkUrl?: string;
}

export function updateMediaSession(now: NowPlaying | null, state: MediaSessionPlaybackState): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.metadata = now
    ? new MediaMetadata({
        title: now.title,
        artist: now.artist,
        album: now.album,
        artwork: now.artworkUrl ? [{ src: now.artworkUrl, sizes: '512x512', type: 'image/png' }] : [],
      })
    : null;
  ms.playbackState = state;
}
```

**Notes on the helpers**

- `safePlay` must be *called* inside the gesture handler. Awaiting its result afterwards is fine.
- `detectVolumeWritable` iPhone behaviour is inferred from WebKit source. It is **UNVERIFIED on a device**.
- `unlockIdleMediaElements` relies on WebKit `load()` → `prepareForLoad()` removing the restriction while
  `processingUserGestureForMedia()` [SRC-W]. It is **UNVERIFIED on a device**. Fallback if field reports
  show it failing on an iOS version: in the same synchronous handler, `play()` a tiny silent clip on each idle
  element and `pause()` it when the promise settles.
- In the engine, `rampVolume` multiplies by the master volume and gain. Start fade-ins at `max(0.02 × target, …)`
  (§5.3).

---

## 12. PlayerEngine checklist

**Gesture and autoplay**

- [ ] `start()`/`resume()`/`togglePlay()` are called directly from click/keydown/Media Session handlers. The
      first `play()`, or the pool unlock, happens synchronously before any `await`.
- [ ] Start creates the 3-element pool if it is missing and runs `unlockIdleMediaElements(pool)` synchronously.
      Elements are reused for the whole session and never created per track.
- [ ] All `play()` calls go through `safePlay` with a timeout. The outcome is handled by `kind`, never by
      message.
- [ ] `blocked` means a status of `blocked` plus a "Start audio" button (click → synchronous `play()` of
      the current element), announced in the status region.
- [ ] `superseded` is never shown as an error. The engine reconciles with the element state and the
      generation; an unrequested pause means `paused`.
- [ ] At bootstrap, if `navigator.userActivation?.hasBeenActive !== true`, show "Start Radio" without
      trying `play()`. Saved genre and volume are restored, but audio waits for the gesture.

**Truth and events**

- [ ] `playing` is shown only when "actually playing" holds (§2.2). `play` and `canplay*` never set
      `playing`.
- [ ] A `pause` with `el.ended === true` is ignored (the `ended` event follows). Any other unrequested
      `pause` becomes the `paused` (external) status plus a Media Session update.
- [ ] `error` is handled even though `paused` stays `false`. After an error the status is never `playing`.
- [ ] `waiting` before the first `playing` of an item means `loading`; after it, `buffering`. `stalled` is
      informational only.
- [ ] Watchdog: no progress for more than 15 s means re-sign plus `reloadAt` once; more than 45 s means
      the track failed. Elapsed time comes from `performance.now()`, and a catch-up check runs on
      `visibilitychange`.
- [ ] Exclusivity: before any `play()`, pause every other pooled element. A `playing` event from a
      non-current element pauses that element.
- [ ] Every async continuation checks its captured generation (and `el === current`) before touching state.

**Preload and cancel**

- [ ] At most 1 next track and 1 next announcement are preloaded (`preload="auto"`). The next track's
      `src` is set only after the current item has played for about 5 s.
- [ ] Cancel with `unloadMedia` (`pause` + `removeAttribute('src')` + `load()`), never `src = ''`. Runs on
      genre change, stop, destroy, and when a preloaded item becomes ineligible.
- [ ] Re-validation keeps the existing `src` when its `expiresAt` still covers `duration + 120 s`, so the
      preloaded buffer is not lost.
- [ ] Item identity is tracked by the engine, not by `currentSrc` (which is stale after an unload).

**Expiry and errors**

- [ ] Before start: re-sign if `expiresAt - now < duration + 120 s`. On resume: re-sign if
      `expiresAt - now < remaining + 120 s`, then `reloadAt(el, url, currentTime)`.
- [ ] Code 2: re-sign plus `reloadAt(pos)`. Code 4: re-sign plus one retry, then exclude. Code 3: exclude.
      At most 2 recoveries per item. After `min(5, pool)` consecutive failures, `error` with Retry.
- [ ] Sign 401 means `auth_expired`. Sign network failure means `error(network)` with bounded backoff and a
      retry on `online`. `offline` alone never stops playback.

**Volume and fades**

- [ ] Run `detectVolumeWritable()` once (async). If false: no fades, hide or disable the volume slider,
      and note that announcement gain is not applied on this device.
- [ ] Fades: 250 ms in and 300 ms out via `rampVolume` (interval plus wall clock), only when writable and
      visible. Every fade is aborted by the next command. Fade-in starts at ≥ 0.02 × target, never 0.
- [ ] A fade-out ends with `pause()` in the same tick. No element is left playing at volume 0. Mute uses
      `el.muted`.
- [ ] No `crossOrigin` attribute and no Web Audio in v1.

**Media Session, background and sleep**

- [ ] `bindMediaSession({ play: resume, pause, nexttrack: skip })`. Previous and seek actions are set to
      `null`. `setPositionState` is not used.
- [ ] `updateMediaSession(nowPlaying, state)` runs on every status or item change. `destroy()` calls the
      cleanup (metadata `null`, state `none`).
- [ ] Nothing uses rAF for audio logic.
- [ ] Docs and UI state the sleep and background limits honestly. Optional: a Screen Wake Lock while
      visible and playing, re-acquired on `visibilitychange`.

**UI and accessibility**

- [ ] Play/Pause changes its label (no `aria-pressed`). Mute keeps a fixed label with `aria-pressed`.
      Volume is a range with `aria-valuetext`.
- [ ] A `role="status"` region is rendered empty at mount. Only transitions and the now-playing title are
      announced, and buffering is debounced.
- [ ] Shortcuts use `playerShortcutFor`. There is a "Keyboard shortcuts" off switch (WCAG 2.1.4), no
      handling while a modal is open, and `preventDefault` only when handled.

**Lifecycle**

- [ ] `destroy()` is idempotent (Strict Mode). It unloads every element, removes listeners, aborts
      controllers, clears timers, clears the Media Session, releases the wake lock, and clears the
      per-session welcome key.
- [ ] The engine is exposed via `useSyncExternalStore` with a cached snapshot, a stable `subscribe`, and a
      `getServerSnapshot`.

---

## 13. Sources

- MDN:
  - Autoplay guide: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
  - `HTMLMediaElement`, `play()`, `readyState`, `networkState`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement
  - `MediaError.code`: https://developer.mozilla.org/en-US/docs/Web/API/MediaError/code
  - `<audio>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio
  - User activation: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation
  - `getAutoplayPolicy`: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getAutoplayPolicy
  - `createMediaElementSource`: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource
  - `MediaSession` and `setActionHandler`: https://developer.mozilla.org/en-US/docs/Web/API/MediaSession
  - Page Visibility: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
  - `setTimeout` delays: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
  - `navigator.onLine`: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
  - `WakeLock.request`: https://developer.mozilla.org/en-US/docs/Web/API/WakeLock/request
  - `aria-live`: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live
- WHATWG HTML:
  - Media elements: https://html.spec.whatwg.org/multipage/media.html
  - User activation: https://html.spec.whatwg.org/multipage/interaction.html
- Web Audio: https://webaudio.github.io/web-audio-api/ (source `index.bs`: "allowed to start", and
  "MediaElementAudioSourceNode … MUST output silence" for CORS-cross-origin media)
- Chrome:
  - https://developer.chrome.com/blog/autoplay
  - https://developer.chrome.com/blog/play-request-was-interrupted
  - https://developer.chrome.com/blog/timer-throttling-in-chrome-88
  - https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- WebKit:
  - https://webkit.org/blog/6784/new-video-policies-for-ios/
  - https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/
- W3C:
  - APG Button pattern: https://www.w3.org/WAI/ARIA/apg/patterns/button/
  - WCAG 2.2 Understanding 2.1.4: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
- React: https://react.dev/reference/react/useSyncExternalStore
- Engine sources read on GitHub mirrors:
  - `chromium/chromium` main
  - `WebKit/WebKit` main @4d1f8e8e
  - `mozilla-firefox/firefox` main
  - `supabase/storage` master
  - `mdn/browser-compat-data` main
