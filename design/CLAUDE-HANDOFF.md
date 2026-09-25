# Frekvencija - visual and interaction handoff

**Brand:** Frekvencija. **Domain:** frekvencija.online. Use the approved first logo without a domain suffix. English interface copy is used throughout this pack.

## Product rules

The platform owner uploads and maintains one shared music catalogue. Every genre refers to that shared catalogue. Each business has an account, branding, and its own independent playback session. Two venues choosing House can hear different tracks at a given moment because each started separately. Do not implement a synchronized live radio broadcast.

The owner uploads or generates a few approved voice recordings per venue. An optional welcome recording plays after the venue starts the radio. A venue-specific station announcement then plays between songs after every four completed songs by default. The owner can change that number. Skips and failures do not count as completed songs.

The main experience is: log in, select a genre, press Play, and leave the music running. Music uploads and genre changes must be possible through the admin dashboard without code changes or a redeployment.

Read FUNCTIONAL-BUILD-PROMPT.md for the complete backend and playback requirements. This handoff supplies the final visual system, public website pages, page composition, and UI behavior.

## Source priority

1. Explicit product rules and behavior in this handoff.
2. FUNCTIONAL-BUILD-PROMPT.md for functional requirements.
3. Numbered screen images for layout, hierarchy, colors, and visual treatment.

The images are generated design references. Their tiny labels, example numbers, decorative icons, and occasional inconsistent filter state must not override the written requirements. Build the interfaces as real semantic components, not a full-page screenshot.

## Visual system

| Token | Value / rule |
| --- | --- |
| Page | #0B1110 |
| Sidebar | #0E1714 |
| Card surface | #15201C |
| Border | #26382F |
| Emerald action color | #19B882 |
| Primary text | #F4F5EE |
| Muted text | #A0B2A8 |
| Text on emerald buttons | #041D13; check final contrast |
| Warning | #D9A44C |
| Error | #E88383 |
| Spacing | 4, 8, 12, 16, 24, 32, 48, 64 px |
| Card radius | 12 px |
| Button / input radius | 10 px |
| Inputs | At least 44 px high |
| Main controls | At least 44 x 44 px touch targets |
| Desktop sidebar | Approximately 240 px |
| Main content padding | 32 px desktop, 24 px tablet, 16 px mobile |

Use one neutral geometric sans-serif family, such as Inter with a system sans-serif fallback. Use locally bundled fonts or an already approved font source. Headings are bold, body text medium/regular. Desktop page titles are about 36-44 px; the public hero headline is about 56-72 px. Mobile titles are about 28-32 px. Body is 16 px, supporting text 14 px, small labels at least 12 px.

Use restrained warm amber venue photography against the dark evergreen interface. Shadows are subtle. Borders and spacing establish hierarchy. Use one coherent line-icon family. Keep all focus outlines visible. Primary button text should use the dark on-accent token where that improves contrast over the mockups.

The original transparent logo is in assets/frekvencija-logo-approved.png. For the dark interface use assets/frekvencija-logo-on-dark.png, which has an intentional opaque dark backing; place it on a matching dark brand area. Preserve the aspect ratio and the green icon. Do not append .mk or .online to the logo.

## Routes and screen mapping

| Route | Role | Reference | Main behavior |
| --- | --- | --- | --- |
| / | Public | 01 | Explain the product; request access or log in |
| /login | Public | 02 | Email/password authentication |
| /forgot-password | Public | 02 form system | Send reset instructions |
| /reset-password | Valid reset session | 02 form system | Choose a new password |
| /request-access | Public | 02 form system | Submit business contact details |
| /radio | Business | 03 and 04 | Genre selection and venue playback |
| /account | Business | 03 shell, 06 form styling | View business details, password reset, sign out |
| /admin/music | Admin | 05 | Upload, search, tag, activate, and edit tracks |
| /admin/businesses | Admin | 06 | Manage venues, invitations, and access |
| /admin/businesses/:id | Admin | 06 detail panel | Profile, genre access, announcement links |
| /admin/announcements | Admin | 07 | Choose venue, create, preview, approve, manage clips |
| /admin/genres | Admin | 08 | Create, order, edit, and deactivate genres |
| /admin/settings | Admin | Shared form components | Platform preferences and integration status |
| /privacy and /terms | Public | Public shell | Owner-supplied policy content |

The screenshots cover the eight main views. Ancillary forms use the same components and spacing; their fields and behavior are specified below.

## 01 - Public homepage

Keep the supplied section order: header; two-column hero; venue categories; three steps; genre collection; personalized-station feature; FAQ; final request-access CTA; footer.

Exact headline: **Your place. Your sound. Your radio.**  
Supporting copy: **Music for your atmosphere. A station with your name.**

Navigation: How it works scrolls to the three steps; Genres scrolls to the genre section; Log in opens /login; every Request access button opens /request-access. Explore all genres expands the public genre collection or scrolls to it. Contact opens the access/contact form. Privacy and Terms open their named routes.

Treat the hero player as an explicitly labeled station example, not a claim that this visitor is logged in. If a public genre card has a play button, it must open the login/request-access path unless a real, authorized public sample is configured. Do not accidentally expose the private music catalogue or create fake playback. Use no invented testimonials, customer totals, prices, free trials, or licensing claims.

FAQ answers:
- Can I change the music? Choose another genre whenever you like.
- Will my business name be announced? Your station can play approved recordings with your business name between songs.
- Do I need special equipment? Use a supported browser on a device connected to your venue's sound system and an internet connection.

The request form needs business name, business type, contact name, and email; phone is optional. Store submissions for the owner in an access-request list reachable from Businesses. Show a real submission result and handle duplicate/error cases. No account is automatically approved. Contact addresses and policy content are owner configuration; do not invent production details.

## 02 - Login and related forms

Desktop is a warm photo panel on the left and a calm form on the right. Mobile is a single-column form, with the photograph removed or reduced to a small header.

Inputs have persistent labels, normal autocomplete, an accessible show-password control, and field-level validation. Use a clear submitting state. A login error must not reveal whether an account exists. Forgot password uses the same form shell and a neutral result message. Reset password supports a new password and confirmation, with a clear expired-link recovery path.

Business account details are read-only when controlled by the owner. Business users can request a password reset and sign out. If changing account email is supported, use the authentication provider's verified flow. They cannot change station branding or genre entitlements.

## 03 and 04 - Venue radio

Use the business's station name as the main heading. Keep Frekvencija's logo in the app shell, without overwhelming venue branding. The supplied screens show EmeraldBar Radio as an example.

Maintain a single persistent audio controller across app routes. The large control and fixed mini-player control the same state. Pause freezes the current music or announcement. Skip applies to music only and does not increment the completed-track announcement counter.

Clicking a genre card body selects the genre and preserves paused/playing state. An explicitly labeled Play genre control is a user action that can select and start that genre. Distinguish these actions in accessible labels. When already playing, switching genres cancels pending old-genre transitions and moves cleanly to the new genre.

Keep the upcoming queue read-only. Genre and music availability must reflect server authorization, even for prefetched items.

The station-voice card previews only that venue's active clips. Previewing audio must never mix uncontrolled with live station audio: pause the main player, preview the clip, and offer an explicit return to the prior playback state. Do not insert the preview into the station's song counter.

The desktop mockup contains a small previous-track icon. Omit it in the MVP; retain Play/Pause and Skip as specified. The progress display is read-only unless seeking is intentionally implemented and tested.

On mobile use a top brand bar, two-column genre grid, and persistent mini-player above Radio/Account bottom navigation. Add safe-area and bottom padding so content remains reachable. Include a usable volume control when supported; native device controls remain available. Announcements and upcoming tracks can collapse into compact sections on smaller screens.

## 05 - Music library

Provide real multi-file upload selection and a queue with upload progress, status, cancel/retry, and clear errors. Validate supported MP3 uploads. Metadata can be edited after upload. The library updates without redeployment.

Selection opens a track editor; changes require Save. Search and filters work against real data. Genre assignment may include multiple genres. File replacement retains the catalogue record as appropriate, invalidates old media references, and becomes available on the next safe queue refresh.

The mockup shows an Active filter while a Draft row is visible. Correct this in implementation: the default is All statuses; selecting Active excludes draft records. Track counts, durations, progress percentages, and statuses come from data, never hardcoded screenshot numbers.

## 06 - Businesses

The table and detail panel show selected business context clearly. Add business opens a form for business name, station name, contact email, type, and genre access. Invite the contact through the authentication provider. Display Active, Invited, or Inactive accurately.

Profile changes persist only on Save. Genre access reflects the business's actual entitlement rules. Manage announcements navigates with the selected business context. Password-reset actions initiate the provider flow; they never reveal a password.

Changing the station name flags affected announcements for review. Deactivation prevents further authorized playback requests. Do not relabel an account as currently listening merely because the account is Active.

## 07 - Announcements

The venue selector must never leak another venue's data to ordinary business users; this full editor is admin-only.

Keep two modes: Generate voice and Upload recording. Require valid text, supported language, and an available voice before generation. If the integration is not configured, show that state clearly and keep recording upload usable.

Generated audio appears as Ready for review. Only explicit Approve & activate can publish it. Previously active recordings stay available during a failed new generation. Every clip is owned by one business. Character counters and audio duration are calculated, not copied from the example.

Announcement frequency is based on completed music tracks. Default is four. Voice volume is independently adjustable. Rate limits, duplicate-generation prevention, and all provider credentials are handled server-side.

The mockup's 10 MB upload note is illustrative. Show the actual configured limit consistently with backend validation.

## 08 - Genres

The owner controls genre names, descriptions, cover images, active state, order, and availability. Save changes must persist the editor. Reordering must also offer keyboard-accessible Move up/Move down actions.

Genre covers accept validated image formats and meaningful alt text or decorative treatment as appropriate. Existing tracks can be assigned through Manage tracks, which opens the library filtered to this genre.

Availability supports all businesses or a selected set. The server computes permitted genres from the chosen rule, including any explicit per-business configuration. Disabled genres disappear from future selection and queues safely; handle the currently playing item predictably.

Deleting or deactivating a genre must not unexpectedly delete its shared audio files.

## Responsive layouts and interaction states

Desktop >=1024 px: full sidebar and split panels. Tablet 640-1023 px: compact navigation and stacked detail panels when needed. Mobile <640 px: navigation drawer or simple bottom tabs; 16 px margins; two-column genre cards; forms and admin detail panels become full width. Preserve column labels in a scrollable table or convert to labeled row cards.

Use an accessible drawer/dialog for mobile editors. Escape closes dialogs; focus returns to the trigger. Confirm destructive actions. Warn before discarding unsaved edits when appropriate.

Provide these states with the same visual system:
- Loading: stable skeleton blocks matching final geometry.
- Empty catalogue: "No music available yet." and owner/admin-specific recovery.
- No search results: offer Clear filters.
- Paused: clear Play action; no animated playing indicator.
- Buffering: visible buffering status, bounded recovery.
- Playback blocked: "Tap to resume your radio."
- Network failure: retry action and accurate playback state.
- No approved announcement: music continues; admin sees the setup action.
- Upload/generation failure: specific recoverable message and Retry.
- Session expired: preserve safe preferences, stop unauthorized access, reauthenticate.
- Inactive business: explain access status and provide the configured contact path.

Use keyboard-operable controls, visible focus, meaningful accessible names, sufficient contrast, and reduced-motion support. Announce errors/status changes without constantly announcing playback progress.

## Assets and data

The package includes full-size PNG screen references, the original approved transparent logo, a clean dark-background logo version, and one reusable venue photograph. The smaller genre photos inside the mockups are art-direction references, not separate production image files.

Use supplied genre covers when available. Until the owner uploads them, use deliberate neutral genre artwork or appropriately cropped/tinted variations of the included venue image. Keep cover upload in the admin experience. Do not crop controls or text out of screenshots and use them as production UI.

The example songs and venues illustrate hierarchy only. No real music, generated speech, secret keys, credentials, or working account access are included.

## Build and review

Implement the shared shell and components, then the player, authentication, catalogue/admin flows, public pages, and remaining states. Use the current official provider documentation referenced in FUNCTIONAL-BUILD-PROMPT.md.

At minimum review desktop at 1440 px, tablet at 768 px, and mobile at 390 px. Compare the rendered results with the supplied compositions, including spacing, selected states, content density, and fixed-player overlap. Test keyboard operation and meaningful authorization/playback cases.

The acceptance goal is a functioning, maintainable application following this design, not merely a similar static landing page. Complete the working implementation and list only external configuration genuinely required to run it.

