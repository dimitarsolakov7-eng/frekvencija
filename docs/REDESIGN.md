# Frekvencija redesign — build spec

The product is now branded **Frekvencija** (frekvencija.online). This spec turns the approved design pack
into build contracts. It sits on top of `docs/ARCHITECTURE.md` (backend, RLS, playback engine — all still
valid) and replaces its UI/route parts where they conflict.

## 0. Sources (read before coding UI)

Priority when they disagree:

1. `design/CLAUDE-HANDOFF.md` — product rules, screen behaviour, accessibility, responsive rules, states.
2. `design/FUNCTIONAL-BUILD-PROMPT.md` — functional requirements (already implemented by the backend).
3. `design/screens/*.png` — layout, hierarchy, colours, visual treatment. Open the PNGs with the Read tool
   and match composition, spacing and density. Sample names/numbers/statuses in them are fixtures, never
   hard-code them.

`design/IMAGE-PROMPTS.md` describes each screen's intended composition in words (useful for details that
are too small to read in the PNGs). Brand assets are generated into `public/brand/` by
`npm run brand:assets` (see `scripts/generate-brand-assets.ts`).

## 1. Visual system (implemented in `src/app/globals.css` — use the tokens, not raw hex)

| Token (Tailwind) | Value | Use |
| --- | --- | --- |
| `bg-canvas` | #0B1110 | page |
| `bg-sidebar` | #0E1714 | app-shell sidebars, mobile top/bottom bars |
| `bg-surface` | #15201C | cards |
| `bg-surface-2` / `bg-surface-3` | #1A2823 / #22332C | raised controls, hover, selected rows |
| `border-border` | #26382F | hairlines |
| `bg-accent` / `text-accent-fg` | #19B882 / #041D13 | primary buttons (dark text on emerald) |
| `text-accent-text` | #3FD19C | emerald text/icons on dark |
| `text-fg` / `text-fg-muted` | #F4F5EE / #A0B2A8 | text |
| `text-warning` / `text-danger` | #D9A44C / #E88383 | status |
| `rounded-card` / `rounded-control` | 12px / 10px | cards / buttons+inputs |

- Font: **Inter** (next/font, self-hosted at build). Headings bold, body regular/medium. Desktop page titles
  36–44px; public hero headline 56–72px; mobile titles 28–32px; body 16px; supporting 14px; labels ≥ 12px.
  Eyebrows (e.g. "YOUR STATION", "NOW PLAYING", "ADMIN WORKSPACE") are 12px uppercase, letter-spacing ~0.14em, muted.
- Spacing scale 4/8/12/16/24/32/48/64. Main content padding 32px desktop, 24px tablet, 16px mobile.
- Inputs ≥ 44px tall; main controls ≥ 44×44 touch targets. Visible focus rings everywhere.
- Warm amber venue photography on the dark evergreen UI; subtle shadows; borders and spacing carry
  hierarchy. One icon family: `lucide-react` (line icons).
- Logo: `<BrandLogo tone="ivory" />` from `@/components/brand` on dark UI (never append a domain);
  `<BrandEmblem />` for compact spots. Photography: `VENUE_HERO_IMAGE` and genre artwork via
  `genreArtwork({slug, coverUrl})` / `defaultGenreArtwork(slug)` from `@/lib/brand/genre-artwork`.
- Breakpoints: desktop ≥ 1024 (full 240px sidebar, split panels); tablet 640–1023 (compact nav, stacked
  panels); mobile < 640 (top bar + bottom tabs or drawer, 16px margins, two-column genre cards, full-width
  forms/detail panels; tables scroll horizontally with labels kept or become labelled row cards).
- Motion: minimal; respect `prefers-reduced-motion`; no animated "playing" indicator while paused.

## 2. Routes (final)

| Route | Access | Screen | Notes |
| --- | --- | --- | --- |
| `/` | public | 01 | marketing homepage (also for signed-in users; header then shows "Open radio"/"Admin workspace") |
| `/request-access` | public | 02 form system | business name, business type, contact name, email, phone (optional), message (optional) |
| `/privacy`, `/terms` | public | public shell | owner-supplied text from platform settings; honest "not published yet" state |
| `/login` | public | 02 | split photo/form; `?next=` and `?error=` as today |
| `/forgot-password` | public | 02 form system | neutral result message |
| `/reset-password` | session from invite/recovery link, or signed in | 02 form system | new password + confirm; expired-link recovery path. `/set-password` permanently redirects here |
| `/auth/confirm` | public | 02 form system | Continue button (email scanner safe) — `next` defaults to `/reset-password` |
| `/radio` | business user | 03 / 04 | venue player |
| `/account` | business user | 03 shell + 06 form styling | read-only venue details, password reset email, sign out |
| `/help` | business user | 03 shell | how it works, playback tips, honest device-sleep note, owner contact |
| `/admin` | admin | — | redirects to `/admin/music` |
| `/admin/music` | admin | 05 | library + selected-track editor + upload queue; `?genre=<id>` filter (Manage tracks) |
| `/admin/genres` | admin | 08 | grid + editor panel, cover upload, drag + Move up/down ordering |
| `/admin/businesses` | admin | 06 | list + detail panel; `/admin/businesses/[businessId]` selects one; `/admin/businesses/new` add form; `/admin/businesses/requests` access-request list |
| `/admin/announcements` | admin | 07 | venue selector `?business=<id>`; old `/admin/businesses/[id]/announcements` redirects here |
| `/admin/settings` | admin | shared forms | platform contact details, default announcement frequency, privacy/terms text, integration status |
| `/setup` | when env missing | public shell | unchanged behaviour, restyled |

Setup mode (Supabase env missing): the public pages (`/`, `/login`, `/forgot-password`, `/request-access`,
`/privacy`, `/terms`, `/reset-password`) render; their server actions answer with a friendly "The service
is not configured yet" message. Authenticated areas still redirect to `/setup`. `/dev/**` works as before.

## 3. Data model additions (migration `supabase/migrations/20260926000100_frekvencija.sql`)

- `create type public.business_type as enum ('cafe','restaurant','hotel','bar','other')`;
  `businesses.business_type business_type not null default 'other'`.
- `genres.cover_path text null` — object path in the new private bucket **`genre-covers`**
  (3 MB, `image/png`, `image/jpeg`, `image/webp`), path `{genre_id}/{random}.{ext}`.
  Storage policies: admin all; business users `select` when the genre is accessible to their active venue
  (`private.genre_cover_accessible(name)`).
- `create type public.access_request_status as enum ('new','contacted','approved','declined')`;
  table **`access_requests`**: `id`, `business_name` (1–120), `business_type business_type not null`,
  `contact_name` (1–120), `email` (email check, ≤ 254), `phone` (≤ 40, null), `message` (≤ 1000, null),
  `status` default `'new'`, `admin_notes` (≤ 2000, null), `handled_by` → profiles (set null),
  `handled_at`, `created_at`, `updated_at`. Unique index on `lower(email)` where `status in ('new','contacted')`
  (duplicate open request ⇒ friendly "we already have your request"). RLS: admin select/update/delete; **no**
  insert for anon/authenticated — the public server action inserts with the secret-key client after
  validation + rate limiting (`access-request:ip:{ip}` 5/hour, `access-request:email:{email}` 3/day, plus a
  global `access-request:global` cap of 30/hour that does not depend on client headers; the client IP policy is
  configured with `CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS`, see ARCHITECTURE §3).
- **`platform_settings`** singleton (`id boolean primary key default true check (id)`, row inserted by the
  migration): `contact_email` (null), `contact_phone` (null), `privacy_policy` (text, ≤ 50k, null),
  `terms_of_service` (text, ≤ 50k, null), `default_announcement_every_n_tracks` (int 1–50, default 4),
  `updated_at`, `updated_by`. RLS: `select` for `anon` and `authenticated` (public content); `update` admin only.
- `database.ts` gains the new enums, columns, tables.

## 4. Shared contract changes (already applied in code — implement against them)

- `src/lib/api/contracts.ts`: `BusinessType`, `SupportContact`, `PlayerBusiness.type`,
  `PlayerGenre.coverUrl`, `PlayerBootstrap.announcements` (the venue's own playable clips with `text`),
  `PlayerBootstrap.support`, `AnnouncementSummary.text`, upload kind `'genre-cover'`
  (`SignUploadRequest`/`SignUploadResponse.bucket`/`CompleteUploadResponse`).
- `src/lib/player/types.ts`: `PlayerSnapshot.upcoming: UpcomingTrack[]` (read-only, ≤ 3, next shuffle
  picks for the current genre; excludes the current track; may change after a list refresh).
- `src/lib/brand/genre-artwork.ts`, `src/components/brand/BrandLogo.tsx` (BrandLogo, BrandEmblem).

## 5. Shell components (owner: ui-foundation; used by venue + admin)

`src/components/shell/` — client components where noted; all accessible and responsive.

```tsx
// Two-column app frame. Desktop ≥1024: fixed 240px sidebar (bg-sidebar, border-r) + scrolling main.
// <1024: `mobileHeader` fixed on top, `mobileNav` fixed at the bottom (safe-area aware), sidebar hidden
// (tablet may show the drawer via the header menu button). `playerBar` (optional) is fixed at the bottom of
// the main column on desktop and above `mobileNav` on mobile; main content gets matching bottom padding
// so nothing is hidden behind it. Includes <SkipLink/> and <main id="main-content" tabIndex={-1}>.
<AppShell sidebar={ReactNode} mobileHeader={ReactNode} mobileNav?={ReactNode} playerBar?={ReactNode}>

// Sidebar pieces
<SidebarBrand eyebrow?="ADMIN WORKSPACE" href="/..." />               // BrandLogo + optional eyebrow
<SidebarNav label="Main" items={[{ href, label, icon: LucideIcon, match?: "exact" | "prefix" }]} />  // 'use client', active = emerald-tinted pill
<SidebarSection>                                                        // spacer groups (bottom actions)
<SidebarButton icon={LucideIcon} onClick | href label />                // Help, Settings, Sign out rows
<SidebarIdentity name initials? imageUrl? subtitle? />                  // venue identity row (E circle + name)
<MobileTopBar right?={ReactNode} />                                     // logo left, avatar/menu right
<MobileTabBar items={[{ href, label, icon }]} />                        // 'use client', bottom tabs
<UserMenu name email? initials? items={[{ label, href | onSelect, icon? }]} />  // avatar + name + dropdown
<PageHeading eyebrow? title description? actions? />                    // 36–44px title; mobile 28–32px
```

UI primitives to add/restyle in `src/components/ui` (owner: ui-foundation), exported from the index:
`Avatar` (initials or image), `StatusPill` (dot + label; tones `success | warning | neutral | danger | info`),
`GenreChip` (deterministic muted tone per genre key, like screen 05), `DropdownMenu` (accessible menu
button: arrow keys, Escape, focus return; used for row "…" actions), `Drawer` (side sheet dialog for mobile
editors), `SearchInput`, `SegmentedTabs` (screen 07 "Generate voice / Upload recording"), `PasswordInput`
(accessible show/hide), `CoverImage` (next/image with artwork fallback + dark gradient overlay option),
`Waveform` (decorative bars from screens 03/07, `aria-hidden`), `Accordion` (details/summary based).
Existing primitives are restyled to the handoff: 44px inputs/buttons, 10px control radius, 12px cards,
emerald primary with dark text, quiet secondary/outline buttons as in the screens.

## 6. Screen requirements (summary — the handoff section is authoritative)

- **01 Homepage**: section order header → two-column hero (pill "RADIO FOR YOUR BUSINESS", exact
  headline "Your place. / Your sound. / Your radio." last line emerald, copy "Music for your atmosphere. A
  station with your name.", buttons Request access + Explore genres; right: venue photo with a floating
  card explicitly labelled as an example station — "Example station" — "EmeraldBar Radio · House" and a
  quote card; no fake playback) → categories row (For cafés/restaurants/hotels/bars with icons) → "One
  login. Your own atmosphere." three numbered steps → "A sound for every space." genre collection (real
  enabled genres available to all when configured, default list otherwise; card play buttons go to
  `/login`; "Explore all genres" expands) → "Make it sound like you." feature → FAQ (exact answers from
  the handoff) → CTA band "Your space deserves its own station." → footer (logo, frekvencija.online,
  Contact → /request-access, Privacy, Terms). No testimonials, counts, prices, trials or licensing claims.
- **02 Login & forms**: desktop 55/45 split — photo panel (venue-hero, dark overlay, logo top-left,
  waveform, "Your atmosphere. / One click away.", "Sign in and let your station take over.") + form
  (~380px): "WELCOME BACK", "Log in to your station", "Use the account provided for your business.",
  Email address, Password with show/hide, Forgot password?, full-width Log in, divider, "Need an account?
  Request access", footer frekvencija.online. Mobile: single column, photo reduced to a small header.
- **03/04 Venue radio**: see handoff §03/04. Sidebar: logo, venue identity, Your radio, Account; bottom
  Help, Sign out. Header eyebrow "YOUR STATION", station name (h1), "Choose the sound for your space.",
  venue avatar. Now-playing hero card over genre artwork (eyebrow NOW PLAYING, genre name, track title,
  artist, large round emerald play/pause), "Your station voice" card (waveform, the venue's clip text,
  "Every N songs", Preview — pauses the radio, plays the clip in a separate element, then offers "Resume
  radio"; never touches the song counter), "Coming up" (snapshot.upcoming, read-only), "Find your
  atmosphere" genre cards (artwork, name, description, track count; card body = select genre keeping
  play/pause state; a labelled "Play {genre}" button = select and start; selected card emerald outline +
  "Playing" with equalizer only while actually playing). Fixed bottom player bar (artwork, title/artist,
  play/pause, skip, read-only progress with times, mute + volume) — **no previous button**. Mobile per 04:
  top bar, two-column genres, compact voice row, mini-player above Radio/Account tabs, safe-area padding.
  All playback states from the handoff list ("Tap to resume your radio.", "No music available yet.", …).
- **05 Music library**: title "Music library", "One catalogue. Every venue.", "+ Upload music"; tabs All
  tracks / Uploads; search, genre filter, status filter (default **All statuses**); table with selection
  checkbox, thumbnail (first genre's artwork), title/artist, genre chips (multiple), duration, status pill,
  "…" menu; count footer; right "Selected track" editor (artwork, Title, Artist, Genres multi-select, Save
  changes; Replace file; preview); "Upload queue" panel with per-file progress/status/cancel/retry and hint
  "Add music whenever you like. No website update needed."
- **06 Businesses**: title "Businesses", "A personal station for every space.", "+ Add business"; list with
  search + status filter (Active / Invited / Inactive — Invited = active venue whose members have not yet
  accepted), avatar initial + logo thumb + name + type, station name, status pill, "…" menu; detail panel
  tabs Profile / Access / Announcements: logo, name, type, Business details (station name, contact email,
  announcement language, business status), genre access checkboxes + Manage genres, Manage announcements
  (→ /admin/announcements?business=id), Save changes, Send password reset, "Passwords are managed securely
  by the business." Access tab = members & invitations. Access requests list reachable from this page
  (tab/button with count), with statuses and "Create business from request" prefill. Add business form:
  name, station name, contact email, type, genre access, invite contact.
- **07 Announcements**: breadcrumb Businesses / {venue} / Announcements, title = station name, "Your
  music. Their name.", venue selector; left: SegmentedTabs Generate voice | Upload recording; "Create an
  announcement" (text with live counter /500, Pronunciation spelling (optional) — prefilled from the venue's
  pronunciation; used to build the spoken text, it does not rename the venue), Language (only the chosen
  model's languages), Voice, Generate preview → "Audio preview" (player + calculated duration, status "Ready
  for review"), Approve & activate, Regenerate; "Upload your own recording" dropzone showing the real
  configured limit. Right: "Announcement settings" (Play after N completed songs, Announcement volume %,
  Save settings) and "Active recordings" (label by placement: Welcome message / Station identity, status,
  play, "…" menu) plus other clips (ready, needs review, failed) with their actions. Not configured TTS ⇒
  clear notice, upload stays usable.
- **08 Genres**: title "Genres", "Give every space the right sound.", "+ Add genre"; search; card grid
  (cover, drag handle, name, status pill, "…"), drag-to-reorder plus keyboard Move up/Move down; right "Edit
  genre" panel: cover + Change cover (upload, validated), Genre name, Description, Availability (All
  businesses / Selected businesses → business picker), Status toggle, Manage tracks (→ /admin/music?genre=id),
  Save changes, Deactivate genre. Deactivation never deletes audio.
- **Settings**: contact email/phone (shown to venues on help/inactive screens and used for Contact),
  default announcement frequency for new venues, privacy policy and terms text (rendered on /privacy,
  /terms), integration status (Supabase configured, ElevenLabs configured + subscription/credits when
  available, email delivery note about SMTP).

## 7. Dev previews (visual QA without Supabase)

Every redesigned screen gets a development-only preview at `/dev/preview/<screen>` that renders the real
presentational components with fixture data (server actions disabled or no-op). Admin/venue page
components must therefore be split into a server loader + props-driven client/presentational components.
`/dev/player-lab` renders the real radio screen (RadioScreen) driven by the lab engine with the demo audio.
QA viewports: 1440, 768, 390 px wide.
