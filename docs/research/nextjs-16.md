# Next.js 16.3.6 conventions for Venue Radio

These notes are based on the bundled docs in `node_modules/next/dist/docs/` (the authoritative source for this version) and on the installed package sources. The checks were run on 2026-09-25 in a scratch copy of this project, with the same `node_modules` and the same scaffold. That copy had a `src/proxy.ts`, route groups, a Route Handler, a Server Action with `useActionState`, and `unauthorized()`/`forbidden()`. In it, `next typegen`, `tsc --noEmit`, `eslint` and `next build` (Turbopack) all passed, and `next start` was probed with curl.
Labels used below:
- **VERIFIED**: I ran it and saw the result.
- **DOC**: stated in the bundled docs, not tested at runtime.
- **UNVERIFIED**: my inference.

Installed versions: next 16.3.6, react/react-dom 19.2.8, @types/react 19.3.0, typescript 5.9.3, eslint 9.39.5, eslint-config-next 16.3.6 (it bundles eslint-plugin-react-hooks 7.1.1), tailwindcss and @tailwindcss/postcss 4.3.3, @supabase/ssr 0.12.7.

---

## 0. TL;DR rules

1. **Put `src/proxy.ts` next to `src/app`, not `middleware.ts`.** Export `proxy` (named or default) and `config.matcher`. Proxy always runs on Node.js; `runtime` config is forbidden there.
2. **Always `await` these:** `cookies()`, `headers()`, `draftMode()`, `params` and `searchParams`. Synchronous access was **removed** in 16. Type props with the global helpers `PageProps<'/route'>`, `LayoutProps<'/route'>` and `RouteContext<'/route'>`. The build does **not** catch hand-written sync `params` types (VERIFIED; see §2).
3. **Leave `cacheComponents` OFF** (the default is `false`). No `'use cache'`.
   - Any page or route that reads user data goes through the cookie-bound Supabase client, which calls `cookies()`, so it renders dynamically.
   - Code that never touches cookies or headers must call `await connection()`. Examples: service-role or secret-key queries, and `new Date()`.
   - Alternatively, put `export const dynamic = 'force-dynamic'` on the group layout.
   - Without one of these, the page is **prerendered at build time and served to everyone** (VERIFIED).
4. **Never send MP3 bytes through Next.js.**
   - Server Actions accept 1 MB by default.
   - Any request that the proxy matches has its body **silently truncated to 10 MB** before it reaches the handler (VERIFIED).
   - Upload directly to Supabase Storage with signed upload URLs, as ARCHITECTURE.md §8 already specifies.
5. **Treat every Server Action and Route Handler as a public endpoint.** Authenticate and authorize inside each one. Proxy only gives optimistic redirects and refreshes the session.
6. **Mount the PlayerProvider in `src/app/(venue)/layout.tsx`, never in `template.tsx`.** It survives navigation between `/radio` and `/account`, but only while both stay under that layout and navigation stays client-side (`<Link>` or `router.*`).
7. **`next build` type-checks but does NOT lint.** `next lint` has been removed.
   - Lint: `npm run lint` (bare `eslint`, flat config).
   - Type-check: `npx next typegen && npx tsc --noEmit`. Without `next typegen`, tsc fails because `PageProps`, `LayoutProps` and `RouteContext` do not exist yet.
8. **Expect React Compiler lint rules to fail player code.** These are errors in `eslint-config-next` 16:
   - `react-hooks/set-state-in-effect`
   - `react-hooks/refs` (reading `ref.current` during render)
   - `react-hooks/purity` (`Date.now()` or `Math.random()` during render)

---

## 1. Proxy (formerly Middleware)

**Location and export (DOC, VERIFIED by build).** Create `src/proxy.ts` in the `src/` folder, at the same level as `app/`. The build output lists it as `ƒ Proxy (Middleware)`.
- Export one function, either `export function proxy(request: NextRequest, event?: NextFetchEvent)` or `export default function proxy(...)`. It may be `async`.
- The optional type `import type { NextProxy } from 'next/server'` infers both parameters.
- Only one proxy file is allowed per project; split logic into imported modules.
- The file convention and the export name `middleware` are deprecated. The codemod is `npx @next/codemod@canary middleware-to-proxy .`.
- Config flags were renamed too: `skipMiddlewareUrlNormalize` is now `skipProxyUrlNormalize`, and `experimental.middlewareClientMaxBodySize` is now `experimental.proxyClientMaxBodySize`.

**Runtime (DOC).** Proxy always runs on Node.js and this cannot be changed. Setting `export const config = { runtime }` throws. Edge is not supported in proxy.

**Matcher (DOC).**
- `config.matcher` must be a static constant: a string, an array, or `{ source, has, missing, locale }` objects.
- Sources use path-to-regexp syntax, must start with `/`, and are anchored at the start.
- Without a matcher, proxy runs on **every** request, including `_next/static`, `_next/image` and `public/`.
- Server Actions are POSTs to the page route, so proxy runs for them too. A matcher that excludes a path also skips actions on that path.
- Proxy always runs for `/_next/data` even if you exclude it.
- A negative lookahead is a **prefix** match. For example, `api/upload` in the lookahead also excludes `/api/upload-probe` (VERIFIED).

**Not in proxy:** `fetch` cache options have no effect, `revalidatePath` is not allowed, and there should be no DB-heavy work. Proxy runs on prefetches too.

**Body buffering gotcha (VERIFIED at runtime).**
- When proxy matches a request that has a body, Next clones the body, buffering up to `experimental.proxyClientMaxBodySize` (default **10 MB**).
- A 12 MB POST to a matched Route Handler arrived with **exactly 10,485,760 bytes**. The client got no error, and the server only logged `Request body exceeded 10MB for /api/...`.
- The same POST to a path excluded from the matcher arrived with all 12,582,912 bytes.
- Fix: keep large bodies out of Next entirely (use signed upload URLs), or exclude those paths from the matcher.

**Supabase session refresh in proxy (VERIFIED: compiles, type-checks, and redirects unauthenticated requests. Not run against a real Supabase project).** The pattern follows the official `vercel/next.js` example `examples/with-supabase`. It adds the second `headers` argument that `@supabase/ssr` 0.12.7 passes to `setAll`. That argument carries `Cache-Control: private, no-cache, no-store…`, `Expires` and `Pragma`, and it must be copied onto the response so CDNs never cache a Set-Cookie.

```ts
// src/lib/supabase/proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // 1) make refreshed cookies visible to Server Components of THIS request
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          // 2) send them to the browser
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // 3) no-store headers supplied by @supabase/ssr (0.12.x signature)
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  // Do NOT run code between createServerClient and getClaims() (random logouts otherwise).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const { pathname } = request.nextUrl;
  if (!claims && pathname.startsWith("/api/")) {
    return response; // Route Handlers answer 401 JSON themselves — never redirect APIs
  }
  const isProtected = ["/radio", "/account", "/admin"].some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (!claims && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c)); // keep cleared/refreshed cookies
    return redirect;
  }
  return response; // return THIS object (or copy its cookies) — never a fresh NextResponse.next()
}
```

```ts
// src/proxy.ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // everything except static assets/images/audio files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3)$).*)",
  ],
};
```

- **Setup-mode redirect** (ARCHITECTURE.md): when the Supabase env vars are missing, redirect to `/setup`. Do not redirect `/setup` itself or the matcher-excluded assets, or you create a loop.
- **Unauthenticated `/api/*`**: proxy must return `response` rather than a redirect. Otherwise the JSON clients receive a 307 to `/login` (VERIFIED: that is exactly what happened before the API branch was added).
- **Cookie-bound server client** (`src/lib/supabase/server.ts`): make it `async`, `await cookies()`, and use `getAll`/`setAll`. Wrap `setAll` in try/catch because Server Components cannot set cookies. That is fine because proxy refreshes the session. Create a new client per request and never store it in a module-level variable.
- **Session check**: use `supabase.auth.getClaims()` for authorization decisions (it exists in the installed supabase-js; VERIFIED by tsc). Never trust `getSession()` on the server.

---

## 2. Async request APIs (breaking in 15, sync access removed in 16)

| API | Where | Shape |
| --- | --- | --- |
| `cookies()` from `next/headers` | Server Components, Server Actions, Route Handlers | `Promise<ReadonlyRequestCookies>`. `.get/.getAll/.has` everywhere. `.set/.delete` **only** in Server Actions and Route Handlers (HTTP cannot set cookies after streaming starts). |
| `headers()` from `next/headers` | same | `Promise<ReadonlyHeaders>`, read-only |
| `params` | `page`, `layout`, `route`, `default`, OG/icon image functions | `Promise<{...}>` |
| `searchParams` | `page` only (layouts never get it) | `Promise<{ [k: string]: string \| string[] \| undefined }>`, a plain object rather than `URLSearchParams` |

Recommended typing. These helpers are global and need no import. They are generated by `next dev`, `next build` and `next typegen`; VERIFIED with tsc.

```tsx
export default async function Page(props: PageProps<"/admin/businesses/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
}
export default function Layout({ children }: LayoutProps<"/">) { /* ... */ }
export async function GET(req: NextRequest, ctx: RouteContext<"/api/player/genres/[genreId]/tracks">) {
  const { genreId } = await ctx.params;
}
```

- In Client Components, unwrap a passed Promise with `use(promise)`, or use `useParams()` or `useSearchParams()`.
- **Gotcha (VERIFIED).** A page typed by hand as `{ params: { x: string } }` passes `next build`, because the generated validator uses `{ params: Promise<…> } & any`. At runtime `params.x` is `undefined`: the page rendered `<p></p>` with no error. Always use the helpers above.
- `cookies().get(...)` without `await` **is** a tsc error (VERIFIED).

---

## 3. Route Handlers (`route.ts`)

- **Methods:** `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. `OPTIONS` is automatic if you omit it; an unsupported method returns 405.
- **Signature (DOC and VERIFIED):**
  ```ts
  export async function POST(request: NextRequest /* or Request */, ctx: { params: Promise<{ id: string }> }) {}
  // or ctx: RouteContext<'/api/admin/announcements/[id]/generate'>
  ```
- **Placement:** a `route.ts` cannot coexist with `page.tsx` in the same segment. Route Handlers do not take part in layouts.
- **Responses:** use `Response.json(data, { status, headers })` and `new Response(body|ReadableStream, init)`. `NextResponse` from `next/server` adds `.json`, `.redirect`, `.rewrite`, `.next` and `.cookies`.
- `redirect()`, `notFound()` and `unauthorized()` from `next/navigation` also work in handlers. Call `redirect` **outside** `try/catch` because it throws.
- **Request helpers:** `request.nextUrl.searchParams`, `request.cookies`, `await request.json()`, `await request.formData()` and `await request.text()`. No bodyParser config exists.
- **Caching:** handlers are **not cached by default** for any method; this has been the case since 15 (DOC).
  - A GET with no request APIs still showed as `ƒ` (dynamic) in `next build` (VERIFIED).
  - To opt a GET into caching, use `export const dynamic = 'force-static'`. Other methods are never cached.
- **Cache-Control:** a Route Handler response carries **no `Cache-Control` header by default** (VERIFIED). ARCHITECTURE.md requires `Cache-Control: no-store` on every API response, so set it explicitly in `jsonOk`/`jsonError`, for example `{ "Cache-Control": "private, no-store" }`.
- **Body size limits:** Route Handlers have no framework limit; 12 MB arrived intact when proxy was not in the path (VERIFIED). The only limit is the proxy clone limit from §1. `request.formData()` buffers the entire body in memory.
- **Segment config still valid in handlers** (without Cache Components): `dynamic`, `revalidate`, `fetchCache`, `maxDuration`, and `runtime = 'nodejs'` (the default). `runtime = 'edge'` is **deprecated** in 16.x docs. Use `maxDuration` (seconds) for the ElevenLabs TTS route if the host enforces timeouts.

---

## 4. Server Actions

**Definition (DOC, VERIFIED).**
- A file with `'use server'` at the top may export **only async functions**.
- `export const X = …` fails the build: `Only async functions are allowed to be exported in a "use server" file` (VERIFIED).
- `export type …` is fine.
- Keep zod schemas and constants in `src/lib/validation/*`, not in `actions.ts`.

**Invocation.**
- Use `<form action={fn}>`, `<button formAction={fn}>`, or `startTransition(() => fn(arg))`. Only POST is used.
- Pass extra arguments with `fn.bind(null, id)`.
- The client dispatches actions **one at a time**, so do not `Promise.all` them.

**Config key (DOC, VERIFIED accepted by build).** The limit lives under **`experimental.serverActions.bodySizeLimit`**. The default is **1 MB** and it counts multipart overhead. `allowedOrigins` sits in the same object, for the CSRF Origin/Host check behind reverse proxies.

**Security.**
- Action IDs are encrypted, but the endpoint is public.
- Authenticate, authorize and validate inside every action.
- Return DTOs, not raw rows.
- For multi-instance self-hosting, set a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
- In production, error messages thrown from server code reach the client as a generic message plus a `digest`. Return expected errors as values instead of throwing them.

**`useActionState` (React 19.2; signature VERIFIED in @types/react 19.3.0).**
```ts
useActionState<State, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>, permalink?: string,
): [state, dispatch: (payload: Payload) => void, isPending: boolean]
```
```ts
// actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export type SaveState = { ok: boolean; message: string; fieldErrors?: Record<string, string[]> };
export async function saveX(prev: SaveState, formData: FormData): Promise<SaveState> {
  const ctx = await requireAdminAction();                 // auth inside the action
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid input", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  // ...mutate...
  revalidatePath("/admin/genres");                          // BEFORE redirect
  if (formData.get("then") === "back") redirect("/admin/genres"); // throws; not inside try/catch
  return { ok: true, message: "Saved" };
}
// form.tsx
"use client";
const [state, formAction, pending] = useActionState(saveX, { ok: false, message: "" });
return <form action={formAction}>…<button disabled={pending}>Save</button></form>;
```
- **Zod 4:** the bundled Next docs still use zod 3 APIs (`invalid_type_error`, `error.flatten()`). With zod 4.6.5, use `z.flattenError(err)` (VERIFIED: compiles) and `{ error: "…" }` params.
- **React resets uncontrolled form fields after every form action**, even one that returns validation errors. VERIFIED in react-dom: `startHostTransition` calls `requestFormReset`. To keep the user's input:
  - echo the values back in `state` and render `defaultValue={state.values?.x}` with a `key` that changes, or
  - use controlled inputs, or
  - call the action from `onSubmit` with `e.preventDefault()` and `startTransition`.
- `useFormStatus()` from `react-dom` gives `pending` inside a child of the `<form>`.

**`redirect(path, type?)` from `next/navigation`.**
- Its return type is `never`. In actions it defaults to `push`.
- With JavaScript enabled it performs a client-side navigation, so the layout and player persist. Without JS it sends a 303.
- **Call it after** `revalidatePath` and outside `try/catch`.
- If you must catch, rethrow with `unstable_rethrow(e)`.

**Revalidation (signatures VERIFIED in `next/cache` types).**
| Function | Signature | Behaviour |
| --- | --- | --- |
| `revalidatePath` | `(path: string, type?: 'page' \| 'layout')` | `type` is required for patterns like `/admin/businesses/[id]`. In an action, the current route re-renders in the same round trip. |
| `refresh` | `()` | Re-renders the current route. **Server Actions only**; it throws in Route Handlers. |
| `revalidateTag` | `(tag: string, profile: string \| CacheLifeConfig)` | The 2nd argument is **required** in 16. |
| `updateTag` | `(tag: string)` | Actions only; read-your-writes. |

In our no-cache app, `revalidatePath` or `refresh()` exists mainly to make the page re-render in the same response. Without it, or a cookie write, or `redirect`, the action returns only its value and the page is **not** re-rendered.

**Proxy interaction.** Actions POST to the page URL, so proxy runs for them. Sending an action body larger than 10 MB would also hit the silent proxy truncation.

---

## 5. Caching and rendering model in 16: what this app does

`cacheComponents` defaults to **false** (VERIFIED in `config-shared.js`). It is the opt-in for PPR, `'use cache'`, `cacheLife`/`cacheTag` and Activity-based navigation. **Recommendation: keep it off.** The reasons:
- Every screen is per-user and auth-gated.
- With it on, every `cookies()` access needs `<Suspense>` boundaries or the build errors.
- `dynamic`, `revalidate` and `fetchCache` segment configs are **removed** under Cache Components.
- Hidden pages are kept mounted via `<Activity>`. The docs warn that `display:none` does **not** stop `<audio>`/`<video>` playback.

Behaviour with it off (the "Previous Model" guide):
- `fetch` is not cached by default. However, a `fetch` or other work reached **before** any request API during build **is** prerendered.
- A page that uses **no** request API is **static and frozen at build time**. VERIFIED: `/static-check` returned the identical build timestamp on every request, with `Cache-Control: s-maxage=31536000` and `x-nextjs-cache: HIT`.
- Pages that call `cookies()` (the Supabase server client does), `headers()`, `searchParams` or `connection()` render dynamically, with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (VERIFIED).

What to do:
- Put all user data behind `createSupabaseServerClient()` or `getSessionContext()`. Both read cookies, which makes the route dynamic.
- Any server-only helper using the **admin/secret client** without reading cookies must start with `await connection()` (`import { connection } from 'next/server'`).
- Belt and braces: add `export const dynamic = 'force-dynamic'` to `src/app/(venue)/layout.tsx` and the admin layout. VERIFIED: setting it on a group layout turned a child page that would otherwise be static into `ƒ`. The docs prefer `connection()`, but `force-dynamic` is still valid in 16 without Cache Components.
- Check the `next build` route table: every authenticated route must show `ƒ`. Only `/login`, `/setup`, `/_not-found` and similar may be `○`.
- Use React `cache()` for per-request dedupe of `getSessionContext()`. This is fine and is not a cross-request cache.
- Never use `unstable_cache` or `'use cache'` for user data.
- The client router cache `staleTimes.dynamic` default is 0 s (since 15). Back/forward navigation still restores from the router cache.

---

## 6. Route groups, layouts, and a persistent audio player

- **Route groups** `(name)` do not appear in the URL.
  - Two groups must not resolve to the same path.
  - Navigating between **different root layouts** triggers a **full page load**, which kills audio. Keep a single root `src/app/layout.tsx`.
- **Layouts preserve state and do not re-render on navigation** (DOC).
  - `PlayerProvider` (a `'use client'` component) in `src/app/(venue)/layout.tsx` stays mounted across `/radio` and `/account`.
  - `router.refresh()`, `revalidatePath` and the server re-render after an action keep client state (DOC: "The UI is not unmounted").
  - Navigating to a route **outside** `(venue)`, such as `/admin` or `/login`, unmounts that layout and the player. That is expected.
- **Hard navigations lose the player:**
  - plain `<a href>`, `window.location`
  - no-JS form posts, including the `/auth/signout` POST form, which is fine because the player is stopped first
  - `global-error.tsx`, which replaces the root layout
  - UNVERIFIED: whether a proxy 307 during a client navigation is followed softly. Assume session expiry may reload the page.
- **`template.tsx` remounts** its children when its segment changes. Never put the player or provider in a template.
- **`error.tsx`** (must be `'use client'`) sits **below** the layout of the same segment. A page error does not unmount the `(venue)` layout. New in 16.3: error components receive `retry()`, which re-fetches and re-renders; `reset()` still exists.
- Layouts get no `searchParams` or pathname. Use `usePathname()` or `useSearchParams()` in a client child.
- Do not do auth only in layouts: they don't re-run on navigation, and a layout does not stop child segments or actions from running. Check auth in pages, data helpers, actions and handlers.
- Pattern: the Server Component layout fetches the session and venue bootstrap, then passes props, or a Promise to be read with `use()`, into the client provider.
- **React pitfalls for the engine provider:**
  - `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` needs `getServerSnapshot` because client components are SSR'd.
  - Don't construct anything touching `Audio`/`window` during render on the server. Create it lazily in an effect or on the first user gesture.
  - Strict Mode is **on by default** in the App Router, so effects mount, unmount and mount again in dev. `destroy()` must be idempotent and the engine must be re-creatable.
  - React 19.2 `useEffectEvent` is stable in the types, which helps with non-reactive handlers inside effects.

---

## 7. `next.config.ts` and environment variables

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  typedRoutes: true,                         // stable, top-level (experimental.typedRoutes is deprecated)
  experimental: {
    serverActions: { bodySizeLimit: "1mb" }, // default 1mb; raise only if an action truly needs it
    // proxyClientMaxBodySize: "10mb",       // default; only matters for proxied request bodies
    // authInterrupts: true,                 // only if we use unauthorized()/forbidden()
  },
  // allowedDevOrigins: ["192.168.*.*"],     // needed to open `next dev` from a phone/tablet via LAN IP (hostname only, no port)
};
export default nextConfig;
```

**typedRoutes (VERIFIED):**
- `<Link href="/does-not-exist">` is a tsc error. `redirect()` and `router.push` are typed too.
- Cast non-literal strings with `as Route` (`import type { Route } from 'next'`).
- It needs generated types, so run `next typegen` before `tsc`.

**Images:** we play audio through `<audio src={signedUrl}>`, which needs no Next config.
- Avoid `next/image` for Supabase **signed** URLs. The optimizer caches for at least `minimumCacheTTL` (4 h default in 16) and the token sits in the query string.
- If you must use it, pass `unoptimized`, or add `images.remotePatterns: [{ protocol: 'https', hostname: '<ref>.supabase.co', pathname: '/storage/v1/object/**' }]`. Omitting `search` allows any query.
- 16 changes: `images.domains` is deprecated, `priority` is deprecated in favour of `preload`, `qualities` defaults to `[75]`, and fetching from local IPs is blocked unless `dangerouslyAllowLocalIP`. A local Supabase at 127.0.0.1 would need it only with next/image.
- `<img>` is only a lint *warning* (`@next/next/no-img-element`).

**Env vars (DOC):**
- `.env*` files live in the **project root**, not `src/`.
- Only `NEXT_PUBLIC_*` values reach the browser, and they are **inlined at build time**, so they are frozen per build. Dynamic lookups (`process.env[name]`) are not inlined.
- Non-public variables are replaced with an empty string in client bundles.
- Load order: `process.env` → `.env.$(NODE_ENV).local` → `.env.local` (skipped when NODE_ENV=test) → `.env.$(NODE_ENV)` → `.env`.
- `serverRuntimeConfig`/`publicRuntimeConfig` are **removed**.
- For scripts and vitest, `@next/env` (installed, 16.3.6) provides `loadEnvConfig(process.cwd())`.
- To read server env at request time rather than prerender time, the route must be dynamic (for example via `await connection()`).

**`server-only`:**
- Add `import 'server-only'` at the top of `admin.ts`, `lib/data/*`, `tts/*` and `uploads/token.ts`.
- Next aliases it to an empty module for the RSC, Server Action, **proxy** and instrumentation layers, and errors at build time if it is pulled into client code (VERIFIED in the webpack config; Turbopack assumed to match, and the build with it in `server.ts` passed).
- **Outside Next** (vitest or tsx scripts) the npm package's default export **throws** unless the `react-server` export condition is set. In vitest, alias `server-only` to an empty module, or set `resolve.conditions: ['react-server', ...]`. Otherwise keep pure logic in files that don't import it. UNVERIFIED: the exact vitest config was not run here.

---

## 8. Build, lint, type-check

- `next build` uses Turbopack by default and **runs TypeScript** ("Running TypeScript … Finished", VERIFIED). It fails on type errors unless `typescript.ignoreBuildErrors`. It **does not lint**: `next lint` and the `eslint` key in next.config are removed.
- Lint with `npm run lint`, which runs `eslint`. ESLint 9 with no arguments lints the current directory using `eslint.config.mjs` (flat config: `eslint-config-next/core-web-vitals` + `/typescript`). VERIFIED: exits 0 on clean code.
- Type-check with `npx next typegen && npx tsc --noEmit` (VERIFIED). Typegen writes `.next/types` and `next-env.d.ts`. Suggested script: `"typecheck": "next typegen && tsc --noEmit"`.
- `next dev` writes to `.next/dev` and `next build` to `.next`, so both can run at once. A lockfile blocks two `next dev` instances.
- In 16, `next build` output no longer shows size or First Load JS.
- **React Compiler lint rules** (all errors in eslint-config-next 16.3.6): `set-state-in-effect`, `refs`, `purity`, `immutability`, `globals`, `use-memo`, `static-components`, `preserve-manual-memoization`, `set-state-in-render`, `error-boundaries`, `config`, `gating`. `exhaustive-deps` is a warning. VERIFIED on a typical player widget:
  - `useEffect(() => setMounted(true), [])` → `react-hooks/set-state-in-effect`
  - `{ref.current?.currentTime}` in JSX → `react-hooks/refs`
  - `Date.now()` in render → `react-hooks/purity`

  Fixes:
  - subscribe to the engine via `useSyncExternalStore`
  - set state from event callbacks (`onTimeUpdate`) or subscriptions
  - read refs only in handlers or effects
  - compute times in handlers or effects
- Turbopack refuses a `node_modules` symlink/junction that points outside the project root (`Symlink [project]/node_modules is invalid`). Setting `turbopack: { root: '<common ancestor>' }` works (VERIFIED). This only matters for worktrees or copies.

---

## 9. `unauthorized()` / `forbidden()`

- Both still exist and are **experimental**. They require `experimental: { authInterrupts: true }`; the build prints `✓ authInterrupts`, and a page using both compiled (VERIFIED).
- Import them from `next/navigation`. They throw (return type `never`) and render the nearest `unauthorized.tsx` (401) or `forbidden.tsx` (403) boundary.
- They work in Server Components, Server Actions and Route Handlers, but **not in the root layout**.
- A surrounding `try/catch` swallows them; use `unstable_rethrow`.
- Inside a `<Suspense>` boundary, the HTTP status is already 200.
- **Recommendation:** skip them.
  - For pages, use `redirect('/login')` or `notFound()` (stable), for example `requireAdminPage()`.
  - Route Handlers must return our JSON `{ error: { code, message } }` with 401/403, not an HTML boundary.
  - Actions return state.

---

## 10. Tailwind v4 (CSS-first, as scaffolded)

- The scaffold (VERIFIED) has `postcss.config.mjs` → `plugins: { "@tailwindcss/postcss": {} }` and `src/app/globals.css` → `@import "tailwindcss";`.
- There is **no `tailwind.config.js`**; sources are detected automatically. Add `@source "<path>"` for any extra folders.
- `@theme { --color-*: …; --radius-*: …; --shadow-*: …; --font-*: … }` creates utilities: `--color-surface` produces `bg-surface`, `text-surface`, `border-surface` and opacity forms like `bg-accent/80`. `--radius-card` produces `rounded-card`, and `--shadow-glow` produces `shadow-glow`. All VERIFIED by compiling with @tailwindcss/postcss 4.3.3.
- Use **`@theme inline`** when a token references another CSS variable, such as `--font-sans: var(--font-geist-sans)` from next/font. The utility then emits `font-family: var(--font-geist-sans)` directly (VERIFIED).
- **Dark-only UI:** the simplest approach is to define the dark palette as the default token values and set `color-scheme: dark` on `html`, with no `dark:` variants.
  - The scaffold's `@media (prefers-color-scheme: dark)` swap and its `body { font-family: Arial … }` should be replaced. The Arial rule overrides Geist; use `font-sans` on `<body>`.
  - For a class toggle, use `@custom-variant dark (&:where(.dark, .dark *));` (VERIFIED output: `.dark\:bg-black:where(.dark, .dark *)`).
  - Without it, `dark:` means `prefers-color-scheme`.
```css
@import "tailwindcss";
@theme {
  --color-bg: oklch(0.16 0.01 260);
  --color-surface: oklch(0.21 0.01 260);
  --color-border: oklch(0.30 0.01 260);
  --color-fg: oklch(0.96 0 0);
  --color-muted: oklch(0.70 0.01 260);
  --color-accent: #f59e0b;
  --radius-card: 1rem;
}
@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
html { color-scheme: dark; }
body { background: var(--color-bg); color: var(--color-fg); }
```
- `next/font/google` (Geist, in the scaffold) downloads fonts at **build time**, so the build needs network access (worked here).

---

## 11. Breaking changes and deprecations people get wrong (14/15 → 16)

- `middleware.ts` → `proxy.ts`. The Node runtime is fixed; edge is not allowed. Config flags were renamed from `middleware*` to `proxy*`.
- Sync `cookies()`, `headers()`, `draftMode()`, `params` and `searchParams` are **removed**. OG/icon image functions receive `params` and `id` as Promises; the sitemap receives `id` as a Promise.
- Build and linting:
  - `next lint` and `eslint` in the config are **removed**, and build doesn't lint.
  - Turbopack is the default for dev and build.
  - A custom `webpack` config makes `next build` **fail** unless you pass `--webpack`.
  - `experimental.turbopack` moved to top-level `turbopack`.
- Caching:
  - `revalidateTag(tag)` now **requires** a profile: `revalidateTag(tag, 'max')`.
  - New: `updateTag` and `refresh` (actions only), `connection()` (replaces `unstable_noStore`) and `io()` (16.3, for Cache Components).
  - `experimental.ppr`, `experimental.dynamicIO` and `experimental.useCache` are removed in favour of `cacheComponents`.
  - `unstable_cacheLife`/`unstable_cacheTag` → `cacheLife`/`cacheTag`.
- `export const dynamic = 'force-dynamic'` is **still valid** without Cache Components (VERIFIED). The docs now prefer `await connection()`. It is removed only when `cacheComponents: true`.
- `export const runtime = 'edge'` is deprecated; drop the `runtime` export.
- The 15-era defaults still apply, and are often assumed wrong from 14: `fetch` is not cached by default, GET Route Handlers are not cached, and client `staleTimes.dynamic` is 0.
- Removed or deprecated config and APIs:
  - `serverRuntimeConfig`/`publicRuntimeConfig`, AMP, `devIndicators.appIsrStatus` and similar are removed.
  - `unstable_rootParams` → `next/root-params`.
  - Parallel-route slots **require** `default.tsx`.
- `next/image`: `priority` → `preload`; `qualities` defaults to `[75]`; `minimumCacheTTL` defaults to 4 h; `imageSizes` no longer includes 16; `maximumRedirects` is 3; local-IP fetches are blocked; `images.domains` and `next/legacy/image` are deprecated.
- `next/link`: no child `<a>`. `legacyBehavior` is marked deprecated in the types. `onNavigate` (15.3) and `transitionTypes` (16.2) are available.
- **`useSearchParams()`:**
  - On a **statically prerendered** route, the client component using it must sit inside `<Suspense>`, otherwise the production build fails with "Missing Suspense boundary with useSearchParams". Dev doesn't catch this.
  - On dynamic routes (cookies, `connection()` or `force-dynamic`) it is available during SSR.
  - For server data, prefer the page `searchParams` prop.
- **`useFormState` → `useActionState`** (from `react`, returning `[state, action, isPending]`). React 19 auto-resets forms after actions (§4).
- **`next/dynamic` with `ssr: false`** is only allowed inside Client Components (unchanged since 15).
- `scroll-behavior: smooth` is no longer overridden during navigation; add `data-scroll-behavior="smooth"` on `<html>` to restore the old behaviour.
- `error.tsx` now gets `retry` (stable in 16.3). There is also a new `catchError()` in `next/error` for component-level boundaries.
- Minimums: Node ≥ 20.9 (we run 24) and TypeScript ≥ 5.1. Browsers: Chrome/Edge/Firefox 111+, Safari 16.4+.

---

### Scratch evidence

The prototype lives at `C:\Users\PC\AppData\Local\Temp\claude\C--Users-PC-Desktop-Music-Radio\fc7faaf9-06fe-4439-bceb-4ec648d11d28\scratchpad\nextjs16\app\`. It contains `src/proxy.ts`, `src/lib/supabase/{proxy,server}.ts`, `(venue)` layout, player provider, and settings action and form, plus `api/tracks/[id]`, `api/bodyprobe` and `static-check`.
