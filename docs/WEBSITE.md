# The public website (v3: night, vermillion, motion)

The marketing site at `frekvencija.online` (the homepage, the trial request, `/privacy` and `/terms`)
is Macedonian by default with a complete English version (the **MK / EN** switch in the header,
menu and footer). It sits in front of the unchanged app: sign-in (`/login`), the venue radio
(`/radio`) and the admin workspace (`/admin`) keep their dark evergreen design and all their routes.

Three designs exist side by side until the owner chooses:

| Version | Branch | State |
| --- | --- | --- |
| v1, the original homepage | `frekvencija-mvp` | Live on frekvencija.online |
| v2, ivory and cobalt editorial | `website-redesign` | Preview only |
| v3, this document: dark, vermillion, motion design | `website-v3` | Preview only |

## 1. Before v3 goes live: the illustrative numbers

The owner asked for imaginary figures so the design could be judged with numbers in place. They are
**invented** and must not be published as they are: presenting them as facts would be misleading
advertising. They live in one place, `SITE_STATS` in `src/config/site.ts`:

| Figure | Shown as |
| --- | --- |
| `venues: 140, "+"` | "140+ venues on air" in the Numbers chapter, and "On air in 140+ venues" above the hero headline |
| `cities: 18` | "18 cities" |
| `hours: 52_000, "+"` | "52,000+ hours of music every month" |
| `ads: 0` | "0 outside ads". This one is true. |

The Numbers title ("Already on air across Macedonia.") and the hero's on-air line (`hero.onAir`) are
claims too; they are in `src/content/site/mk.ts` and `en.ts`. Before launch, either put real
figures in `SITE_STATS` and adjust those two sentences, or ask for the Numbers chapter and the on-air
line to be taken out until there are real figures.

## 2. What the visitor sees

The homepage is a scroll story in numbered chapters.

| Part (homepage anchor) | What it does | Honest states |
| --- | --- | --- |
| Intro | On the first visit of a browser session: nine vermillion bars tune from 87.5 to 101.7 MHz, the logo appears, and the curtain lifts into the hero | Homepage only. Skipped for a section link, for reduced motion, and by any key or tap |
| Header | Logo, How it works, Features, Venues, Plans, FAQ, MK / EN, Log in, the trial button. It slides away while reading down and returns when scrolling up or tabbing to it. Below 1280px the links move into a full-screen menu | Signed-in visitors see "Open radio" / "Admin workspace" instead of Log in |
| Hero (`#top`) | Full-bleed bar photograph, the on-air line, "Your place. Your sound. Your radio.", the lead, two actions, an FM dial at 101.7, and on wide screens a glass "now on air" card for the sample station EmeraldCaffe Radio | The card is tagged **Example** and is hidden from screen readers |
| Genre ribbon | Two giant rows of genres drifting in opposite directions, faster while scrolling | The live catalogue's genres (the default list before setup); a pause button; still with reduced motion |
| 01 `#manifesto` | The brand statement; words light up as it scrolls through the screen | Fully lit without motion |
| 02 `#numbers` | Four figures counting up beside a turning vinyl | **Illustrative, see §1** |
| 03 `#how-it-works` | Four steps with photographs: tell us, we prepare, press play, three days on us. On desktop the section holds still and the steps slide sideways as you scroll | A plain list of cards on phones and with reduced motion |
| 04 `#features` | Six cards: your name on air (cycles through sample names), no outside ads, your offers, music for every hour, any browser, simple for staff | — |
| 05 `#venues` | Cafés, restaurants, hotels, bars: a moment, a description and recommended genres. On desktop a photo follows the pointer; on phones each row has its photo | Only genres that exist in the catalogue are recommended |
| 06 `#announcements` | Type a venue name and three sample announcements (station identity, offer of the day, weekend event) update at once; a timeline shows music and voice taking turns | Text preview only: real announcements are recorded professionally for each venue |
| 07 `#plans` | While pricing is unpublished: what every package includes and Request pricing. When published: the three packages | Draft amounts never reach the page until approved |
| 08 `#faq` | Ten questions, one open at a time | — |
| 09 `#trial` | The request form on a light card, with the three next steps | Success is shown only after the request was stored |
| Footer | A last call to action, site and legal links, contact, MK / EN, the giant FREKVENCIJA wordmark, photo credits | Contact email appears only when set in Admin → Settings; social links only when added |

`/request-access` is the trial section on its own page with its own heading, a stable link for emails
and the sign-in page. Submissions land in **Admin → Businesses → Access requests**, with the city and
the preferred genre ("Wants a recommendation" for that option).

The website plays no audio. The waveforms and the on-air card are illustrations.

## 3. Motion and accessibility

- **Libraries.** GSAP 3.15 with ScrollTrigger and SplitText (free for commercial use since 3.13),
  `@gsap/react`, and Lenis 1.3 for smooth scrolling. The motion pieces live in
  `src/components/public/site/motion/`.
- **Smooth scrolling and pinning** run only on desktops with a mouse, at least 1024px wide. Phones and
  tablets keep their native scrolling.
- **Reduced motion.** When the visitor's system asks for reduced motion, there is no intro, no smooth
  scrolling, no pinning and no reveal: every chapter is shown complete and still.
- **Without JavaScript** everything is visible from the start. If the scripts fail to load, a
  5-second safety net shows all content.
- Decorative movement is hidden from screen readers, which get the same content as text. The genre
  ribbon has a pause button, and the equalisers settle after a few seconds.
- Section links move keyboard focus to the chapter's heading.

## 4. Where to change things

| What | Where |
| --- | --- |
| Every sentence, in both languages | `src/content/site/mk.ts` and `src/content/site/en.ts` (the shape in `types.ts` keeps both complete). `*stars*` mark the highlighted phrases of the manifesto; `{name}` is the venue name in the sample announcements |
| The numbers | `SITE_STATS` in `src/config/site.ts` (see §1) |
| Venue types, their photos and recommended genres; the sample venue and station names; section anchors | `src/config/site.ts` |
| Photographs | `src/assets/photos/` (see §5) |
| Plans and prices, and whether they are published | `src/config/plans.ts`: set `PRICING_PUBLISHED = true` once the amounts are approved |
| Colours and type sizes | `src/app/globals.css`: the `.theme-night` scope (the page) and `.theme-paper` (the form card), the `display-*`, `serif-accent` and `label-mono` utilities |
| Fonts | Sofia Sans Extra Condensed (headlines) and Cormorant Garamond italic (highlighted phrases) in `src/app/(public)/_lib/fonts.ts`; Inter (body) in `src/app/layout.tsx`. All with Cyrillic |
| Logo variants, app icons, social preview | `npm run brand:assets` regenerates `public/brand/frekvencija-logo-light.png`, `frekvencija-emblem-light.png`, the icons and the social preview image (the hero photo with the logo) |
| Language switch | `/lang/mk` and `/lang/en` remember the choice in the `frekvencija_lang` cookie for a year and return to the current page. Macedonian is the default |
| Contact email in the footer, trial result and policy pages | Admin → Settings → contact email |
| Privacy policy and terms text | Admin → Settings (shown on `/privacy` and `/terms`; an honest "not published yet" state until then) |

## 5. Photography

The 14 photographs in `src/assets/photos/` come from Unsplash. The Unsplash License allows free
commercial use without asking; credit is appreciated, so the footer says "Photos: Unsplash". The
original page of every photo is listed in `PHOTO_SOURCES` in `src/assets/photos/index.ts`.

To replace one with a photo of a real venue, save it under the same file name (JPEG, at least 2000px
wide) and update its line in `PHOTO_SOURCES`. Alt texts are in the content files (`imageAlt` and
`photoAlt` entries). Next.js resizes, compresses and blurs the placeholders automatically.

## 6. Trial requests

- The form posts to the Server Action `requestTrial` (`src/app/(public)/request-access/actions.ts`):
  validation in the visitor's language, rate limits (5 per network per hour, 3 per email per day, 30
  from everyone per hour), then an insert with the secret-key client into `access_requests`.
- The migration `supabase/migrations/20261026000100_trial_requests.sql` adds the two optional columns
  `city` and `preferred_genre`. Apply it with `npm run db:migrate` before publishing v2 or v3; until it
  is applied, submissions answer with the "couldn't be sent right now" message and nothing is stored.
- Nothing is approved, activated or charged automatically. The admin marks requests contacted /
  approved / declined and can create the business from a request.

## 7. Checks

`npm run check` (typecheck, lint, unit and database tests, production build) covers the website:
chapter order and copy in both languages, the numbers and their formatting, the plans and form states,
the trial action (validation, storing, duplicates, rate limits, setup mode), the language route and the
motion boot script.
