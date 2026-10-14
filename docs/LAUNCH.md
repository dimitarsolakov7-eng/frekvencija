# Launch checklist

This is the list of steps that take Frekvencija from "works on the PC" to "live at
<https://frekvencija.online>". It is written for the owner: no programming needed, only accounts,
copy-and-paste and a few clicks. Plan for 1–2 hours, plus waiting for internet addresses to update
(usually minutes, at most a day).

Already done: the app is built and tested, the Supabase project has its database structure, your
admin account exists, and playback was confirmed end to end on 6 October 2026.

## Before you start: what you need

| Account / thing | Why | Status |
| --- | --- | --- |
| GitHub (`dimitarsolakov7-eng`) | The code lives at <https://github.com/dimitarsolakov7-eng/frekvencija>, branch `frekvencija-mvp` | have |
| Supabase | The database, the music files and the sign-in system (project `rqybdoiknzisphqscgty`) | have |
| Vercel | Hosts the website. Sign up with your GitHub account. The free **Hobby** plan is for personal, non-commercial use only; since venues will pay you, use the **Pro** plan (about US$20 per month) | to create |
| Your domain registrar | Wherever `frekvencija.online` was bought. You will add a few DNS records there | have |
| Resend | Sends the sign-in emails (invitations, password resets). The free plan (3,000 emails per month) is plenty. Postmark, Brevo or SendGrid work too | to create |
| The file `.env.local` | On the PC in `Desktop\Music Radio`. It holds the keys you will copy into Vercel. Never share it or put it on GitHub | have |

## Step 0: make sure Supabase is awake

On the free plan, Supabase **pauses a project after 7 days without use**. When the project was
checked on 14 October 2026, its address did not answer at all, which is what a paused project looks
like (the last use was on 6 October).

1. Open <https://supabase.com/dashboard> and click the project. If it says **Paused**, click
   **Restore project** and wait a few minutes.
2. Stop it from happening again: a paused project means silence in every venue. Under
   **Organization → Billing**, move to the **Pro** plan (about US$25 per month). It also removes
   the free plan's 1 GB limit on stored files (roughly 250 songs) and adds daily backups.

## Step 1: put the site on Vercel

1. Go to <https://vercel.com>, choose **Sign Up**, then **Continue with GitHub**.
2. Click **Add New… → Project**, find **frekvencija** in the list and click **Import**.
3. On the configuration screen, **Framework Preset** should already say **Next.js**. Leave the
   root directory and the build settings as they are.
4. Open **Environment Variables** and add these five, copying the values from `.env.local`
   (open it with Notepad; each line is `NAME=value`, and you copy only the part after `=`):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | same as in `.env.local` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same as in `.env.local` |
   | `SUPABASE_SECRET_KEY` | same as in `.env.local` (this one is secret: it never goes anywhere else) |
   | `NEXT_PUBLIC_SITE_URL` | `https://frekvencija.online` (exactly this, no slash at the end) |
   | `ELEVENLABS_API_KEY` | only if you have one; otherwise skip it |

   Do **not** copy `SUPABASE_DB_PASSWORD` or the other `SUPABASE_DB_…` lines. They are only for
   database updates from the PC.
5. Click **Deploy** and wait 2–3 minutes. When it says **Congratulations**, open the site: the
   homepage should appear at a `…vercel.app` address. Logging in with a password already works;
   only the emails wait for Step 4.
6. In the project's **Settings → Git**, check that **Production Branch** says `frekvencija-mvp`.
   From now on, every change pushed to that branch goes live by itself within minutes.

## Step 2: connect frekvencija.online

1. In the Vercel project, open **Settings → Domains**, click **Add** and enter
   `frekvencija.online`. Add `www.frekvencija.online` too and accept Vercel's offer to redirect it
   to the main address.
2. Vercel now shows the DNS records it needs (typically an **A** record for `frekvencija.online`
   pointing to `76.76.21.21`, and a **CNAME** for `www` pointing to `cname.vercel-dns.com`; use
   exactly what Vercel shows you). Log in at your domain registrar, open the DNS settings for
   `frekvencija.online`, and add them.
3. Back in Vercel, wait until the domain shows **Valid Configuration** (usually minutes, up to
   24 hours). HTTPS (the padlock) is set up automatically.
4. Open <https://frekvencija.online>. The homepage should load.

## Step 3: tell Supabase the live address, and lock sign-ups

In <https://supabase.com/dashboard>, open the project, then **Authentication** in the left menu.

1. **URL Configuration**: set **Site URL** to `https://frekvencija.online`. Under **Redirect
   URLs**, add `https://frekvencija.online/**` and keep `http://localhost:3000/**` (for working on
   the PC). Save.
2. **Sign In / Providers → Email**: keep Email enabled, but turn **off** "Allow new users to sign
   up". Accounts are invitation-only; invitations keep working. Save.
3. **Emails → Templates**: for the two templates below, replace the whole message body with the
   text shown (the subject line is yours to write). These links open a **Continue** page in the
   app and then let the person choose a password.

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

4. Optional: under **Sign In / Providers → Email**, the **Email OTP Expiration** (default 3600
   seconds = 1 hour) also decides how long invitation links work. `86400` (24 hours) is reasonable,
   so a venue owner can open the invitation the next morning.

## Step 4: make the emails arrive

Without this step, Supabase sends at most 2 emails per hour, and only to you. Venues would never
receive their invitations or password resets.

1. Go to <https://resend.com> and sign up. Open **Domains → Add Domain**, enter
   `frekvencija.online`. Resend shows a few DNS records (for verification and signing). Add them at
   your registrar, exactly like in Step 2, then click **Verify**. This can take up to an hour.
2. In Resend, open **API Keys → Create API Key**, name it `Frekvencija Supabase`, and copy the key.
   It is shown only once.
3. In Supabase, open **Authentication → Emails → SMTP Settings** and enable **Custom SMTP**:

   | Field | Value |
   | --- | --- |
   | Sender email | `no-reply@frekvencija.online` |
   | Sender name | `Frekvencija` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the API key from Resend |

   Save.
4. Still in Supabase, open **Authentication → Rate Limits** and raise the number of emails per
   hour from 2 to, say, 30.
5. Test it: open <https://frekvencija.online/forgot-password>, enter your admin email, and check
   your inbox. The email should arrive within a minute, its link should open a page with a
   **Continue** button, and after that you can choose a new password.

If a provider offers "click tracking" or "link tracking" for the domain, keep it **off**: it
rewrites the links and breaks them.

## Step 5: remove the demo data

The project still holds the example venues EmeraldBar and Hotel Aurora, their demo staff accounts
and the 21 synthetic "Test Loop" tracks. On the PC, in the project folder (or ask Claude):

```bash
npm run demo:remove -- --dry-run
```

This only shows what would be deleted. When it looks right:

```bash
npm run demo:remove -- --yes
```

It deletes the two demo venues (with their announcements, logo and staff memberships), the demo
staff accounts, and the demo tracks together with their audio files. It keeps your admin account,
the nine genres (empty, ready for your music), your settings, and anything you created yourself.
Add `--genres` to delete the demo genres as well. Running it twice is harmless.

## Step 6: your real content

In the admin workspace at <https://frekvencija.online/admin>:

1. **Settings**: your contact email and phone (venues see them on their Help page), the privacy
   policy and the terms of service.
2. **Genres**: keep, rename or add genres; add cover images.
3. **Music library**: upload the MP3s you are licensed to play in venues.
4. **Businesses**: add the first venue and invite its contact. They receive the invitation email
   from Step 4, choose a password, and land on their radio.

The full description of every screen is in [SETUP.md §8](SETUP.md#8-first-content).

## Step 7: try it on a phone and a tablet

Sign in as a venue user on an iPhone (Safari) and an Android phone (Chrome), press **Start
Radio**, and check:

- music plays, and an announcement plays after the set number of songs;
- after locking the phone or switching apps, the player shows its real state and offers **Tap to
  resume your radio** (phones stop web audio in the background; this is expected);
- the volume and genre you chose are still there after signing in again.

For the venues themselves, recommend a plugged-in tablet or laptop with the **Keep screen awake**
switch turned on (on their Account and Help pages).

## Optional: ElevenLabs voices

Create a restricted API key in ElevenLabs (permissions: Text to Speech, Voices: read, Models:
read, and User: read to show remaining credits). In Vercel, open **Settings → Environment
Variables**, add `ELEVENLABS_API_KEY`, then go to **Deployments**, open the **⋯** menu of the
latest one and choose **Redeploy**. Details are in [SETUP.md §10](SETUP.md#10-optional-elevenlabs-voice-generation).

## Afterwards

- Every change pushed to the `frekvencija-mvp` branch on GitHub goes live automatically. Vercel
  keeps the previous versions: **Deployments → ⋯ → Instant Rollback** brings one back.
- Keep `.env.local` safe. If a key ever leaks, create a new one in Supabase (**Project Settings →
  API Keys**) and update it in Vercel and in `.env.local`.
- The technical setup guide, for anyone who helps you later, is [SETUP.md](SETUP.md).
