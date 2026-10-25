# The public website (v2: ivory, cobalt, charcoal)

The marketing site at `frekvencija.online` — the homepage, the trial request, `/privacy` and `/terms` —
is Macedonian by default with a complete English version (the **MK / EN** switch in the header and
footer). It sits in front of the unchanged app: sign-in (`/login`), the venue radio (`/radio`) and the
admin workspace (`/admin`) keep their dark evergreen design and all their routes.

This document says where everything lives and what the owner can change without touching components.

## 1. What the visitor sees

| Section (homepage anchor) | What it does | Honest states |
| --- | --- | --- |
| Header | Logo, How It Works, Listen, For Your Venue, Plans, FAQ, MK / EN, Log in, the cobalt trial button. Sticky and slightly more compact when scrolling; below 1280px the links move into a side sheet. | Signed-in visitors see "Open radio" / "Admin workspace" instead of Log in |
| Hero | Centred editorial headline, lead, two actions, the **radio console** ("EmeraldCaffe Radio", labelled as an example), a strip of photography | Without configured demo audio the console says *demo coming soon*; the play button is disabled and nothing animates |
| `#listen` | "How would your radio sound?": type a venue name, choose a venue type; the station name and the three example announcements update at once | The note says the text changes, recorded voice samples are never regenerated |
| `#benefits` | The statement "No outside ads. Your own offers, on your own radio." and four benefits in alternating compositions | — |
| `#venues` | Café / Restaurant / Hotel / Bar & lounge with a photograph, a moment, a description and recommended genres (accessible tabs) | Only genres that exist in the catalogue are recommended |
| `#genres` | The live catalogue as typeset rows: enabled genres offered to every venue (the default list before setup) | Preview buttons appear only for genres with a configured demo clip |
| `#announcements` | The charcoal section: the playback sequence Music → Station identity → Music → Your offer, explorable examples | "Your announcements never play at another venue." |
| `#how-it-works` | Four steps: tell us → we prepare → three days → decide | The three days start when access is activated; nothing is activated or charged automatically |
| `#trial` | The cobalt conversion section with the request form (venue, type, city, contact, email, phone, preferred genre or "I need a recommendation", message) | Success is shown only after the request was stored; a second open request from the same email gets a friendly note |
| `#plans` | While pricing is unpublished: "Find the right plan for your venue" + what every package includes + Request pricing. When published: the three packages, the shared inclusions, the VAT note | Draft amounts never reach the page until approved |
| `#faq` | Ten questions and answers consistent with the service | — |
| Footer | Tagline, site and legal links, contact, MK / EN, domain | Contact email appears only when set in Admin → Settings; social links only when added |

`/request-access` keeps working: it is the trial section on its own page (a stable link for emails and
the sign-in page). Submissions land in **Admin → Businesses → Access requests**, which now also shows
the city and the preferred genre ("Wants a recommendation" for that option).

## 2. Where to change things

| What | Where |
| --- | --- |
| Every sentence, in both languages | `src/content/site/mk.ts` and `src/content/site/en.ts` (the shape in `types.ts` makes sure both stay complete). Announcement examples use `{name}` for the venue name. |
| Venue categories, their photos and recommended genres; the photo strip; section anchors | `src/config/site.ts` |
| Plans and prices, and whether they are published | `src/config/plans.ts` — set `PRICING_PUBLISHED = true` once the amounts are approved. The amounts are proposed package data, excluding VAT where applicable. |
| Demo audio | `src/config/demo-audio.ts` — see §3 |
| Colours, display type sizes, motion | `src/app/globals.css`: the `.theme-public`, `.theme-charcoal` and `.theme-cobalt` scopes and the `display-*` utilities |
| Fonts | Inter (body, with Cyrillic) in `src/app/layout.tsx`; Playfair Display (headlines, with Cyrillic) in `src/app/(public)/_lib/fonts.ts` |
| Logo variants | `npm run brand:assets` regenerates `public/brand/frekvencija-logo-cobalt.png` and `frekvencija-emblem-cobalt.png` from the approved logo, plus the app icons and the social preview image |
| Language switch | `/lang/mk` and `/lang/en` (a route handler) remember the choice in the `frekvencija_lang` cookie for a year and return to the current page. Macedonian is the default. |
| Contact email in the footer, trial result and policy pages | Admin → Settings → contact email (`platform_settings`) |
| Privacy policy and terms text | Admin → Settings (shown on `/privacy` and `/terms`; an honest "not published yet" state until then) |

Nothing on the site is invented: no testimonials, customer counts, awards, partner logos or contact
details that the owner did not supply.

## 3. Demo audio

The website plays audio only from real files you configure; it never fakes playback. Until then the
console shows *demo coming soon* and the example announcements are text only.

1. Put the clips under `public/demo/` (MP3 recommended), for example a 30–60 s mix of a music bed with
   the example announcement, and the three example announcements for "EmeraldCaffe" (you can generate
   them in Admin → Announcements with the station voice and download the MP3).
2. Fill in `src/config/demo-audio.ts`:

   ```ts
   station: { src: "/demo/emeraldcaffe-sample.mp3", durationSeconds: 42 },
   announcements: {
     identity: { src: "/demo/identity.mp3" },
     offer: { src: "/demo/offer.mp3" },
     event: { src: "/demo/event.mp3" },
   },
   genrePreviews: { house: { src: "/demo/genre-house.mp3" } },
   ```

3. Only music you have the rights to use publicly belongs here.

Playback starts only on a tap, one sample plays at a time across the page, the console's waveform
moves only while audio really plays (from a Web Audio analyser when the browser allows it), and
loading and error states are shown honestly.

## 4. Photography

The four venue photographs and the photo strip are placeholders made from the one approved venue
photograph (`public/brand/`). Replace them with real photography per category: drop files into
`public/photos/` and point `VENUE_TYPES[*].photo.src` and `HERO_PHOTOS` in `src/config/site.ts` at
them (`position` is the CSS object-position of the crop). Alt texts live in the content files
(`venues.items.*.imageAlt`, `hero.photoAlt`).

## 5. Trial requests

- The form posts to the Server Action `requestTrial` (`src/app/(public)/request-access/actions.ts`):
  validation in the visitor's language, the same rate limits as before (5 per network per hour, 3 per
  email per day, 30 from everyone per hour), then an insert with the secret-key client into
  `access_requests`.
- The migration `supabase/migrations/20261026000100_trial_requests.sql` adds the two optional columns
  `city` and `preferred_genre` (the catalogue genre's name, or `recommendation`). Apply it with
  `npm run db:migrate` before publishing this version; until it is applied, submissions answer with the
  "couldn't be sent right now" message and nothing is stored.
- Nothing is approved, activated or charged automatically. The admin marks requests contacted /
  approved / declined and can create the business from a request, as before.

## 6. Checks

`npm run check` (typecheck, lint, unit and database tests, production build) covers the website:
section order and copy in both languages, the honest console and pricing states, the trial action
(validation, storing, duplicates, rate limits, setup mode), the language route, and the database
contract for the new columns.
