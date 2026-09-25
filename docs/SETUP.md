# Setup guide

This guide takes you from an empty Supabase project to a working Frekvencija (frekvencija.online) with an
administrator, at least one venue, music and announcements. Allow about 30 minutes.

> The platform name is defined once in `src/config/platform.ts` (overridable with
> `NEXT_PUBLIC_PLATFORM_NAME`).

## 1. Requirements

- **Node.js 22.13 or newer on the 22 line, Node.js 24, or Node.js 26+**, and npm. The project was
  developed on Node 24.19. This matches `engines` in `package.json` (`^22.13.0 || ^24.0.0 || >=26.0.0`):
  the Supabase client needs Node 22 or newer, and the test and lint tools need 22.13+ and do not
  support Node 23 or 25. Node 20 is not supported.
- A Supabase project (the Free plan works; its 50 MB per-file limit matches the music bucket limit).
- Optional: an ElevenLabs account and API key to generate announcement voices. A paid plan is
  required for commercial use. Uploaded MP3 announcements work without it.
- For real venue invites: a custom SMTP provider (Resend, Postmark, Amazon SES, SendGrid, …). The
  built-in Supabase email service only delivers to members of your Supabase organisation, at 2 emails
  per hour. Until SMTP is set up, use one-time invite links (**Create invite link** in the admin, or
  `npm run admin:create -- <email> --link`).

## 2. Install

```bash
npm install
```

```bash
cp .env.example .env.local
```

## 3. Create the Supabase project and keys

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. **Project Settings → API Keys**: copy the **publishable** key (`sb_publishable_…`) and create/copy a
   **secret** key (`sb_secret_…`). Legacy `anon` / `service_role` JWT keys also work (see `.env.example`).
3. Fill `.env.local`:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key |
   | `SUPABASE_SECRET_KEY` | the secret key — server only, never commit it |
   | `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally; your public origin in production (no trailing slash) |
   | `ELEVENLABS_API_KEY` | optional |

   The secret key bypasses Row Level Security. It is used only on the server for Auth admin calls
   (invites), upload validation and cleanup, rate limiting, storing requests from the public
   **Request access** form, and showing genre covers on the public homepage. It must never get a
   `NEXT_PUBLIC_` prefix. Without it, the log-in and password-reset limits fail open (with a server
   warning), and the Request access form answers that the service is not configured.

   The other optional variables (signed-URL lifetime, upload-token secret, and the client-IP settings
   for self-hosting in §11) are explained in `.env.example`.

## 4. Apply the database migrations

The app needs **every** file in `supabase/migrations/`, applied in filename order. Without the Supabase
CLI, open **SQL Editor** in the dashboard and run each file in order. Paste the full file contents and
click **Run**:

1. `supabase/migrations/20260925000100_core_schema.sql` — tables, enums, triggers, rate-limit function
2. `supabase/migrations/20260925000200_access_control.sql` — helper functions, grants, Row Level Security policies
3. `supabase/migrations/20260925000300_storage.sql` — private buckets `music`, `announcements`, `logos` and their storage policies
4. `supabase/migrations/20260926000100_frekvencija.sql` — business types, genre covers (private bucket
   `genre-covers`), the access-request list and the platform settings (contact details, default
   announcement frequency, privacy policy, terms of service). The venue player, the homepage and the
   admin read these, so the app does not work without this file.

Each file runs in a single transaction. `20260925000300_storage.sql` is safe to re-run.

With the Supabase CLI instead: this repository ships no `supabase/config.toml`, so run `supabase init`
once, then `supabase link --project-ref <ref>` and `supabase db push`. Do not mix the two methods: if
you already ran files in the SQL Editor, first mark them as applied with
`supabase migration repair --status applied <version>`, or `db push` runs them again.

Check: **Table Editor** shows `profiles`, `businesses`, `genres`, `tracks`, `announcements`,
`access_requests`, `platform_settings`, … and **Storage** shows four **private** buckets (`music`,
`announcements`, `logos`, `genre-covers`).

## 5. Configure Authentication

In **Authentication**:

1. **URL Configuration**
   - Site URL: your production origin (e.g. `https://frekvencija.online`).
   - Redirect URLs: add `http://localhost:3000/**` and `https://<your-domain>/**`.
2. **Sign In / Providers → Email**: keep Email enabled, **turn off "Allow new users to sign up"**. Accounts
   are invite-only (businesses ask for one with the public **Request access** form, and you invite them);
   invites still work with sign-ups disabled.
3. **Emails → Templates**. Invites and password resets must use the `token_hash` link format so the
   server can verify them (the default links put tokens in the URL fragment, which the server cannot read):

   **Invite user**
   ```html
   <h2>You're invited to Frekvencija{{ if .Data.business_name }} for {{ .Data.business_name }}{{ end }}</h2>
   <p><a href="{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">Accept the invitation and choose your password</a></p>
   ```

   **Reset password**
   ```html
   <h2>Reset your password</h2>
   <p><a href="{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a></p>
   ```

   The app always passes `redirectTo = NEXT_PUBLIC_SITE_URL`, so the same template works locally and in
   production. `/auth/confirm` shows a **Continue** button rather than signing in on page load, because
   corporate email scanners (e.g. Microsoft Defender Safe Links) open links and would otherwise use up the
   one-time token. After **Continue** the user chooses a password on `/reset-password` (also the default
   when a link has no `next`). Templates that still say `next=/set-password` keep working: that old page
   permanently redirects to `/reset-password`. An expired or already-used link lands on the log-in page
   with an explanation and a **Request a new link** button (`/forgot-password`).
4. **Emails → SMTP Settings**: configure your SMTP provider for real invites. Turn off click tracking in the
   provider (it rewrites links). Then raise the email rate limit under **Rate Limits** if needed.
5. Optional: **Email OTP expiration** (default 1 hour) also controls how long invite and reset links stay
   valid. Up to 24 hours is reasonable for invites.
6. Recommended: keep Supabase's own **Rate Limits** for Auth (and optionally CAPTCHA). The app limits
   log-in (10 per email and 50 per network every 10 minutes), password-reset emails (5 per address and 20
   per network per hour, and 60 per hour in total) and access requests (5 per network per hour, 3 per
   email per day, and 30 per hour in total) in front of its own forms, but the publishable key lets
   anyone call Supabase Auth directly.

## 6. Create the first administrator

Pick one of these:

**A. Script (recommended)** — invites the address (or promotes it if the account exists):

```bash
npm run admin:create -- you@example.com
```

Add `--link` to print a one-time invite link instead of sending an email (useful before SMTP is set up).
Open the link, click **Continue**, and choose a password.

**B. SQL** — create the user under **Authentication → Users → Add user → Send invitation** (or create it
with a password you choose yourself), then run in the SQL Editor:

```sql
update public.profiles set role = 'platform_admin' where email = 'you@example.com';
```

Users can never change their own role; only the SQL editor / secret key can.

## 7. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>, the public homepage. Choose **Log in** (`/login`) and sign in as the
administrator. You land in the admin workspace: `/admin` opens the **Music library** (`/admin/music`).
Venue accounts land on their radio (`/radio`).

| Route | Who | What |
| --- | --- | --- |
| `/` | everyone | Homepage. Its genre collection shows your enabled genres that are available to all businesses (names, descriptions, covers — never tracks). Until there are any, or without the secret key, it shows an illustrative default list |
| `/request-access` | everyone | Businesses ask for a station. Requests are stored for you under **Businesses → Access requests**; nothing is approved automatically, and a second open request from the same email is answered with a friendly note |
| `/privacy`, `/terms` | everyone | Your privacy policy and terms of service from **Settings**, or an honest "not published yet" note |
| `/login`, `/forgot-password` | signed out | Log in; request a password-reset link (the answer never reveals whether an account exists) |
| `/reset-password` | from an invite or reset link, or signed in | Choose a new password (`/set-password` redirects here) |
| `/auth/confirm` | email links | The **Continue** step of invite and reset links |
| `/radio`, `/account`, `/help` | venue staff | The radio; the venue's details, a password-reset email and sign out; how it works, playback tips and your contact details |
| `/admin/music`, `/admin/genres`, `/admin/businesses`, `/admin/announcements`, `/admin/settings` | admins | The admin workspace (§8). Businesses also has `/admin/businesses/new`, `/admin/businesses/<id>` and `/admin/businesses/requests` |
| `/setup` | — | Shown instead of the app pages while Supabase is not configured |
| `/dev/…` | development only | Design previews and the player lab (404 in production builds; see `README.md`) |

Before Supabase is configured, the public pages (`/`, `/request-access`, `/privacy`, `/terms`, `/login`,
`/forgot-password`, `/reset-password`) still render, and their forms explain that the service is not
configured yet. Every other page shows the `/setup` checklist until then.

## 8. First content

1. **Genres** (`/admin/genres`): **Add genre**, enter the **Genre name** and **Description**, then
   **Create genre**. Suggested genres: House, Deep House, Lounge, Jazz, Pop, Rock, R&B, Balkan Hits,
   Chillout. Once a genre exists, **Change cover** adds a cover image (PNG, JPEG or WebP, up to 3 MB). The
   cover appears on the venues' genre cards and, for genres available to all businesses, on the homepage.
   Until then, the genre shows neutral default artwork. Reorder genres by dragging a card, or with
   **Move up** / **Move down** in its **…** menu. To offer a genre only to some venues, set
   **Availability** to **Selected businesses** and tick them under **Businesses with access**.
   **All businesses** offers it to every venue. Switching **Status** to Inactive, or
   **Deactivate genre**, hides the genre from venues without deleting any audio. **Manage tracks**
   opens the music library filtered to the genre.
2. **Music** (`/admin/music`): in the **Upload queue**, pick the genres under **Add new uploads to**. They
   are applied to files as you add them. Then click **Upload music**, or drop files on the **Uploads**
   tab. Uploads must be MP3 files of up to 50 MB each, and you can watch the progress of each file. Every
   file is checked on the server, and anything that isn't a playable MP3 is rejected with a reason.
   Select a track to edit its title, artist and genres (**Save changes**). The track's **…** menu can
   preview it, replace its file, deactivate it or remove it from playback. Only upload music you are
   licensed to play in venues.
3. **Businesses** (`/admin/businesses`): **Add business** asks for:
   - **Business name**, **Business type** and **Station name** (for example "EmeraldBar Radio");
   - **Contact email**;
   - **Business status**: an Active venue can play as soon as its staff sign in;
   - **Announcement language**;
   - genre access: genres available to all businesses are always included, so tick only the extra
     ones this venue may play;
   - optionally **Invite the contact now**, choosing **Send an invitation email** or
     **Create a one-time invite link**.

   New venues start with the default announcement frequency from **Settings**. Then open the venue:
   - The **Profile** tab has **Upload logo** (PNG, JPEG or WebP, up to 2 MB), the venue's details,
     **Pronunciation for announcements**, its status and genre access, plus **Save changes** and
     **Send password reset**.
   - The **Access** tab invites more staff (**Invite by email address**, then **Send invitation** or
     **Create invite link**) and lists the venue's members.

   Staff choose their own password; administrators never see passwords.
4. **Announcements** (`/admin/announcements`): choose the venue in the selector, or use
   **Manage announcements** on its Profile tab. Under **Create an announcement**, write the
   **Announcement text** or **Start from a template**, pick the **Placement** (Welcome message, Station
   identity or Both), and check the **Pronunciation spelling**. Then either:
   - on the **Upload recording** tab, drop an MP3 of up to 10 MB; or
   - on the **Generate voice** tab (ElevenLabs, see §10), click **Generate preview**.

   Listen to the **Audio preview** (status **Ready for review**), then click **Approve & activate**.
   Under **Announcement settings**, set **Play after** (the number of completed songs between
   announcements) and the **Announcement volume**, then click **Save settings**.
5. **Settings** (`/admin/settings`):
   - **Platform contact**: your contact email and phone. Venues see them on their Help page and on the
     inactive-venue screen; the email also appears on `/request-access`, `/privacy` and `/terms`.
   - **Defaults**: the **Default announcement frequency** that venues added later start with.
   - **Legal pages**: your **Privacy policy** and **Terms of service** as plain text (blank lines
     separate paragraphs). Until you add them, `/privacy` and `/terms` say they haven't been published
     yet.
   - **Integration status** (read only): Supabase, the secret key, the site address used in email
     links, ElevenLabs (with its credits) and email delivery.

   Save with **Save changes**.
6. **Access requests** (**Businesses → Access requests**, `/admin/businesses/requests`): review what
   businesses sent through **Request access**. You can mark each request as contacted, approved or
   declined, and keep notes. **Create business from request** opens the add form, prefilled from the
   request.

The venue signs in, sees its station branding, chooses a genre, and presses **Start Radio**.

## 9. Optional: demo content for development

For local testing there are synthetic demo loops (not real music) and demo announcements for two example
venues: **EmeraldBar** (a bar) and **Hotel Aurora** (a hotel). See [SEEDING.md](SEEDING.md):

```bash
npm run demo:audio
```

```bash
npm run seed:dev -- --yes
```

The seed needs all four migrations (§4) and stops before writing anything if one is missing. It refuses
to run against a non-local Supabase URL unless you also pass `--allow-remote`, and it never runs with
`NODE_ENV=production`. It prints one-time passwords for the demo users it creates. Keep them local and
never deploy demo credentials. The seed never writes the platform settings (contact details, privacy
policy, terms).

Without any Supabase project, you can still try the playback engine with the demo audio at
<http://localhost:3000/dev/player-lab> (development only).

## 10. Optional: ElevenLabs voice generation

1. Create an API key in ElevenLabs. For production, use a restricted key with only **Text to Speech**,
   **Voices: read**, and **Models: read** permissions (add **User: read** to show remaining credits in
   **Settings**).
2. Set `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_DEFAULT_MODEL_ID`, e.g. `eleven_multilingual_v2`)
   and restart the server.
3. Open the announcement studio (`/admin/announcements`, choose the venue) and select the
   **Generate voice** tab.
4. Write the **Announcement text** and check the **Pronunciation spelling**.
5. Pick the **Language**, **Voice** and **Model**. Only the languages the chosen model supports are
   offered.
6. Click **Generate preview**, listen to the **Audio preview**, then click **Approve & activate**.

Each generation is stored and reused; playback never calls the provider. Duplicate requests are blocked
while one is in progress, and identical requests reuse the existing audio. Without a key, the studio
says that the AI voice isn't set up yet, and **Upload recording** keeps working.

Language notes: Bulgarian, Croatian, Greek, Romanian and Turkish work with `eleven_multilingual_v2`,
`eleven_flash_v2_5` and `eleven_v3`; Serbian, Bosnian, Macedonian and Slovenian only with `eleven_v3`
(as of September 2026 — the admin UI reads the live list from the provider).

## 11. Deploy

Any Node host that runs Next.js works (e.g. Vercel), on a supported Node version (§1):

1. Set the same environment variables in the host (with `NEXT_PUBLIC_SITE_URL` = production origin).
2. Add the production origin to Supabase **Redirect URLs** and set it as **Site URL**.
3. `npm run build` and `npm start` (or let the host build). `npm run check` runs the type check, lint,
   tests and build in one go.

Uploads go straight from the admin's browser to Supabase Storage via signed upload URLs, so hosting
body-size limits do not apply to music files.

**Reverse proxies and client IPs.** The per-network limits (§5.6) need the visitor's real IP address.
Clients can send their own `X-Forwarded-For` header, so tell the app which value your own
infrastructure wrote:

- **Vercel**: nothing to do. `x-vercel-forwarded-for` is used automatically.
- **A proxy or edge that overwrites a header with the client IP**: set `CLIENT_IP_HEADER` to that header,
  for example `x-real-ip` (nginx: `proxy_set_header X-Real-IP $remote_addr;`), `cf-connecting-ip`
  (Cloudflare) or `fly-client-ip` (Fly.io). The proxy must never pass on a value the client sent. This
  setting wins over `TRUSTED_PROXY_HOPS`.
- **Proxies that append to `X-Forwarded-For`**: set `TRUSTED_PROXY_HOPS` to how many trusted proxies
  append (0–10). For example, use `1` behind a single nginx with
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, or behind a single Caddy
  `reverse_proxy`, which sets the header itself. The app then reads the client IP that many entries
  from the right.

Make the app reachable only through that proxy or edge. Without either setting, a self-hosted
deployment cannot trust the client IP, so the per-network limits are best-effort only. The global caps
still apply: 30 access requests and 60 password-reset emails per hour, across all visitors.

## 12. Operating notes

- Venue playback runs in a browser tab. Keep the tab open and the device awake. The venue's Account and
  Help pages have a **Keep screen awake** switch where the browser supports it. Browsers may stop audio
  when a laptop sleeps, the browser is closed, or a phone puts the tab in the background. The player then
  shows its real state and asks for a tap to resume ("Tap to resume your radio.").
- Changing a venue's name, station name or pronunciation marks its announcements **Needs review**. They
  stop playing until you re-approve them (or replace them), so outdated branding is never broadcast.
- Disabling or removing a track excludes it from upcoming playback, including tracks already queued in
  players; a song that is already playing finishes.
