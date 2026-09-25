# Frekvencija — Functional Build Prompt

Read this together with CLAUDE-HANDOFF.md and the numbered screen designs. Working assumptions: you provide the music, businesses choose their genres, and each business hears its own saved station announcements.

You are a senior full-stack developer and web audio engineer. Build a complete, working web application for a personalized radio service for HoReCa businesses: hotels, restaurants, cafés, and bars. The brand is “Frekvencija” and the intended domain is frekvencija.online. Use the supplied approved logo without a domain suffix.

The core experience is simple: I provide a music library organized into genres. Each business logs in, chooses a genre, presses Play, and hears continuous music with occasional spoken announcements using its own business name.

For example, EmeraldBar logs in and chooses House. The music plays, and between songs a voice says, “You’re listening to EmeraldBar Radio.” Then the music continues. Another business choosing House must hear its own branding. Each venue has an independent playback queue using the shared music catalogue. Businesses selecting House all draw from the same House library, but each starts its own sequence when it presses Play.

Build the actual application, backend, database, and audio player. Every main button and workflow must function.

1. Business login and player

Use email and password authentication, password reset, secure sessions, and separate permissions for platform administrators and business users. I create or invite business accounts. Businesses set their own passwords through a secure invitation/reset flow; administrators cannot view passwords.

After login, show the venue’s logo and station name prominently, for example “EmeraldBar Radio.”

The main screen should contain attractive genre cards, a large Start Radio / Play / Pause control, volume and mute controls, a Skip button, the selected genre, and the current song’s title and artist.

Example genres: House, Deep House, Lounge, Jazz, Pop, Rock, R&B, Balkan Hits, and Chillout. These are editable categories managed by the administrator. Add genre cover-image uploads as described in the visual handoff.

Remember the selected genre and volume. Restore those preferences after login, while respecting browser requirements for a user gesture before starting audio.

Include clear loading, buffering, paused, empty-library, and connection-error states. Keep the player active when navigating within the application. Logging out must stop playback and clear the venue-specific player state.

Design for a laptop connected to venue speakers, with a responsive interface for tablets and phones.

2. Platform administrator dashboard

Let me create, edit, activate, and deactivate businesses. Store the business name, station name, logo, contact email, announcement language, and pronunciation spelling.

Let me create, rename, reorder, enable, and disable genres. I can make genres available to all businesses or assign specific genres to particular businesses.

Provide music uploads with progress, validation, and useful errors. For the MVP, support validated, playable MP3 files. Store title, artist, duration, genre assignments, and active status. Allow editing metadata, previewing tracks, and removing tracks from future playback.

Only administrators manage the central music catalogue. Businesses choose from the genres assigned to them. I must be able to add music, replace files, create genres, and update genre assignments at any time through this dashboard, without editing code or redeploying the website. New tracks become eligible when playback queues refresh; the current song can finish. Disabled or removed tracks must be excluded from upcoming playback, including any prefetched queue.

For each business, provide announcement management: text, audio preview, upload, AI generation, approval, activation, and frequency settings.

Show the configured business and genre lists using real database data. Keep billing and advanced analytics outside the MVP.

3. Personalized voice announcements

This is the defining feature.

Each business must have its own saved announcement audio files. Use templates such as:
- “You’re listening to {station_name}.”
- “Welcome to {business_name}. Enjoy the music.”
- “Good music. Good company. This is {station_name}.”

For EmeraldBar, these become “You’re listening to EmeraldBar Radio” and “Welcome to EmeraldBar. Enjoy the music.”

Support two working ways to add announcements: upload a prerecorded MP3, or generate one from text using a server-side ElevenLabs text-to-speech integration. Verify the current provider documentation, available models, and supported languages during implementation.

Let the administrator select an available voice, edit the wording and pronunciation spelling, generate a preview, listen to it, and approve it before publication. Language selection must reflect actual provider support. Uploaded recordings must work independently of the AI provider.

Generate each announcement when requested by the administrator, save the resulting audio, and reuse it during playback. Do not make a paid text-to-speech request each time the announcement plays.

Track draft, generating, ready, failed, and active states. Limit duplicate generation requests and show failures honestly. Keep the API key on the server.

When a business or station name changes, mark affected announcements for review and stop selecting outdated branding until replacements are approved.

Never substitute another business’s recording. If no valid recording is available, continue the music.

4. Music and announcement sequencing

Use an explicit playback state machine with one controller responsible for playback, transitions, and cleanup.

Shuffle the active tracks in the chosen genre. Avoid repeating a track until the available pool has been exhausted, and avoid repeating the same track across reshuffles when alternatives exist. Explain the limitation when a genre has only one track.

On the first explicit Start Radio action of a session, play one approved welcome announcement if available, then start music.

By default, insert one announcement after every four completed music tracks. Let the administrator configure the number per business. Skipped or failed tracks must not count as completed tracks.

Announcements should play between songs. Rotate the business’s approved recordings to avoid repeating the same wording unnecessarily. After an announcement, continue the music automatically.

Example sequence: welcome announcement, song 1, song 2, song 3, song 4, station announcement, song 5.

Preload a small, bounded amount of upcoming audio. Use short fades where supported, with reliable sequential playback as a fallback. Keep voice recordings at a comfortable level relative to the music and provide an administrator adjustment for announcement volume.

Changing genre should switch cleanly to the new selection. Cancel obsolete preload requests and transitions so tracks from the previous genre cannot unexpectedly resume. If the player is paused, changing genre must keep it paused until Play is pressed.

Pause must pause whichever item is currently playing. Prevent duplicate audio caused by repeated clicks, component rerenders, or overlapping transition events.

5. Playback resilience

Handle rejected play() promises and display a clear button when a browser requires another user gesture. Do not claim audio will continue through device sleep, browser termination, or every mobile background condition.

Refresh expiring authorized media URLs when needed. Ensure a URL remains valid long enough for normal playback, buffering, and range requests.

If a song cannot load, retry in a bounded way and then advance to another valid track. Stop endless retry loops and show a useful recovery message if the whole catalogue is unavailable.

If an announcement fails, continue with music. A voice-generation outage must not interrupt playback of previously approved recordings.

Handle temporary network interruptions, session expiry, and unavailable tracks without a stuck spinner. Never present the player as playing when the audio is actually stopped.

6. Security and data separation

Use Supabase Auth, PostgreSQL, and private Supabase Storage with server-side authorization and row-level security.

Business users may only access their own business profile, settings, announcements, and assigned music genres. Enforce these rules in database policies and backend endpoints, including audio URL generation. Do not rely on hidden UI controls or client-supplied business IDs.

Shared catalogue tracks may be available to multiple authorized businesses. Announcement files remain scoped to their owning business.

Use time-limited authorized media URLs. Keep service-role keys and text-to-speech credentials out of frontend code. Apply upload size and type checks, rate limits for sensitive actions, and server-side validation.

Store credentials only through the authentication provider. Users must not be able to promote their own role or change genre entitlements.

7. Design and implementation

Use current stable Next.js with TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL/Storage, and browser audio APIs. Pin compatible dependency versions and follow current official documentation.

Create a polished music interface with a dark charcoal background, a restrained emerald accent, clean typography, large controls, and clear contrast. Make the business’s branding the focus of its player. Avoid excessive animation and clutter.

Use a persistent application-level audio controller so route changes do not recreate the player. Use accessible controls with readable labels and keyboard support.

Create the necessary database tables and relationships for profiles/roles, businesses and memberships, genres, tracks and genre assignments, business genre access, announcements, and playback preferences. Include migrations, indexes, validation, and row-level security policies.

Assume the platform owner supplies music authorized for this service and venue playback. Use supplied or clearly permitted demo audio; do not source a catalogue by scraping music services.

8. Delivery and acceptance

Deliver the project files, database migrations and policies, an .env.example without secrets, a setup guide, and instructions for configuring authentication, private storage, and the optional voice API.

Include a safe development seed process with two clearly labeled example businesses, EmeraldBar and Hotel Aurora, several genre categories, and distinct test announcements. Do not deploy public demo credentials or claim unavailable audio exists.

Prove these flows work:
- An administrator uploads music, assigns genres, and activates a business.
- That business logs in, chooses a genre, and plays real audio.
- After four completed songs, its own approved announcement plays and music continues.
- A second business using the same genre hears only its own announcements.
- Attempts to read or sign another business’s announcement files are rejected.
- Rapid genre changes, pause/resume, bad audio files, and failed announcement loads do not create overlapping or stuck playback.
- Uploaded announcements work when no AI provider key is configured.

Run the build and meaningful tests for authorization and playback sequencing. Document browser playback checks and distinguish checks actually run from checks still needing real credentials or manual validation.

Begin with a short implementation plan, then build the application in the workspace. Make reasonable implementation choices and keep working through the core flow. If an external credential is missing, finish the available implementation and identify the exact configuration needed. Keep the first version focused on login, genre selection, continuous music, and business-specific voice announcements.

Implementation references checked on 24 September 2026:

- [MDN: Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [Supabase: Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [ElevenLabs: Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
