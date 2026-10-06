# Testing & verification record

This file records which checks were **actually run**, and which still need real credentials, real
devices or manual validation. Keep it honest: update it whenever a check is added or re-run.

## 1. How to run the checks

| Check | Command |
| --- | --- |
| Everything (typecheck, lint, tests, build) | `npm run check` |
| Unit + integration tests | `npm test` |
| Database / Row Level Security tests only | `npx vitest run tests/db` |
| Typecheck | `npm run typecheck` (runs `next typegen` first) |
| Lint | `npm run lint` |
| Production build | `npm run build` |

If npm cannot spawn a shell (seen in some sandboxed Windows terminals: `spawn cmd.exe ENOENT`),
call the tools through Node directly, e.g. `node node_modules/vitest/vitest.mjs run`,
`node node_modules/next/dist/bin/next build`, `node node_modules/typescript/bin/tsc --noEmit`,
`node node_modules/eslint/bin/eslint.js .`.

## 2. Latest automated run

Run on 2026-10-06 (Windows 11, Node 24.19):

| Check | Result |
| --- | --- |
| Typecheck (`next typegen` + `tsc --noEmit`) | 0 errors |
| Lint (`eslint .`) | 0 problems |
| Tests (`vitest run`) | **136 files, 2,209 tests — all passed** |
| Production build (`next build`) | succeeded |

### What the test suites cover

| Area | Folder | What is proven |
| --- | --- | --- |
| Database & security | `tests/db` | The real migrations are applied to an in-process PostgreSQL (PGlite) with Supabase auth/storage shims. Row Level Security is exercised as anonymous, venue and admin users: venues only see their own business, accessible genres, playable tracks and their **own** playable announcements; they cannot change their role or entitlements; storage policies block another venue's announcement files and covers of inaccessible genres; admin-only RPCs, rate-limit function, access requests and platform settings permissions. A mutation check (deliberately breaking each policy) confirmed the tests catch it. |
| Playback engine | `tests/player` | Deterministic tests with fake audio elements and a fake clock: welcome on first Start, an announcement after every N **completed** songs (skips and failures do not count), rotation without immediate repeats, Skip is music-only, genre change cancels pending work and keeps the paused state, pause during announcements, autoplay blocked → resume, bounded retries, whole-catalogue failure stops instead of looping, network recovery, signed-URL expiry refresh, removed tracks never played even when preloaded, "Coming up" matches what actually plays, and seeded random command spam that asserts **at most one audio element is ever playing**. |
| Player UI | `tests/player-ui` | Status copy for every state, station-voice preview state machine (pauses the radio, never touches the song counter, explicit resume), genre card semantics, keyboard shortcut rules, cross-tab venue change, server rendering of the radio/account/help screens. |
| Player & media API | `tests/api/player` | Every endpoint resolves the venue from the session only (a business id in the request is ignored), another venue's announcement or a track outside the genre → 404, stale branding → 404, rate limits, `Cache-Control: private, no-store`. |
| Uploads & announcements API | `tests/api/uploads`, `tests/api/announcements` | Signed upload tokens (tamper, expiry, wrong user, replay), server-side MP3/image validation with cleanup of rejected files, replacement ordering, AI generation locking, reuse without a paid request, provider failures keeping on-air audio. |
| Admin screens | `tests/admin` | Catalogue, genres, businesses (Active/Invited/Inactive), access requests, announcements studio, settings, unsaved-changes guard. |
| Auth & public site | `tests/auth`, `tests/public` | Login/reset/confirm flows, open-redirect protection (incl. a 5,000-input fuzz), client-IP policy and global caps, proxy rules, request-access form, privacy/terms rendering. |
| Libraries | `tests/lib` | MP3 validation (real encoded files, renamed WAV, random bytes, truncated and padded files), image sniffing, ElevenLabs client error classification and language rules, announcement templates and state rules, env parsing. |
| UI kit | `tests/ui` | Focus indicators are never cancelled, input border contrast ≥ 3:1, toast layer above modal dialogs, short-viewport shell reflow. |
| Scripts | `scripts/tests` | Demo-audio manifest, seed planning and safety checks, idempotent seeding against an in-memory Supabase fake, admin invite links. |

## 3. Live checks against the hosted Supabase project (2026-10-06)

- All four migrations applied cleanly to the hosted project (Supabase Postgres, region eu-west-1)
  with `npm run db:migrate` (recorded in `supabase_migrations.schema_migrations`).
- Row Level Security from outside: anonymous requests are refused (401 / 42501) on profiles,
  businesses, genres, tracks, announcements and access_requests; only platform_settings is readable
  (public contact and legal text, by design). All four storage buckets are private.
- `npm run admin:create -- <email> --link` created the owner's admin account; the owner opened the
  one-time link, chose a password on /reset-password and used the admin workspace (music, genres,
  announcements, media previews).
- `npm run seed:dev -- --yes --allow-remote` loaded 9 genres, 21 synthetic tracks, EmeraldBar and
  Hotel Aurora, and 6 approved announcements with audio; venue sign-in reached /radio.
- **End-to-end playback confirmed by the owner** (after the fix below): signed in as EmeraldBar on the
  hosted project, chose House, pressed Start Radio — welcome announcement, songs, the venue's own
  station announcement after the configured number of songs, then music continued.
- Live testing found one bug the unit tests could not: the venue shell imported its link list from a
  "use client" module, so on the real /radio page every venue link was undefined and the page crashed
  ("Failed prop type: href … undefined"). Fixed (`src/components/player/venue-links.ts`) and guarded by
  `tests/ui/server-client-boundary.test.ts`, which walks the server module graph and fails on any plain
  value imported from a client module (mutation-checked against the original bug).

## 4. Browser checks actually run

All in Chromium (the desktop app's built-in browser), against `next dev` on this machine:

- **Real audio sequence** (`/dev/player-lab`, EmeraldBar, House, "announcement every 2 tracks", 2026-10-06):
  Start → **welcome announcement** (+19 s) → song (+25 s) → song (+56 s) → **station announcement**
  (+78 s, "Good music. Good company…") → next song (+85 s), music continued automatically; Pause stopped
  playback. The next track's URL was signed a few seconds before each transition (eligibility re-check).
- **Visual comparison with the design pack** at 1440–1512 px: homepage, login, radio player, music
  library, businesses, announcements, genres; and at 390 px: radio player (two-column genres, mini
  player above Radio/Account tabs). Screens matched the supplied compositions.
- Component checks by the fix agents in Chromium: dropdown focus rings, toasts above an open drawer,
  short-viewport shell, unsaved-changes dialog from page links and the mobile drawer, upload queue
  stopping queued files when leaving the page, track checkbox hit area.

## 5. Not yet verified — needs real credentials, devices or manual checks

| Check | Why it is not done yet | What is needed |
| --- | --- | --- |
| Invite and password-reset **emails** | No SMTP provider yet (sign-in itself works) | Email templates + SMTP (SETUP.md §5) |
| Signed uploads from the browser to Supabase Storage (incl. CORS) | No Storage bucket yet | Supabase project |
| Storage RLS through the real Storage API (`createSignedUrl` with a venue's session) | Only the policies are tested, in PGlite | Supabase project |
| End-to-end: admin uploads music → venue logs in → hears its own announcement after 4 songs | Needs all of the above | Supabase project + a few MP3s |
| Second venue in the same genre hears only its own announcements (live) | Proven at DB/API level only | Supabase project + two venue accounts |
| ElevenLabs generation (models, languages, credits) | No API key | `ELEVENLABS_API_KEY` (paid plan for commercial use) |
| Safari / iPhone autoplay unlock, read-only volume, background behaviour | Only Chromium was available | A Mac with Safari and an iPhone |
| Firefox, Android | Not run | Real browsers/devices |
| Long sessions (signed URL refresh after 2 h, device sleep) | Not run | A real venue-style test session |
| Rate limits behind your production proxy | Depends on the host | Set `CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS` if not on Vercel |
