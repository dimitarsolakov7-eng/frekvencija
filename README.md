# Frekvencija

Frekvencija ([frekvencija.online](https://frekvencija.online)) is a personalised radio for hotels,
restaurants, cafés and bars. The platform owner keeps **one shared music catalogue** organised into
genres. Each venue signs in, picks a genre, presses **Start Radio**, and hears continuous shuffled
music with **its own** announcements between songs, for example "You're listening to EmeraldBar
Radio." Every venue runs its own independent playback session from the shared catalogue. It is not a
synchronised live broadcast.

The platform name is defined once in `src/config/platform.ts` (override it with
`NEXT_PUBLIC_PLATFORM_NAME`).

## Features

- **Venue radio** (`/radio`): the station name as the heading, genre cards, Start Radio / Play /
  Pause, Skip (music only), volume and mute, now playing, a read-only "Coming up" list, and a preview
  of the venue's own station voice. One audio controller persists across the venue pages
  (`/radio`, `/account`, `/help`). The last genre and volume are restored after sign-in. Playback
  states are shown honestly: blocked autoplay ("Tap to resume your radio."), buffering, network
  errors, an empty genre. Keyboard shortcuts, Media Session controls and an optional "Keep screen
  awake" switch are included.
- **Per-venue announcements**: an optional welcome plays on the first Start. After that, one
  announcement plays after every N **completed** songs (default 4; skipped or failed songs do not
  count), rotating between the venue's approved recordings. Clips come from an **uploaded MP3** or are
  **generated once with ElevenLabs** (optional, server-side) and saved, so playback never calls the
  voice provider. Every clip needs **Approve & activate** before it plays. When a venue's name,
  station name or pronunciation changes, its clips are flagged for review and stop playing until
  they are approved again. A venue never plays another venue's recordings, and if no valid clip
  exists the music simply continues.
- **Shared catalogue** (`/admin/music`): multi-file MP3 upload with per-file progress, server-side
  validation and cancel/retry. Tracks can have their details edited, be assigned to several genres,
  be previewed, have their file replaced, and be deactivated or removed from playback. Changes reach
  venues without a redeploy; a song that is already playing finishes.
- **Genres** (`/admin/genres`): create, rename, reorder (drag, or Move up / Move down), cover images,
  availability (**All businesses** or **Selected businesses**), activate and deactivate. Deactivating
  a genre never deletes audio.
- **Businesses** (`/admin/businesses`): add and edit venues (type, station name, pronunciation
  spelling, logo, announcement language, genre access, status). Staff are invited by email or with
  a one-time invite link, and password resets are sent by email. Administrators never see
  passwords. The **Access requests** list collects submissions from the public form, and a business
  can be created from a request.
- **Admin workspace** (`/admin`, which opens the music library): Music library, Genres, Businesses,
  Announcements (a venue selector, generate or upload, preview, approve, frequency and voice volume)
  and Settings (platform contact details, default announcement frequency for new venues, privacy
  policy and terms text, and the status of the integrations).
- **Public site**: the homepage (`/`), a **Request access** form (`/request-access`), `/privacy` and
  `/terms` (the owner's text from Settings, or an honest "not published yet"), and the sign-in pages
  (`/login`, `/forgot-password`, `/reset-password`).
- **Security**: Supabase Auth with invite-only accounts; Row Level Security on every table; private
  Storage buckets; short-lived signed media URLs, signed with the venue user's own session; server-side
  authorisation that never trusts a business id sent by the client; rate limits on sign-in, password
  resets and access requests. Service keys and the ElevenLabs key stay on the server.

## Tech stack

| Area | Choice |
| --- | --- |
| App | Next.js 16.3.6 (App Router, `src/proxy.ts`), React 19.2, TypeScript (strict) |
| UI | Tailwind CSS 4 (tokens in `src/app/globals.css`), `lucide-react` icons, Inter via `next/font` |
| Backend | Server Components, Server Actions and Route Handlers (Node runtime) |
| Auth, database, files | Supabase Auth, Postgres with RLS, private Storage (`@supabase/ssr`, `@supabase/supabase-js`) |
| Validation | `zod` 4; MP3 checks with an own frame walk plus `music-metadata` |
| Voice (optional) | ElevenLabs text-to-speech REST API, called from the server only |
| Tests | Vitest 5; database and RLS tests on `@electric-sql/pglite` with the real migrations |
| Scripts | `tsx`; demo MP3s encoded with `@breezystack/lamejs`; brand assets with `sharp` (ships with Next.js) |

## Requirements

- **Node.js 22.13 or newer on the 22 line, Node.js 24, or Node.js 26+** (`engines` in
  `package.json`: `^22.13.0 || ^24.0.0 || >=26.0.0`). The project was developed on Node.js 24.19.
  This range is where every pinned dependency declares support: `@supabase/supabase-js` needs
  Node.js 22 or newer at runtime, Vitest 5 supports 22.12+, 24 and 26+ (not 23 or 25), and the
  TypeScript ESLint parser needs 22.13+ on the 22 line. Node.js 20 is not supported.
- npm (the repository ships `package-lock.json`).
- A Supabase project. The hosted Free plan works.
- Optional: an ElevenLabs API key (voice generation) and an SMTP provider (real invite emails).

## Quick start

```bash
npm install
cp .env.example .env.local
```

1. Fill in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SITE_URL` (`http://localhost:3000` locally). See
   [docs/SETUP.md §3](docs/SETUP.md#3-create-the-supabase-project-and-keys).
2. Apply **every** file in `supabase/migrations/` in filename order. There are currently four; the
   last one is `20260926000100_frekvencija.sql`. Use the Supabase SQL Editor or the CLI, as described
   in [docs/SETUP.md §4](docs/SETUP.md#4-apply-the-database-migrations).
3. Configure Supabase Auth: redirect URLs, sign-ups off, and the `token_hash` email templates. See
   [docs/SETUP.md §5](docs/SETUP.md#5-configure-authentication).
4. Create the first administrator:

   ```bash
   npm run admin:create -- you@example.com          # sends a Supabase invite email
   npm run admin:create -- you@example.com --link   # or prints a one-time invite link instead
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>, choose **Log in**, and continue at `/admin` (the music library).

Optional demo data (two example venues, EmeraldBar and Hotel Aurora, with synthetic audio). See
[docs/SEEDING.md](docs/SEEDING.md):

```bash
npm run demo:audio               # regenerate the synthetic demo audio in supabase/seed/audio/
npm run seed:dev -- --dry-run    # show the plan
npm run seed:dev -- --yes        # write it (add --allow-remote for a hosted development project)
```

Without `.env.local`, `npm run dev` still renders the public pages. The app pages redirect to
`/setup`, which lists the missing settings.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js development server on <http://localhost:3000> |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (including the React Compiler rules of `eslint-config-next`) |
| `npm run typecheck` | `next typegen`, then `tsc --noEmit` |
| `npm test` | All Vitest suites: unit tests, scripts tests, and PGlite database/RLS tests. Needs no credentials or internet access |
| `npm run test:watch` | Vitest in watch mode |
| `npm run check` | `typecheck`, `lint`, `test` and `build` in sequence |
| `npm run demo:audio` | Generate the synthetic demo loops and demo announcements (`-- --no-sapi` uses chimes instead of Windows speech) |
| `npm run seed:dev` | Development seed: `-- --dry-run`, or `-- --yes [--allow-remote] [--admin-email <email>]` |
| `npm run admin:create` | `-- <email> [--link]`: invite or promote a platform administrator (never sets or prints passwords) |
| `npm run brand:assets` | Regenerate `public/brand/*`, the app icons and the social image from `design/assets` |

## Project structure

```text
src/
  app/
    (public)/          homepage, /request-access, /privacy, /terms
    (auth)/            /login, /forgot-password, /reset-password (/set-password redirects there)
    auth/              /auth/confirm (email links, "Continue" button), /auth/signout
    (venue)/           /radio, /account, /help (the layout owns the persistent player)
    admin/             /admin/music, /genres, /businesses (+ /new, /[businessId], /requests), /announcements, /settings
    api/               player, media signing, admin uploads/preview/TTS, development audio
    setup/             shown until Supabase is configured
    dev/               development-only previews and the player lab (404 in production)
  components/          ui primitives, app shell, brand, player, admin and public components
  lib/                 player engine (framework-agnostic), auth, Supabase clients, data loaders,
                       validation, uploads, media signing, MP3 validation, ElevenLabs client, rate limits
  config/platform.ts   platform name, domain and tuning constants
  types/database.ts    hand-written Database types that match the migrations
  proxy.ts             session refresh and setup-mode routing (Next.js 16 proxy)
supabase/
  migrations/          the four SQL migrations (schema, RLS, storage, Frekvencija additions)
  seed/audio/          synthetic demo audio and manifest.json (generated by npm run demo:audio)
scripts/               demo audio, development seed, admin creation, brand assets (+ lib/, tests/)
tests/                 Vitest suites (player engine, API routes, auth, admin, database/RLS on PGlite)
design/                the design pack: handoff, functional brief, screen references, logo and photo
docs/                  setup, seeding, architecture, redesign and testing documentation
public/brand/          generated logo, emblem, venue photograph and default genre artwork
```

## Documentation

- [docs/SETUP.md](docs/SETUP.md): from an empty Supabase project to a running platform
  (keys, migrations, auth emails, first admin, first content, ElevenLabs, deployment).
- [docs/SEEDING.md](docs/SEEDING.md): synthetic demo audio, the development seed and `admin:create`.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the data model, RLS, storage, API, uploads and
  playback engine.
- [docs/REDESIGN.md](docs/REDESIGN.md): the Frekvencija visual system, routes and screen contracts.
- [docs/TESTING.md](docs/TESTING.md): which checks ran and which still need real credentials or a
  manual browser check.
- `design/`: the original design handoff (`CLAUDE-HANDOFF.md`, `FUNCTIONAL-BUILD-PROMPT.md`,
  `screens/`).

## Development previews

These routes exist only in development. The `/dev` layout returns 404 when
`NODE_ENV=production`, and so does the demo audio route. They work without Supabase.

| Route | Shows |
| --- | --- |
| `/dev/player-lab` | The real venue radio and playback engine, playing the synthetic demo audio against an in-browser fake API |
| `/dev/preview/radio` (`?state=…`), `/dev/preview/radio/account`, `/dev/preview/radio/help` | The venue radio with fixture data for every playback state, and the Account and Help pages |
| `/dev/preview/music`, `/dev/preview/genres` | The music library and the genre manager (`?scenario=empty`) |
| `/dev/preview/businesses` (`/new`, `/requests`, `/<id>`) | The business list, detail panel, add form and access requests |
| `/dev/preview/announcements` (`?tts=on\|off\|rejected`, `?scenario=…`) | The announcement studio |
| `/dev/preview/settings` (`?variant=configured\|empty\|missing`) | The settings page |
| `/dev/ui`, `/dev/ui/shell` | The UI primitives and the app shells |

Server actions in the previews do nothing. The fixture venues and songs are examples only.

## Notes

- **The demo audio is synthetic.** The "music" consists of generated tone loops, and the demo
  announcements are computer speech (Windows SAPI) or chime placeholders. Every file is marked as
  synthetic in its title and ID3 tags. The repository contains
  **no real music, no recordings of real people, and no credentials**. `.env.example` holds
  placeholders only. Upload only music you are licensed to play in venues.
- **What needs real credentials:** sign-in, the admin workspace, venue playback and uploads all need
  a Supabase project and its keys. Generating announcement voices needs an ElevenLabs API key
  (uploading MP3 announcements works without one). Invite and reset emails for real addresses need
  custom SMTP; until then, use one-time invite links. The automated tests need none of these (they
  use fakes and PGlite). [docs/TESTING.md](docs/TESTING.md) lists what has been verified and what
  still needs a live project or a manual browser check.
- **Browser playback:** the radio runs in a browser tab on a device connected to the venue's sound
  system. Browsers can stop audio when a device sleeps, the browser closes, or a phone moves the tab
  to the background. The player then shows its real state and asks for a tap to resume.
- **Demo credentials never ship:** `npm run seed:dev` refuses to run with `NODE_ENV=production`,
  targets only a local stack unless you pass `--allow-remote`, and prints the demo users' one-time
  passwords only in your terminal.
