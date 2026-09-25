# Supabase integration notes (Venue Radio)

Researched 2026-09-25 against the **installed** packages (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` /
`auth-js` / `storage-js` / `postgrest-js` 2.117.1, `next` 16.3.6, TypeScript 5.9.3), the Supabase
Storage server and Auth (GoTrue) server sources on GitHub (master), the Supabase CLI source, and the official docs.

Legend: **[src]** read in installed source, **[run]** verified by a spike (mock fetch / tsc / PGlite),
**[srv]** read in Supabase server source (storage-api / auth / cli on GitHub), **[doc]** official docs,
**UNVERIFIED** means inferred and not confirmed.
Spikes: `%TEMP%\claude\...\scratchpad\supabase\spike\` (`storage-requests.mjs`, `ssr-cookies.mjs`,
`admin-requests.mjs`, `types-check*.ts`, `rls-pglite.mjs`, `seq.mjs`).

---

## 0. The rules that matter most

1. **Use one server client per request**, created with `getAll`/`setAll`. Never cache it in a module global (`@supabase/ssr` README; design.md).
2. **`src/proxy.ts` must call `supabase.auth.getClaims()` right after `createServerClient`** and must return the response object that `setAll` last built. Server Components cannot write cookies, so if a Server Component refreshes the token instead, the rotated refresh token is lost and the user gets signed out. [src][doc]
3. **Check identity with `getClaims()`**, not `getSession()`. `getClaims()` → `{ data: null, error: null }` when signed out, so always check `data?.claims`. [src][run]
4. **Never create the secret-key (admin) client with `createServerClient`.** A secret key bypasses RLS only when the request carries **no user token**. The SSR client would attach the user's cookie session, so RLS would apply again. Use plain `createClient` with `persistSession:false`. [doc][src]
5. **Every table migration needs explicit GRANTs + `enable row level security` + policies.** New projects created after 2026-05-30 no longer auto-grant `anon/authenticated/service_role` on `public`. On 2026-10-30 existing projects change too. A missing grant returns `42501` even for `service_role`. [doc]
6. **Private-bucket signing uses RLS.** `createSignedUrl(s)` with a user JWT needs a **SELECT** policy on `storage.objects`. `createSignedUploadUrl` needs **INSERT** (plus SELECT+UPDATE when `upsert:true`). `uploadToSignedUrl` needs **no** policy and runs as superuser, with the owner taken from the token. [src][srv]
7. **Storage rows cannot be deleted with SQL.** A trigger blocks `DELETE` on `storage.objects`/`storage.buckets` (`42501`, "Use the Storage API instead"). Clean up objects with `storage.from(b).remove([...])`. [srv]
8. **Invite and recovery emails must use `token_hash` templates.** Invites do not support PKCE. The default invite link returns tokens in the URL **fragment**, and the server cannot read the fragment. [src][doc]
9. **The default SMTP only delivers to your org's team members, at 2 emails/hour.** Real venue invites need custom SMTP, or `admin.generateLink()` plus a link you deliver yourself. [doc]
10. **Email links (including invites) expire after 1 hour by default** (Auth → Email → "Email OTP expiration"). [doc]

---

## 1. API keys & env vars

| Key | Format | Postgres role | Where |
| --- | --- | --- | --- |
| Publishable | `sb_publishable_…` (not a JWT) | `anon` (no session) / `authenticated` (with user JWT) | browser + server |
| Secret | `sb_secret_…` (not a JWT) | `service_role` (BYPASSRLS) | server only. Supabase returns **401 for browser User-Agents** |
| legacy anon / service_role | `eyJ…` JWT | same as above | deprecated "by the end of 2026"; both key systems work side by side until the legacy keys are disabled |

Env names (official docs + our ARCHITECTURE.md):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # legacy fallback NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY=sb_secret_...                        # legacy fallback SUPABASE_SERVICE_ROLE_KEY; never NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=http://localhost:3000               # no trailing slash (used to build email redirect origins)
```

supabase-js 2.117.1 accepts the new keys as-is [src `supabase-js/src/lib/fetch.ts`, run]:
- It always sends `apikey: <key>`.
- It sends `Authorization: Bearer <user access token>`, or falls back to `Bearer <key>` when there is no session. The fallback is skipped only for Edge Functions with new-format keys.
- The auth client always sends `Authorization: Bearer <key>` + `apikey` (admin calls verified in spike).
- An unknown `sb_xxx_` subtype only logs a warning. A key is never rejected client-side.

---

## 2. Clients (`@supabase/ssr` 0.12.7)

### 2.1 Signatures [src]

```ts
createServerClient<Database = any, SchemaName = 'public'>(
  supabaseUrl: string,
  supabaseKey: string,
  options: SupabaseClientOptions<SchemaName> & {
    cookieOptions?: CookieOptionsWithName;          // { name?, domain, path, sameSite, secure, maxAge, ... }
    cookies: CookieMethodsServer;                     // { getAll, setAll?, encode?: 'user-and-tokens' | 'tokens-only' }
    cookieEncoding?: 'raw' | 'base64url';             // default 'base64url'
  },
): SupabaseClient<Database, SchemaName>

createBrowserClient<Database, SchemaName>(url, key, options?: SupabaseClientOptions & {
  cookies?: CookieMethodsBrowser; cookieOptions?; cookieEncoding?; isSingleton?: boolean
}): SupabaseClient<Database, SchemaName>   // singleton in the browser by default

type GetAllCookies = () => Promise<{ name: string; value: string }[] | null> | { name: string; value: string }[] | null
type SetAllCookies = (
  cookies: { name: string; value: string; options: CookieOptions }[],
  headers: Record<string, string>,   // NEW: 'Cache-Control','Expires','Pragma' anti-CDN-cache headers; only on the FIRST write per client
) => Promise<void> | void
```

Forced settings for the server client [src]: `flowType:'pkce'`, `autoRefreshToken:false`, `detectSessionInUrl:false`, `persistSession:true`, `skipAutoInitialize:true`. The session loads lazily on the first `getClaims/getUser/getSession`. `auth.storage` is ignored (with a warning).

Cookie facts [run]:
- Name `sb-<project-ref>-auth-token` (chunked `.0`, `.1` … above 3180 chars).
- Value prefixed `base64-`.
- Default options `{ path:'/', sameSite:'lax', httpOnly:false, maxAge:34560000 /*400 days*/ }`.
- Sign-out writes the same name with `maxAge:0`.
- `setAll` fires **before** `signInWithPassword()` resolves, so cookies are written inside the Server Action.
- PKCE verifier cookies end with `-code-verifier` and are written immediately.

### 2.2 `src/lib/supabase/server.ts` (Server Components, Server Actions, Route Handlers)

Official example [doc/github supabase/examples/auth/nextjs]. Next 16 `cookies()` returns a Promise [src next d.ts].

```ts
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: ignore, the proxy refreshes sessions.
          }
        },
      },
    },
  );
}
```

Cookie writes succeed in Server Actions and Route Handlers. They throw (and are swallowed) in Server Components.

### 2.3 `src/lib/supabase/proxy.ts` + `src/proxy.ts`

With a `src/` dir, the file is `src/proxy.ts`. Export a `proxy` function (or default). The runtime is Node.js, and `runtime` config is not allowed. Only one proxy file is allowed [src next docs `16-proxy.md`]. The code below is the official example [github supabase/examples/auth/nextjs/lib/supabase/proxy.ts]:

```ts
// src/lib/supabase/proxy.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
          Object.entries(headers).forEach(([k, v]) => supabaseResponse.headers.set(k, v));
        },
      },
    },
  );
  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  // ...optimistic redirects only (real authz happens in pages/actions/RLS)...
  // If you return a different response (redirect), copy cookies AND cache headers onto it:
  //   const res = NextResponse.redirect(url);
  //   res.cookies.setAll(supabaseResponse.cookies.getAll());   // (official snippet)
  //   for (const h of ['cache-control','expires','pragma']) { const v = supabaseResponse.headers.get(h); if (v) res.headers.set(h, v); }
  return supabaseResponse;
}

// src/proxy.ts
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

Gotchas:
- The matcher must include **every** route that touches Supabase (pages, `/api/*`, `/auth/*`). Otherwise Server Components/handlers refresh by themselves and lose the rotated token.
- Two parallel requests carrying the same expired session race on the single-use refresh token. The second one sees `session:null` (README). The player's `fetch()`es should retry once on 401.

### 2.4 `src/lib/supabase/browser.ts`

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
```

In the browser, `autoRefreshToken` defaults to true, and the client keeps the cookie session fresh for a long-running player tab.

### 2.5 `src/lib/supabase/admin.ts` (bypasses RLS)

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export function createSupabaseAdminClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
```

[run] Requests carry `apikey: sb_secret_…` and `Authorization: Bearer sb_secret_…`. This is the only client that may call `auth.admin.*`.

---

## 3. Session checks

```ts
// auth-js 2.117.1 [src]
getClaims(jwt?: string, options?: { allowExpired?: boolean; jwks?: { keys: JWK[] } }): Promise<
  | { data: { claims: JwtPayload; header: JwtHeader; signature: Uint8Array }; error: null }
  | { data: null; error: AuthError }
  | { data: null; error: null }          // <- no session: NOT an error
>
// JwtPayload: iss, sub, aud, exp, iat, role, aal, session_id (required) + email?, phone?, is_anonymous?,
//             app_metadata?, user_metadata?, amr?, [key: string]: any
getUser(jwt?: string): Promise<{ data: { user: User }; error: null } | { data: { user: null }; error: AuthError }>
signOut(options?: { scope?: 'global' | 'local' | 'others' })   // DEFAULT 'global' = all devices!
```

- `getClaims()` verifies the JWT signature. With asymmetric signing keys (the default for new projects) it verifies locally against a cached JWKS (`/auth/v1/.well-known/jwks.json`). With a legacy HS256 secret it falls back to a `GET /auth/v1/user` network call [src][run]. It refreshes first if the token is near expiry.
- `getUser()` always makes a network call. Use it only when you need the fresh DB user record, or to reject a just-deleted user.
- `getSession()` is not validated. Only use it to read the raw access token.
- Authorization data: use `claims.app_metadata` (user can't edit it) or a DB lookup (`profiles.role`). **Never `user_metadata`**, which users can change with `updateUser({data})`. JWT claims stay stale until the next refresh (≤ JWT expiry, default 1 h).
- Venue sign-out: use `signOut({ scope: 'local' })`. The default `'global'` logs the account out on every venue device.

---

## 4. Auth flows

### 4.1 Signatures & return shapes [src][run]

```ts
// admin (secret-key client)
auth.admin.inviteUserByEmail(email: string, options?: { data?: object; redirectTo?: string })
  : Promise<{ data: { user: User }; error: null } | { data: { user: null }; error: AuthError }>
  // POST /auth/v1/invite?redirect_to=<enc> body { email, data }
auth.admin.generateLink(params:
    | { type: 'signup'; email; password; options?: { data?, redirectTo? } }
    | { type: 'invite' | 'magiclink'; email; options?: { data?, redirectTo? } }
    | { type: 'recovery'; email; options?: { redirectTo? } }
    | { type: 'email_change_current' | 'email_change_new'; email; newEmail; options?: { redirectTo? } })
  : Promise<{ data: { properties: { action_link; email_otp; hashed_token; redirect_to; verification_type }; user: User }; error: null }
          | { data: { properties: null; user: null }; error: AuthError }>
  // DOES NOT SEND AN EMAIL. Creates the user for invite/magiclink/signup.
auth.admin.createUser(attrs: AdminUserAttributes /* email, password, email_confirm, user_metadata, app_metadata, ban_duration, role, id */): Promise<UserResponse>
auth.admin.updateUserById(uid: string, attrs: AdminUserAttributes): Promise<UserResponse>
auth.admin.getUserById(uid: string): Promise<UserResponse>
auth.admin.listUsers(params?: { page?: number; perPage?: number })
  : Promise<{ data: { users: User[]; aud: string; nextPage: number | null; lastPage: number; total: number }; error: null }
          | { data: { users: [] }; error: AuthError }>
auth.admin.deleteUser(id: string, shouldSoftDelete = false): Promise<UserResponse>   // DELETE /admin/users/:id

// user-facing (server client)
auth.signInWithPassword({ email, password }): Promise<AuthTokenResponsePassword>  // { data:{user,session,weakPassword?}, error }
auth.resetPasswordForEmail(email: string, options?: { redirectTo?: string; captchaToken?: string })
  : Promise<{ data: {}; error: null } | { data: null; error: AuthError }>   // no error for unknown emails (anti-enumeration)
auth.verifyOtp({ token_hash: string; type: EmailOtpType }): Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>
  // EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'
  // fires SIGNED_IN (or PASSWORD_RECOVERY for 'recovery') → ssr writes cookies via setAll
auth.exchangeCodeForSession(authCode: string, options?: { flowId?: string }): Promise<AuthTokenResponse>
  // needs the PKCE verifier cookie from the SAME browser that started the flow; else AuthPKCECodeVerifierMissingError
auth.updateUser(attrs: { password?; email?; data?; nonce?; current_password? }, options?: { emailRedirectTo?: string }): Promise<UserResponse>
```

Behaviour notes [src/srv/run]:
- `deleteUser('not-a-uuid')` **throws** (`validateUUID`). It does not return `{error}`.
- The `listUsers` pagination fields are parsed from the `Link` header. `total` stays `0` when there is only one page. Don't rely on it for small lists.
- **Error handling:** branch on `error.code`, not the message. `AuthApiError` has `status` (number) and `code`. Server 5xx errors become `AuthRetryableFetchError`.

| Situation | status | `error.code` |
| --- | --- | --- |
| invite an already **confirmed** email | 422 | `email_exists` ("A user with this email address has already been registered") |
| invite an existing **unconfirmed** email | 200 | (re-sends the invite, new token) |
| email quota hit | 429 | `over_email_send_rate_limit` |
| expired or used link | 403 | `otp_expired` |
| same password on update | 422 | `same_password` |
| weak password | 422 | `weak_password` (`AuthWeakPasswordError.reasons`) |
| `updateUser` without session | — | `AuthSessionMissingError` |

The invite behaviour comes from `supabase/auth internal/api/invite.go`. Neither invite nor verify checks "disable signups", so **public sign-ups can be turned off and invites still work** [srv; UNVERIFIED end-to-end].

### 4.2 Email templates (Dashboard → Authentication → Emails → Templates)

Official strings [doc: passwords + PKCE-SSR guides]:

```
Confirm signup:  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
Reset password:  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/update-password
Magic link:      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
Invite (docs example, server endpoint): ...?token_hash={{ .TokenHash }}&type=invite&redirect_to={{ .RedirectTo }}
```

Recommended for Venue Radio. `next` is always a fixed relative path:

```html
<!-- Invite user -->
<a href="{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Accept the invitation</a>
<!-- Reset password -->
<a href="{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password">Choose a new password</a>
```

How `{{ .RedirectTo }}` resolves [srv `utilities/request.go GetReferrer`]:
- It is the `redirectTo` you passed, if valid.
- Otherwise it is the `Referer` header, if valid.
- Otherwise it is **Site URL**.

A URL is valid when it is on the Site URL's scheme+host+port (any port for localhost), or when it matches the Redirect URLs allow list.

- Always pass `redirectTo: process.env.NEXT_PUBLIC_SITE_URL` (origin only, **no trailing slash**) to `inviteUserByEmail` / `resetPasswordForEmail`. One template then works for localhost and production. Dashboard-triggered invites fall back to Site URL.
- If you prefer `{{ .SiteURL }}`, local dev links point at production unless Site URL is changed.
- Available variables: `{{ .ConfirmationURL }} {{ .Token }} {{ .TokenHash }} {{ .SiteURL }} {{ .RedirectTo }} {{ .Data }} {{ .Email }}`. `.Data` is the user_metadata passed as `data` in the invite, e.g. `{{ .Data.venue_name }}`.

### 4.3 `/auth/confirm` route

The official template is a Route Handler (GET) [github vercel/next.js examples/with-supabase]. Add the `next` sanitising shown here:

```ts
// src/app/auth/confirm/route.ts
import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');                 // PKCE fallback (default templates / same-browser reset)
  const next = safeNext(searchParams.get('next'));
  const supabase = await createSupabaseServerClient();
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect(next);
    redirect(`/login?error=${encodeURIComponent(error.code ?? 'verify_failed')}`);
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }
  redirect('/login?error=invalid_link');
}
```

- **Email link prefetch** (Microsoft Defender Safe Links, some corporate scanners) sends a GET that **consumes** the one-time token. The user then gets `otp_expired` [doc]. Hotels often use M365.
- Safer variant (recommended pattern, not from the docs): make `/auth/confirm` a page that renders a button `<form action={confirmAction}>` with hidden `token_hash/type/next`. The Server Action calls `verifyOtp` and then `redirect(next)`.
- After `verifyOtp` (invite or recovery), the user has a session. `/set-password` then calls `supabase.auth.updateUser({ password })`. That works from a Server Action with the server client: it fires `USER_UPDATED` and the cookies are rewritten. Invited users have **no password** until they do this.

### 4.4 No-SMTP / manual invite fallback

```ts
const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { data: { venue_name } } });
const link = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?token_hash=${data!.properties.hashed_token}&type=invite&next=/set-password`;
// verifyOtp({ type: 'invite', token_hash }) accepts it. Same for { type: 'recovery' } → type=recovery.
```

This sends no email and uses no email quota. The token expiry is the same (Email OTP expiration).

### 4.5 Dashboard settings checklist

- **URL Configuration:**
  - Site URL = production origin.
  - Redirect URLs = `http://localhost:3000/**` and `https://<prod-host>/**`. `*` does not cross `/` or `.`; `**` matches anything.
- **Emails:**
  - Custom SMTP is required for real users. The default SMTP delivers only to org team addresses ("Email address not authorized"), at 2/h.
  - After enabling custom SMTP, the limit starts at 30/h. Raise it under Auth → Rate Limits.
  - Resend, Postmark, SES and SendGrid are known to work.
  - Disable "email tracking" in the SMTP provider, because it rewrites links.
- **Email OTP expiration:** default 3600 s. It also governs invite and recovery links. Consider 86400 for invites (above 86400 is discouraged and only possible via the Management API).
- **Sign In / Providers:** disable "Allow new users to sign up" (the app is invite-only).
- **Rate limits (defaults):**
  - `/recover`, `/otp`, `/signup`, `/user` are limited per IP, 30 per 5 min (burst 30).
  - `/token` (password and refresh) is 150 per 5 min per IP.
  - `/recover` also allows 1 per 60 s per user.
  - Server-side calls all come from the server IP. To forward the end-user IP, enable "IP address forwarding" and send the `sb-forwarded-for` header **with a secret key** [doc]. Otherwise add our own rate limit.

---

## 5. Storage

### 5.1 Buckets via SQL (SQL editor / migration)

`storage.buckets` columns [srv migrations]:
- `id text PK`, `name text`
- `owner uuid` (deprecated), `owner_id text`
- `public boolean default false`, `avif_autodetection boolean`
- `file_size_limit bigint` (**bytes**, NULL = global limit)
- `allowed_mime_types text[]` (NULL = any; wildcards like `audio/*` allowed)
- `type storage.buckettype default 'STANDARD'`, `versioning_status text default 'DISABLED'`
- `created_at`, `updated_at`

A trigger limits `name` to ≤100 chars.

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('music',         'music',         false, 52428800, array['audio/mpeg', 'audio/mp3']),
  ('announcements', 'announcements', false, 10485760, array['audio/mpeg', 'audio/mp3']),
  ('logos',         'logos',         false,  2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

This is [run] in PGlite against a stub with the real columns. The docs' SQL tab uses the same `insert into storage.buckets (id, name, public)`.

- Buckets **cannot be deleted with SQL** (`protect_buckets_delete` trigger). Use `storage.deleteBucket()` / the Dashboard.
- **Global file size limit** (Storage settings): Free ≤ **50 MB** (can't exceed), Pro/Team ≤ 500 GB. A bucket limit above the global limit is capped by the global limit [doc]. The 50 MB music limit fits the Free plan exactly.
- Bucket limits are enforced on **every** upload path, including signed uploads. The MIME type is taken from the multipart file part's type. A multipart field named `contentType` sent **before** the file overrides it. For raw bodies the `Content-Type` header is used [srv uploader.ts].

### 5.2 `storage.objects` (read-only for us)

Columns [doc schema/design + srv migrations]:
- `id uuid`, `bucket_id text`, `name text` (full path inside the bucket, e.g. `tracks/<id>/<rand>.mp3`)
- `owner uuid` (**deprecated**), `owner_id text` (JWT `sub` of the uploader; NULL when uploaded with the secret key or Dashboard)
- `metadata jsonb` (`size, mimetype, cacheControl, eTag, lastModified, contentLength, httpStatusCode`)
- `path_tokens text[]`, `version text`, `user_metadata jsonb`
- `created_at`, `updated_at`, `last_accessed_at`
- newer: `is_versioned`, `is_delete_marker`, `archived_at`

Other facts:
- Compare the owner as `owner_id = (select auth.uid())::text`.
- Helpers: `storage.foldername(name) → text[]` (all but the last segment, 1-based), `storage.filename(name) → text`, `storage.extension(name) → text`.
- New helpers: `storage.allow_only_operation('object.list')` / `storage.allow_any_operation(array[...])` limit a SELECT policy to specific API operations. Operation names include `storage.object.sign`, `storage.object.sign_many`, `storage.object.get_authenticated`, `storage.object.list`, `storage.object.upload`, `storage.object.sign_upload_url`. The `storage.` prefix is optional. Without such a filter, a SELECT policy also allows **listing**.
- Storage already grants `anon/authenticated/service_role` on `storage.objects`. You only add policies.
- The Storage API evaluates policies as `authenticated`/`anon` with the request JWT, so `auth.uid()` and our `private.*` helpers work. The role then needs `usage on schema private` + `execute` [run].

### 5.3 Which policy each call needs (`storage.objects`; `buckets` needs none) [src remarks, srv confirmed for sign/upload]

| Call | Policies needed for the caller's role |
| --- | --- |
| `upload(path, body)` | INSERT (+ SELECT, UPDATE when `upsert:true`) |
| `update(path, body)` / `move(from,to)` | SELECT + UPDATE |
| `copy(from,to)` | SELECT + INSERT |
| `download(path)` / `list()` / `createSignedUrl(s)` | **SELECT** (signing runs `findObject` under the caller's RLS) |
| `createSignedUploadUrl(path, {upsert})` | **INSERT** (+ SELECT, UPDATE if upsert). The check runs **at signing time** |
| `uploadToSignedUrl(path, token, body)` | none. The route skips JWT auth and uploads as superuser, with `owner` from the token |
| `remove([paths])` | SELECT + DELETE. UNVERIFIED: rows hidden by RLS are skipped silently (`data: []`, no error), so check `data.length` |
| any call with the secret key | bypasses RLS |

So yes: `createSignedUrl` called with a **user JWT** is gated by storage RLS. A missing SELECT policy returns `StorageApiError` 400 / statusCode `'404'`, "Object not found". `createSignedUrls` returns per-item `error: 'Either the object does not exist or you do not have access to it'`.

Example policies (syntax + behaviour [run] in PGlite; adapt the helpers to ARCHITECTURE §5.4):

```sql
create policy "music: admin all" on storage.objects for all to authenticated
  using ( bucket_id in ('music','announcements','logos') and (select private.is_platform_admin()) )
  with check ( bucket_id in ('music','announcements','logos') and (select private.is_platform_admin()) );
create policy "music: member read" on storage.objects for select to authenticated
  using ( bucket_id = 'music' and private.track_object_accessible(name) );
create policy "announcements: member read" on storage.objects for select to authenticated
  using ( bucket_id = 'announcements'
          and (storage.foldername(name))[1] = (select private.active_member_business_id())::text
          and private.announcement_object_accessible(name) );
```

`for all` covers select/insert/update/delete. The docs prefer one policy per operation for clarity. Either works.

### 5.4 Signed download URLs

```ts
createSignedUrl(path: string, expiresIn: number /* seconds, integer ≥ 1 */, options?: {
  download?: string | boolean; transform?: TransformOptions; cacheNonce?: string; versionId?: string
}): Promise<{ data: { signedUrl: string }; error: null } | { data: null; error: StorageError }>
createSignedUrls(paths: string[], expiresIn: number, options?: { download?: string | boolean; cacheNonce?: string })
  : Promise<{ data: { error: string | null; path: string | null; signedURL: string | null; signedUrl: string | null }[]; error: null } | { data: null; error: StorageError }>
```

- [run] Request: `POST {url}/storage/v1/object/sign/{bucket}/{path}` body `{"expiresIn":N}`. The batch version is `POST /object/sign/{bucket}` body `{"expiresIn":N,"paths":[…]}`.
- Result: `https://<ref>.supabase.co/storage/v1/object/sign/{bucket}/{path}?token=<JWT>` (`encodeURI`d). `download` appends `&download=…`, which sets Content-Disposition attachment. **Don't use `download` for playback.**
- Tokens are signed with a per-project URL-signing key, separate from Auth keys. You can't revoke them; they stay valid until `exp`. If the object is deleted, the URL returns 404.
- **Range / seeking:**
  - The signed GET route (no auth, superuser) forwards the `Range` header to the backend.
  - It responds with `Accept-Ranges: bytes` + `Content-Range` (206) [srv renderer.ts, asset.ts].
  - **Every** GET re-verifies token expiry, and `<audio>` issues new Range requests while buffering or seeking. So `expiresIn` must cover the whole track plus margin; re-sign before starting a track (ARCHITECTURE's `duration + 120 s` rule is right).
- **CORS:**
  - `<audio src>` without `crossOrigin` needs no CORS.
  - `fetch`/XHR and Web Audio (`crossOrigin="anonymous"` + `createMediaElementSource`) need CORS. The storage server leaves CORS to the gateway ("kong should take care of cors"). Browser supabase-js calls with custom headers work on hosted projects, which implies permissive CORS. UNVERIFIED on a live project: exact `Access-Control-Allow-Origin: *` on signed GETs.
- **Caching:** the CDN and browser cache per URL. A re-signed URL is a new URL, so it is a cache miss. Re-use one signed URL per track while it is valid. Upload immutable objects (random path, never overwritten) with `cacheControl: '31536000'`. Private buckets get a worse CDN hit ratio than public ones [doc].

### 5.5 Signed upload URLs + progress (XHR replica)

```ts
createSignedUploadUrl(path: string, options?: { upsert: boolean })
  : Promise<{ data: { signedUrl: string; token: string; path: string }; error: null } | { data: null; error: StorageError }>
  // POST {url}/storage/v1/object/upload/sign/{bucket}/{path}  body {}  (+ header x-upsert: true)
  // signedUrl = https://<ref>.supabase.co/storage/v1/object/upload/sign/{bucket}/{path}?token=<JWT>
uploadToSignedUrl(path: string, token: string, fileBody: FileBody, fileOptions?: FileOptions)
  : Promise<{ data: { path: string; fullPath: string }; error: null } | { data: null; error: StorageError }>
```

- Validity: the docs say "valid for 2 hours" on hosted. The storage-server env default is 60 s when unset (self-hosted). Create the URL right before uploading.
- Upsert is decided by the **token** (the `x-upsert` header at signing time). The `x-upsert` header on the PUT is ignored by the server [srv uploadSignedObject.ts].
- The object's `owner_id` = `sub` of whoever **signed** it (NULL if signed with the secret key).

**Exact request made by `uploadToSignedUrl` for a `File`/`Blob`** [src + run]:

```
PUT https://<ref>.supabase.co/storage/v1/object/upload/sign/<bucket>/<path>?token=<token>
headers: apikey: <key>
         authorization: Bearer <session access token | key>
         x-client-info: supabase-js/2.117.1
         x-upsert: false
         (Content-Type: multipart/form-data; boundary=…, set by the runtime; do NOT set it yourself)
body (FormData, in this order):
  "cacheControl" = "3600"               (FileOptions.cacheControl, default '3600' → stored as max-age=3600)
  "metadata"     = JSON string          (only if fileOptions.metadata)
  ""             = <the File/Blob>      (EMPTY field name)
response 200: {"Key":"<bucket>/<path>"}
error: HTTP **400** for every client error (500 stays 500); body {statusCode, code, error, message}. The real code is in body.statusCode [srv]:
       '409' ResourceAlreadyExists "The resource already exists" | '413' EntityTooLarge "The object exceeded …"
       '415' InvalidMimeType "mime type X is not supported" | '404' NoSuchKey "Object not found" | '403' access denied / RLS
       (supabase-js exposes these as StorageApiError.status = 400, .statusCode = '409', .code = 'ResourceAlreadyExists')
```

- For non-Blob bodies (ArrayBuffer/stream/string) there is no FormData. The request sends the raw body with `content-type: <contentType>` and `cache-control: max-age=<cacheControl>`.
- Note: `contentType` in FileOptions is **ignored for Blob/File** bodies (the part's own type is used).

Replica for `src/lib/uploads/client.ts`. It is written from the verified request shape; the XHR itself has not been run against a live project:

```ts
export function uploadWithProgress(
  signedUrl: string,
  file: Blob,
  opts: { cacheControl?: string; contentType?: string; publishableKey?: string; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<{ Key: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    // The signed-upload route itself needs no auth [srv]. Sending apikey mirrors supabase-js and is harmless
    // (public key). UNVERIFIED whether the hosted gateway requires it.
    if (opts.publishableKey) xhr.setRequestHeader('apikey', opts.publishableKey);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total); };
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(Object.assign(new Error(body?.message ?? `Upload failed (${xhr.status})`), { status: xhr.status, body }));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('cacheControl', opts.cacheControl ?? '3600');
    if (opts.contentType) form.append('contentType', opts.contentType);  // must precede the file part [srv]
    form.append('', file);
    xhr.send(form);
  });
}
```

- Pass `contentType: 'audio/mpeg'` for MP3s. Some OS/browser combos report `''` or `audio/mp3` for `.mp3`, and a bad type is rejected by `allowed_mime_types`.
- Standard (single-request) upload is fine up to the plan limit. The docs recommend TUS resumable upload above 6 MB for flaky networks: `https://<ref>.storage.supabase.co/storage/v1/upload/resumable`, 6 MB chunks, signed via `x-signature: <token>`. We upload browser → Storage directly, so Next/Vercel body limits don't apply.

### 5.6 download / remove / move [src + run]

```ts
download(path, options?: { transform?; cacheNonce?; versionId? }, parameters?: { signal? }): BlobDownloadBuilder
  // await → { data: Blob; error: null } | { data: null; error: StorageError };  .asStream() for a ReadableStream
  // GET {url}/storage/v1/object/{bucket}/{path}
remove(paths: (string | { path: string; versionId: string })[]): Promise<{ data: FileObject[]; error: null } | { data: null; error: StorageError }>
  // DELETE {url}/storage/v1/object/{bucket}  body {"prefixes":[...]}
move(fromPath: string, toPath: string, options?: { destinationBucket?: string; sourceVersionId?: string })
  : Promise<{ data: { message: string }; error: null } | { data: null; error: StorageError }>
  // POST {url}/storage/v1/object/move body {bucketId, sourceKey, destinationKey}
```

`StorageApiError` has `status: number` (HTTP), `statusCode: string` (API code, e.g. `'404'`), and `message`. Any call can use `.throwOnError()` on the bucket API.

Use ASCII-safe object names (`<uuid>/<random>.mp3`). storage-js does not percent-encode the path for the sign/upload POSTs; `#`, `?` or `%` in names break URLs.

### 5.7 Deleting users that own objects

The docs say: "You cannot delete a user if they are the owner of any objects in Supabase Storage". Storage migration 0017 dropped `objects_owner_fkey`, so this may no longer fail (UNVERIFIED). Either way:
- Remove a user's objects via the Storage API first, or upload through URLs signed by the admin user.
- Remember that `owner_id` then points at that admin; that is harmless as long as no policy uses `owner_id`.

---

## 6. Postgres / RLS rules (Supabase docs, [run] in PGlite)

### 6.1 Grants

Grants are separate from RLS:
- **Before 2026-05-30** projects auto-granted `select, insert, update, delete` on new `public` tables (and `execute` on functions) to `anon, authenticated, service_role`.
- **New projects since 2026-05-30** (gradual rollout) do not. On **2026-10-30** this applies to all projects.

Always write, per table:

```sql
alter table public.x enable row level security;           -- SQL-created tables do NOT get RLS automatically
revoke all on table public.x from anon, authenticated;    -- safe on both old and new projects
grant select on table public.x to authenticated;          -- only what the app needs
grant select, insert, update, delete on table public.x to service_role;   -- service_role needs grants too (bypasses RLS, not grants)
```

- Missing grant → `42501 permission denied for table x`, with a PostgREST hint naming the GRANT. A policy that matches nothing → an empty result with no error.
- Optional: opt a project into the new behaviour now:

```sql
alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
```

- Prefer `uuid default gen_random_uuid()` or `generated always as identity` keys. **Identity columns need no sequence grant, but `bigserial` does** (`permission denied for sequence`) [run].
- Column-level privileges: `grant update (full_name) on public.profiles to authenticated;` (no table-level UPDATE). Updating another column → `42501` [run].
  - `select *` still works for a role that has table-level SELECT.
  - If you revoke a column's **select**, the role can no longer use `select *` [doc].

### 6.2 Policies

- One policy per operation, always with `to authenticated` (or `anon`). Never rely on `auth.uid()` being null to exclude anon.
- Wrap row-independent function calls as `(select auth.uid())`, `(select auth.jwt())`, `(select private.is_platform_admin())`. That turns them into an InitPlan evaluated once per statement [doc][run: EXPLAIN shows `InitPlan 1`]. Do **not** wrap functions that take row columns (e.g. `private.track_object_accessible(name)`).
- UPDATE needs a matching SELECT policy. Use both `using` (old row) and `with check` (new row).
- Index every column policies filter on. Only the leading column of a btree index counts.
- Break cross-table policy recursion (`42P17`) with a security-definer helper.
- Views: `create view v with (security_invoker = true) as …`. Views otherwise bypass RLS.
- Also filter in queries (`.eq('business_id', id)`). Use RLS for security, not for filtering.

### 6.3 Security-definer helpers ([run] exactly this shape)

```sql
create schema if not exists private;          -- NOT in "Exposed schemas" (Data API) → not callable via RPC

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''                          -- mandatory; schema-qualify everything inside
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'platform_admin');
$$;
revoke execute on function private.is_platform_admin() from public, anon;   -- Postgres grants EXECUTE to PUBLIC by default
grant usage on schema private to authenticated;                            -- without it: 42501 permission denied for schema private
grant execute on function private.is_platform_admin() to authenticated;
```

- These functions skip RLS because the owner is `postgres` (bypassrls).
- A security-definer function in an **exposed** schema (`public`) is callable over the Data API with the owner's privileges. Grant `execute` only to `service_role` (e.g. `public.consume_rate_limit`) and revoke it from `public, anon, authenticated`.

### 6.4 `auth.users` → `profiles` trigger ([run])

```sql
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);   -- never take role from raw_user_meta_data
  return new;
end;
$$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
```

- `profiles.id uuid primary key references auth.users (id) on delete cascade`. Only reference the PK of Supabase-managed tables.
- A failing trigger **blocks invites and sign-ups**, so keep it trivial. `auth.admin.deleteUser` cascades to `profiles`.
- Deleting a user doesn't revoke already-issued access tokens until `exp`.
- Role changes: prefer column grants plus a `before update` guard trigger, as in ARCHITECTURE.
- `raw_app_meta_data` (`auth.jwt()->'app_metadata'`) is safe for authorization. `raw_user_meta_data` is not.

---

## 7. Migrations without the CLI

- File naming used by the CLI [srv cli `pkg/migration/file.go`, `internal/utils/render.go`]:
  - Regex: `^([0-9]+)_(.*)\.sql$`
  - `supabase migration new` uses the UTC timestamp layout `20060102150405` → `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, e.g. `20260925120000_init.sql`.
  - Files are applied in version order.
- **Applying without the CLI:** Dashboard → SQL Editor → paste each file **in order** → Run.
  - It runs as `postgres`. `create policy on storage.objects`, `insert into storage.buckets` and triggers on `auth.users` all work there (the documented approach).
  - Make files idempotent where cheap (`create … if not exists`, `create or replace function`, `drop policy if exists …` before `create policy`, `on conflict do update` for buckets).
  - Wrap each file in `begin; … commit;` (UNVERIFIED whether the editor already wraps; explicit is harmless for these statements).
- `supabase/config.toml` is **not needed** for SQL-editor application. It is created by `supabase init` and used only by the CLI (local stack, `link`, `db push`, email templates for local dev).
- If the CLI is adopted later:
  - `db push` consults `supabase_migrations.schema_migrations(version text pk, name text, statements text[])`.
  - Mark manually applied files with `supabase migration repair --status applied <YYYYMMDDHHMMSS>`. Otherwise they re-run.
  - Once on migrations, don't change the remote schema by hand.

---

## 8. Hand-written `Database` type (supabase-js 2.117.1)

Shape emitted by the current generator (`@supabase/postgrest-typegen` 0.2.3, used by `supabase gen types`) [srv]. Compiled with `createClient<Database>`, `createServerClient<Database>`, `createBrowserClient<Database>`, `SupabaseClient<Database>`, embedded select, insert type errors and `rpc` [run tsc 5.9.3]:

```ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Optional. Lets createClient infer PostgREST features (maxAffected, spread-on-many). Omitted → treated as '12'.
  __InternalSupabase: { PostgrestVersion: '13' };           // UNVERIFIED which exact version hosted runs (13/14 behave the same for typing)
  public: {
    Tables: {
      // ILLUSTRATIVE columns only. Mirror the real migrations exactly.
      genres: {
        Row: { id: string; name: string; is_enabled: boolean; sort_order: number; created_at: string };
        Insert: { id?: string; name: string; is_enabled?: boolean; sort_order?: number; created_at?: string };
        Update: { id?: string; name?: string; is_enabled?: boolean; sort_order?: number; created_at?: string };
        Relationships: [];
      };
      track_genres: {
        Row: { track_id: string; genre_id: string };
        Insert: { track_id: string; genre_id: string };
        Update: { track_id?: string; genre_id?: string };
        Relationships: [
          { foreignKeyName: 'track_genres_genre_id_fkey'; columns: ['genre_id']; isOneToOne: false; referencedRelation: 'genres'; referencedColumns: ['id'] },
          { foreignKeyName: 'track_genres_track_id_fkey'; columns: ['track_id']; isOneToOne: false; referencedRelation: 'tracks'; referencedColumns: ['id'] },
        ];
      };
      // ...
    };
    Views: { [_ in never]: never };
    Functions: {
      consume_rate_limit: { Args: { p_key: string; p_max: number; p_window_seconds: number }; Returns: boolean };
      // no-arg function: { Args: Record<PropertyKey, never>; Returns: boolean }   (current generator; older output used `never`)
    };
    Enums: { app_role: 'platform_admin' | 'business_user' };
    CompositeTypes: { [_ in never]: never };
  };
};
// Generator also emits helpers: Tables<'genres'>, TablesInsert<…>, TablesUpdate<…>, Enums<'app_role'>, CompositeTypes<…>,
// built on `type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>`, and `export const Constants = { public: { Enums: { app_role: ['platform_admin','business_user'] } } } as const`.
```

Gotchas [run]:
- **Row/Insert/Update must be type literals or `type` aliases, not `interface`s.** Interfaces lack an index signature and don't satisfy `Record<string, unknown>`, so every select result becomes `never`. The top-level `Database` may be an interface.
- Each table needs `Relationships` (an empty tuple `[]` if there are none). Embedded selects (`tracks(title)`) only type-check when the FK is listed there. `foreignKeyName` must be the real constraint name (default `<table>_<column>_fkey`).
- Type mapping:
  - `uuid/text/timestamptz/date/interval` → `string`
  - `int2/int4/int8/float/numeric` → `number` (int8 loses precision past 2^53)
  - `bool` → `boolean`, `json(b)` → `Json` (NOT NULL json → `NonNullable<Json>`)
  - arrays → `T[]`, enums → `Database['public']['Enums']['x']`, `void` → `undefined`
- `Insert`: columns with a default or that are nullable are optional (`?`). `generated always` identity or generated columns are `?: never`. `Update`: everything optional.
- Only schemas exposed to the Data API belong in the type (`public`). `private` helpers are not callable via RPC, so leave them out.
- `import type { SupabaseClient } from '@supabase/supabase-js'; type TypedClient = SupabaseClient<Database>` is accepted for server, browser and admin clients alike [run].

---

## 9. Quick reference: flows in this app

| Flow | Client | Calls |
| --- | --- | --- |
| Login | server client in Server Action | `signInWithPassword` → cookies set → `redirect()` |
| Invite venue user | admin client in Server Action (after `requireAdmin`) | `inviteUserByEmail(email, { redirectTo: SITE_URL, data })`; handle `email_exists`, `over_email_send_rate_limit`; fallback `generateLink` |
| Accept invite / reset | `/auth/confirm` → `verifyOtp({type, token_hash})` → `/set-password` | `updateUser({ password })` (server action) |
| Forgot password | server client in Server Action | `resetPasswordForEmail(email, { redirectTo: SITE_URL })`; always show "check your email" |
| Sign playback URL | user server client (RLS SELECT policy) | `createSignedUrl(path, ttl)` / `createSignedUrls(paths, ttl)` |
| Admin upload | admin **user** client signs (RLS INSERT via admin policy) → browser XHR → complete endpoint | `createSignedUploadUrl(path)` → `uploadWithProgress` → admin(secret) `download(path)` to validate → `remove([path])` on failure |
| Cleanup | admin (secret) client | `storage.from(b).remove([...])`, never SQL `delete from storage.objects` |
| Sign out (venue device) | server client | `signOut({ scope: 'local' })` |
