# ElevenLabs text-to-speech: research notes

Researched 2026-09-25 for `src/lib/tts/elevenlabs.ts` (see `docs/ARCHITECTURE.md`). Scope: generate an
announcement MP3 once on the server, store it in the `announcements` bucket, never call TTS at playback.

**Evidence tags used below**

- **[DOC]**: official docs fetched as Markdown on 2026-09-25 (`https://elevenlabs.io/docs/<page>.md`), or
  the live OpenAPI spec at `https://api.elevenlabs.io/openapi.json`. The spec at
  `elevenlabs.io/docs/openapi.json` returns 401.
- **[LIVE]**: probed the real API on 2026-09-25 with **no key or an invalid key**, so no credits were used.
- **[CODE]**: the client snippet in section 12 was typechecked (tsc 5.9.3 strict, project tsconfig options)
  and run under Node 24 against a local mock server and live invalid-key probes.
- **UNVERIFIED**: third-party reports or inference. Confirm these with a real key before relying on them.

Main sources:

- API reference: `api-reference/text-to-speech/convert`, `models/list`, `voices/search`,
  `legacy/voices/get-all`, `user/subscription/get`, `authentication`, and
  `pronunciation-dictionaries/create-from-rules`.
- Guides: `eleven-api/resources/errors`, `overview/models`, `overview/capabilities/text-to-speech`, the
  `text-to-speech/best-practices` page, the `request-stitching` guide and the `pronunciation-dictionaries` guide.
- Help centre: `help-center/technical/api-error-code-{400-or-401,429,422}`.
- Official SDK: `@elevenlabs/elevenlabs-js@2.69.0`. We read its source only and do not use it.

---

## 1. Decisions for Venue Radio (TL;DR)

1. **Use plain `fetch`, not the SDK.** The official SDK exists (v2.69.0, Fern-generated), but it adds a
   dependency and we only need three endpoints.
2. **Make one call per announcement:** `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`,
   non-streaming. The response is the whole MP3. Store it as `audio/mpeg`.
   `mp3_44100_128` is the default format and works on every plan [DOC]. At 128 kbps, a
   1,000-character announcement (about 1 minute) is about 1 MB, well under the 10 MB bucket limit.
3. **Default model: `eleven_multilingual_v2`.** It has the most stable quality, the best number
   normalisation and a 10k character limit. It covers en, bg, hr, el, ro, tr plus most EU tourist
   languages [DOC]. Use `eleven_v3` only for languages v2 lacks (sr, mk, bs, sl). Use `eleven_flash_v2_5`
   or v3 for hu. Do not offer `turbo` models (deprecated) or models with `requires_alpha_access`.
4. **Never send `language_code` with `eleven_multilingual_v2`.** The docs say it is not supported
   [DOC]. For other models, send it only if the code appears in that model's
   `languages[].language_id` from `GET /v1/models`. A third party reports a **400** for unsupported
   pairs (UNVERIFIED).
5. **Handle brand names with plain respelling on our server.** Substitute
   `businesses.name_pronunciation` into `spoken_text` before the call. This works on every model and
   keeps `generation_hash` deterministic. Phoneme tags only work on `eleven_flash_v2` (English) and v3
   IPA (section 9).
6. **Pre-normalise numbers, times and prices in `spoken_text`** as words in the target language. Flash
   models do not normalise numbers by default, and forcing normalisation `on` for v2.5 is
   Enterprise-only [DOC].
7. **Production needs a paid plan.** Commercial use requires one, and venues are commercial [DOC]. Free
   tier cannot use Voice Library voices via the API [DOC]. Free tier also gets "unusual activity"
   blocks on shared or VPN IPs [DOC].
8. **API key setup.** Use a **service-account key** (no expiry) scoped to `text_to_speech`,
   `voices_read`, `models_read`, plus `user_read` if we show quota [DOC: PermissionType enum]. Keep
   it server-only. The API sends `access-control-allow-origin: *` [LIVE], so a leaked key works from
   any browser.
9. **Timeouts:** 60 s for TTS and 15 s for listings, using `AbortSignal.timeout` so the deadline also
   covers reading the body.
10. **Retries:** retry only `rate_limited`, `provider_unavailable` and `timeout`, at most 2 times with
    exponential backoff. The official SDK does the same: 2 retries on 408/429/5xx and honours
    `Retry-After`. Never retry `auth`, `quota`, `validation` or `voice_not_found`.

---

## 2. Endpoints and auth

| Purpose | Request | Notes |
|---|---|---|
| TTS (whole file) | `POST /v1/text-to-speech/{voice_id}` | JSON in, binary audio out [DOC] |
| TTS (chunked) | `POST /v1/text-to-speech/{voice_id}/stream` | Same body. Not needed here |
| List models | `GET /v1/models` | Returns a JSON **array** [DOC] |
| List voices | `GET /v2/voices` | Paginated. `GET /v1/voices` is under "Legacy" and "stops working once the workspace exceeds 500 voices" [DOC] |
| One voice | `GET /v1/voices/{voice_id}` | Validate a stored voice id |
| Default voice settings | `GET /v1/voices/settings/default` | `{stability, similarity_boost, style, use_speaker_boost, speed}` |
| Quota | `GET /v1/user/subscription` | Needs the `user_read` scope |
| Pronunciation dictionary | `POST /v1/pronunciation-dictionaries/add-from-rules` | Optional (section 9) |

- **Base URL:** `https://api.elevenlabs.io` (global routing). The response header `x-region`
  showed `us-central1` and `europe-west4` [LIVE].
  - `https://api.us.elevenlabs.io` pins requests to the US.
  - `api.eu.residency…`, `api.in.residency…` and `api.sg.residency…` are data-residency hosts
    (Enterprise) [DOC].
- **Auth header:** `xi-api-key: <key>` [DOC]. `Content-Type: application/json` on POST.
  - With no key, TTS returns `401 needs_authorization`, but `GET /v1/models` returns
    **`404 workspace_not_found`** [LIVE]. Treat `workspace_not_found` as an auth problem.
  - `Authorization: Bearer <api key>` returns `401 invalid_authorization_header` [LIVE]. Only use
    `xi-api-key`.
- **Key restrictions** [DOC]: per-key endpoint scopes, a credit quota, an IP allowlist (other IPs get
  `403`) and optional expiry. Expiry applies to user keys (15 min to 30 days). Service-account keys
  never expire.

---

## 3. `POST /v1/text-to-speech/{voice_id}` [DOC unless noted]

### Query parameters

| Param | Values | Use |
|---|---|---|
| `output_format` | `alaw_8000`, `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_{32,64,96,128,192}`, `opus_48000_{32,64,96,128,192}`, `pcm_{8000,16000,22050,24000,32000,44100,48000}`, `ulaw_8000`, `wav_{8000,16000,22050,24000,32000,44100,48000}`. Default `mp3_44100_128` | `mp3_44100_192` needs **Creator+**. `pcm_44100` and `wav_44100` need **Pro+**. Send `mp3_44100_128` explicitly |
| `enable_logging` | bool, default `true` | `false` means zero-retention mode, **Enterprise only**. Omit |
| `optimize_streaming_latency` | int 0–4 | **Deprecated.** Omit |

### Body (`Body_text_to_speech_full`)

Only `text` is required.

| Field | Type / range | Notes |
|---|---|---|
| `text` | string, **required** | Max length depends on the model (section 5). Empty text fails after auth, not in the 422 schema check [LIVE] |
| `model_id` | string, default `eleven_multilingual_v2` | The model needs `can_do_text_to_speech` |
| `language_code` | ISO 639-1 string or null | "Used to enforce a language for the model and text normalization… **not supported for multilingual_v2 models**." Docs say an unsupported code is ignored. A third party saw **400** `Model '…' does not support language_code '…'` (UNVERIFIED) |
| `voice_settings` | object or null | Overrides the stored settings for this request only. See below |
| `pronunciation_dictionary_locators` | `[{pronunciation_dictionary_id, version_id?}]`, **max 3** | Applied in order. Latest version if `version_id` is omitted |
| `seed` | int 0..4294967295 | Best-effort determinism, not guaranteed |
| `previous_text` / `next_text` | string | Continuity context when stitching clips. Not needed for single announcements |
| `previous_request_ids` / `next_request_ids` | string[], max 3 | Takes precedence over `*_text` |
| `apply_text_normalization` | `"auto"`, `"on"`, `"off"`, default `auto` | 422 if invalid [LIVE] |
| `apply_language_text_normalization` | bool | Japanese only. Adds latency |
| `use_pvc_as_ivc` | bool | **Deprecated.** Omit |

### `voice_settings` (`VoiceSettingsResponseModel`)

| Field | Default | Range | Validation |
|---|---|---|---|
| `stability` | 0.5 | 0..1 | Schema `minimum 0 / maximum 1`. Returns 422 before auth [LIVE]. **eleven_v3**: the UI offers Creative, Natural and Robust. Third parties report the API accepts only `0.0`, `0.5` and `1.0` for v3 (UNVERIFIED), so snap to those values |
| `similarity_boost` | 0.75 | 0..1 | 422 outside the range [LIVE] |
| `style` | 0 | 0..1 by convention | Not schema-validated. Values above 0 add latency |
| `use_speaker_boost` | true | bool | Slightly more latency |
| `speed` | 1.0 | **0.7–1.2** (best-practices doc) | Not schema-validated. Extreme values hurt quality |

### Response

- **200:** the raw audio bytes. The OpenAPI response content type is `audio/mpeg`.
- **Response headers:**
  - `request-id`: the id to pass in `previous_request_ids` [DOC: request-stitching guide + SDK example].
  - `character-cost`: "cost of the generation in characters" [DOC: same guide]. The OpenAPI spec
    only declares this header for sound generation, so treat it as optional.
  - `current-concurrent-requests` and `maximum-concurrent-requests` [DOC: models page].
  - `x-region` and `x-trace-id` [LIVE, seen on errors].
  - `x-character-count` and `history-item-id` are older names (UNVERIFIED). The client reads
    `x-character-count` only as a fallback.
- Error responses carry **no `request-id` header**. Use `detail.request_id`, which equals the
  `x-trace-id` header [LIVE].

---

## 4. Errors

### Three body shapes (the client must accept all of them)

```jsonc
// A. Current format [DOC errors page + LIVE]. `status` is a legacy mirror and may DIFFER from `code`.
{"detail":{"type":"authentication_error","code":"unauthorized","message":"Invalid API key",
           "status":"invalid_api_key","request_id":"1c1689d894474556068cd3dcd145df7f"}}      // 401 [LIVE]
{"detail":{"type":"authentication_error","code":"unauthorized",
           "message":"Neither authorization header nor xi-api-key received, please provide one.",
           "status":"needs_authorization","request_id":"…"}}                                 // 401 [LIVE]
{"detail":{"type":"not_found","code":"workspace_not_found","message":"Workspace 1anonymous1 not found.",
           "status":"workspace_not_found","request_id":"…"}}                                 // 404, GET /v1/models without key [LIVE]
// B. Legacy format (help centre, still reported in 2025-26)
{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota of …"}}     // **401**, not 402!
{"detail":{"status":"max_character_limit_exceeded","message":"This request's text has 627 characters and exceeds …"}} // 400
// C. Pydantic/FastAPI 422. This runs BEFORE auth, so it also happens with an invalid key [LIVE]
{"detail":[{"type":"less_than_equal","loc":["body","voice_settings","stability"],
            "msg":"Input should be less than or equal to 1","input":2,"ctx":{"le":1.0}}]}
{"detail":[{"type":"missing","loc":["body","text"],"msg":"Field required","input":null}]}
```

These were seen as 422 before auth [LIVE]:

- missing `text`, or `text` that is not a string
- `stability` or `similarity_boost` outside 0..1
- a bad `apply_text_normalization` enum value
- a bad `enable_logging` boolean
- malformed JSON (`json_invalid`)

These were **not** checked before auth: a bad `output_format`, `speed`/`style` range, negative `seed`,
more than 3 dictionary locators, more than 3 request ids, and empty text.

### Status and code reference [DOC errors page unless noted]

| HTTP | `type` | Relevant `code` / legacy `status` values |
|---|---|---|
| 400 | `validation_error`, `invalid_request` | `text_too_long`, `empty_text`, `invalid_parameters`, `invalid_voice_settings`, `invalid_voice_id`, `unsupported_model`, `invalid_output_format`, `malformed_json`; legacy `max_character_limit_exceeded`, `voice_does_not_exist` (older voice-not-found, UNVERIFIED) |
| 401 | `authentication_error` | `invalid_api_key`, `missing_api_key`, `invalid_authorization_header`, `unauthorized`; legacy `needs_authorization`, **`quota_exceeded`**, `missing_permissions` (UNVERIFIED) |
| 402 | `payment_required` | `insufficient_credits`. Also "Free users cannot use library voices via the API…" (third party, 2026) |
| 403 | `authorization_error` | `forbidden` (e.g. IP allowlist), `insufficient_permissions`, `feature_not_available`, `subscription_required`, `voice_access_denied`, `model_access_denied` |
| 404 | `not_found` | `voice_not_found` ("A voice with voice_id '…' was not found.", third party 2026), `model_not_found`, `pronunciation_dictionary_not_found`, `workspace_not_found` [LIVE] |
| 422 | (array) | pydantic validation |
| 429 | `rate_limit_error` | `rate_limit_exceeded`, `concurrent_limit_exceeded`, `system_busy`; legacy `too_many_concurrent_requests`, `system_busy`. Advice: exponential backoff for rate limits; wait for in-flight requests for concurrency |
| 500 / 503 | `internal_error` / `service_unavailable` | `internal_error`, `service_unavailable`, `maintenance` |

### Classification used by the client (order matters)

1. The `voice_not_found`, `voice_does_not_exist` or `voice_access_denied` token → **voice_not_found**.
2. `model_not_found`, `unsupported_model` or `model_access_denied` → **validation**.
3. Any of the following → **quota**:
   - status 402
   - tokens `quota_exceeded`, `insufficient_credits`, `payment_required`, `subscription_required` or
     `feature_not_available`
   - a message matching `/quota|credits|upgrade your subscription|tier or above/`

   This check runs **before** the 401 check because quota errors arrive as 401.
4. 429, or a rate-limit/concurrency/`system_busy` token → **rate_limited**. `Retry-After` is honoured
   if present, but it is UNVERIFIED that ElevenLabs sends it.
5. 401 or 403, or an auth token (including `workspace_not_found` and `missing_permissions`) → **auth**.
6. 404 on a URL that contains a voice id → **voice_not_found**. A 404 anywhere else →
   **provider_unavailable**.
7. 408 or 5xx → **provider_unavailable**. Network failures and a 200 whose body is not audio or is
   empty → **provider_unavailable**.
8. Any other 4xx → **validation**.
9. Our `AbortSignal.timeout` fired (during connect, headers or body) → **timeout**. A caller's own
   abort signal re-throws its reason unchanged.

Match on `type`, `code` **and** `status` together. The live invalid-key response has `code: "unauthorized"`
but `status: "invalid_api_key"`.

---

## 5. Models [DOC: overview/models, 2026-09]

| model_id | State | Max chars per request | Languages | Notes |
|---|---|---|---|---|
| `eleven_v3` | Flagship, most expressive | **5,000** | 70+ (list in section 6) | No SSML `<break>` (use `[pause]`, `[short pause]`, `[long pause]`). Inline IPA `"/…/"`. Audio tags like `[whispers]`. Stability reportedly 0, 0.5 or 1 only. PVC voices are "not fully optimized". Accepts `language_code` (third party) |
| `eleven_v3_conversational` | Realtime (~280 ms) | not stated | 70+ | Aimed at agents and WebSockets. Not needed here |
| `eleven_multilingual_v2` | Flagship, most stable | **10,000** | 29: en ja zh de hi fr ko pt it es id nl **tr** fil pl sv **bg ro** ar cs **el** fi **hr** ms sk da ta uk ru | **Default `model_id`.** Best number normalisation. `language_code` not supported. No phoneme tags |
| `eleven_flash_v2_5` | Fast (~75 ms), **50% cheaper per char** on the API | **40,000** | The v2 set plus hu, no, vi (32) | No number normalisation by default. `apply_text_normalization:"on"` is Enterprise-only for v2.5 |
| `eleven_flash_v2` | Fast | 30,000 | en only | **The only model with SSML `<phoneme>` support** (turbo_v2 too, per help centre) |
| `eleven_turbo_v2_5`, `eleven_turbo_v2` | **Deprecated** | 40k / 30k | Same as the Flash equivalents | "Functionally equivalent" to the Flash models. Use Flash instead |
| `eleven_multilingual_sts_v2`, `eleven_english_sts_v2`, `eleven_*ttv*`, `scribe_*`, `music_*` | Not TTS | | | Filtered out by `can_do_text_to_speech` |

### `GET /v1/models` response: array of `ModelResponseModel`

Fields:

- `model_id` (required)
- `name`, `description`
- `can_do_text_to_speech`, `can_do_voice_conversion`
- `can_be_finetuned`, `can_use_style`, `can_use_speaker_boost`
- `serves_pro_voices`, `token_cost_factor`, `requires_alpha_access`
- **`maximum_text_length_per_request`** ("longer requests are rejected")
- `languages: [{language_id, name}]`
- `model_rates: {character_cost_multiplier, cost_discount_multiplier}`
- `concurrency_group`
- `max_characters_request_free_user` and `max_characters_request_subscribed_user`: **deprecated, "Not
  enforced"**. Use `maximum_text_length_per_request` instead.

Our real list of models and their `language_id` values are UNVERIFIED (no key). The OpenAPI example uses
`"en"`, and the example value `maximum_text_length_per_request: 1000000` is only a placeholder. Enforce
our own cap (`spoken_text` ≤ 1000) and also check `min(documentedLimit, maximum_text_length_per_request)`.

---

## 6. Balkan and tourist languages

| Language | Code | multilingual_v2 | flash_v2_5 | v3 |
|---|---|---|---|---|
| Bulgarian | bg | ✓ | ✓ | ✓ |
| Croatian | hr | ✓ | ✓ | ✓ |
| Greek | el | ✓ | ✓ | ✓ |
| Romanian | ro | ✓ | ✓ | ✓ |
| Turkish | tr | ✓ | ✓ | ✓ |
| Hungarian | hu | ✗ | ✓ | ✓ |
| Serbian | sr | ✗ | ✗ | ✓ |
| Bosnian | bs | ✗ | ✗ | ✓ |
| Macedonian | mk | ✗ | ✗ | ✓ |
| Slovenian | sl | ✗ | ✗ | ✓ |
| Albanian | sq | ✗ | ✗ | ✗ (not listed anywhere) |
| en / de / it / ru / uk / pl / cs / sk | | ✓ | ✓ | ✓ |

- The docs list the v3 languages with ISO 639-3 codes (`bul`, `srp`, `hrv`, `ell`, `ron`, `tur`,
  `mkd`, `bos`, `slv`, `hun`). The `language_code` parameter takes ISO 639-1. Pipecat (2026) maps these
  to `bg sr hr el ro tr mk bs sl hu` and says unsupported pairs get a 400 (UNVERIFIED).
- Montenegrin: use `sr`, `hr` or `bs` text.
- Serbian Cyrillic vs Latin quality on v3: UNVERIFIED, so test both.
- `announcement_language` is BCP-47-ish (`sr-Latn`). Send only the primary subtag (`sr`).
- Pick a voice whose `labels.accent`, `labels.language` or `verified_languages[]` matches the target
  language. Otherwise the output has a foreign accent.

---

## 7. Voices: `GET /v2/voices` [DOC]

**Query parameters:**

- `page_size`: default 10, **max 100**.
- `next_page_token`: paginate with this plus `has_more`. Do not rely on `total_count`.
- `include_total_count`: default `true`, and it has a performance cost. Send `false`.
- Filters: `search` (name, description, labels, category), `sort` (`created_at_unix` or `name`),
  `sort_direction`, `category`.
- `voice_type`: `personal`, `community`, `default`, `workspace`, `non-default`, `non-community` or
  `saved`.
- More filters: `gender`, `age`, `accent`, `language[]`, `use_cases[]`, `voice_ids[]` (≤100),
  `collection_id`, `high_quality`.
- Arrays use repeated keys (`language=bg&language=hr`), the same as the official SDK.

**Response:** `{ voices: VoiceResponseModel[], has_more: boolean, total_count: number, next_page_token: string|null }`.

**`VoiceResponseModel` fields we use:**

- `voice_id`
- `name`
- `category` (`generated`, `cloned`, `premade`, `professional`, `famous` or `high_quality`)
- `labels` (a string map, e.g. accent, gender, age, language, use_case)
- `description`
- `preview_url` (usually a public CDN MP3. Public access is UNVERIFIED. Allow its host in CSP
  `media-src` or proxy it)
- `settings`
- `verified_languages: [{language, model_id, accent?, locale?, preview_url?}]`
- `available_for_tiers`
- `is_legacy`

Also returned: `samples`, `fine_tuning`, `sharing`, `high_quality_base_model_ids`, `safety_control`,
`voice_verification`, `permission_on_resource`, `is_owner`, `created_at_unix` and more.

**Guidance:**

- Store `voice_id` and `voice_name` on the announcement.
- Never hardcode voice ids. The docs use example ids such as `JBFqnCBsd6RMkjVDRZzb`, but the account's
  library differs.
- Free tier cannot use Voice Library voices via the API [DOC]. Reports show 402 for this, and a 400
  "creator tier or above" error for some voices.

---

## 8. Subscription: `GET /v1/user/subscription` [DOC]

- Useful fields: `tier`, `status` (`trialing`, `active`, `incomplete`, `past_due`, `free` or
  `free_disabled`), `character_count` (used), `character_limit`, `next_character_count_reset_unix`,
  `can_extend_character_limit`, `max_credit_limit_extension`, `currency` and `billing_period`.
- Needs the `user_read` scope. Use it for an admin "credits left" badge, not to gate requests; the
  TTS call itself reports quota errors.

---

## 9. Pronunciation of brand names [DOC best-practices + pronunciation-dictionaries guide]

| Technique | Works on | Notes |
|---|---|---|
| **Plain respelling in the text** (e.g. "Emerald" → "Emmerald", `name_pronunciation`) | **All models** | The docs recommend writing phonetically: capital letters, dashes, apostrophes, quotes. **Our primary approach.** Respell in the *target language's* spelling |
| SSML `<break time="1.5s" />` (≤ 3 s) | All models **except v3** | Too many breaks cause instability. v3 uses `[pause]`, `[short pause]`, `[long pause]` |
| SSML `<phoneme alphabet="cmu-arpabet"\|"ipa" ph="…">Word</phoneme>` | **`eleven_flash_v2` only** (help centre adds turbo_v2), **English only** | One word per tag. CMU is recommended over IPA. Stress marks matter |
| Inline IPA `"/ˈmɛrɪdiən/"` | **`eleven_v3` only** | 80–90% consistent per the docs |
| Pronunciation dictionary (`pronunciation_dictionary_locators`, max 3) | Alias rules: all models. **Phoneme rules: only `eleven_flash_v2` and `eleven_v3`** (other models skip them) | Create from rules: `POST /v1/pronunciation-dictionaries/add-from-rules`, body `{name, rules:[{type:"alias", string_to_replace, alias, case_sensitive?=true, word_boundaries?=true} \| {type:"phoneme", string_to_replace, phoneme, alphabet:"ipa"\|"cmu-arpabet"}]}`. Returns `{id, version_id, …}`. Non-English IPA/CMU needs v3 |

**Recommendation.** Do alias substitution ourselves (case-insensitive, whole-word) before the call:

- It behaves the same on every model.
- It keeps no remote state.
- It keeps `generation_hash` honest.

Also note that the model speaks any descriptive or stage-direction text aloud. The only exception is v3
`[audio tags]`, and we don't use those for announcements.

---

## 10. Text normalisation [DOC]

- `apply_text_normalization` defaults to `auto`.
- `eleven_multilingual_v2` reads `$1,000,000` correctly. Flash v2.5 reads it as "one thousand thousand"
  and does not normalise phone numbers, dates or currencies well.
- Recommendation: admins write numbers, times and prices as words in `spoken_text`. Balkan numerals
  inflect by gender and case, so do not auto-expand them. Optionally add a UI hint.

---

## 11. Limits, concurrency and plans

**Per-request character limits:** section 5. Roughly 1,000 characters is about 1 minute of audio [DOC].

**Concurrency** [DOC models page + help centre]:

| Plan | multilingual/v3 | flash/turbo |
|---|---|---|
| Free | 2 | 4 |
| Starter | 3 | 6 |
| Creator | 5 | 10 |
| Pro | 10 | 20 |
| Scale / Business | 15 | 30 |

- Every HTTP TTS request counts toward the limit.
- One doc says excess requests are queued (about 50 ms extra). The errors doc and help centre say you
  get `429 concurrent_limit_exceeded` / `too_many_concurrent_requests`. Handle both.
- A `system_busy` 429 means ElevenLabs is overloaded, and a retry usually succeeds.

**Plans** [DOC]:

- Paid plans are required for commercial use.
- `mp3_44100_192` needs Creator+. `pcm_44100` and `wav_44100` need Pro+.
- Free tier cannot use the Voice Library via the API.
- Free tier is blocked on flagged or shared IPs ("Unusual activity detected"). Paid plans are immune.
- Flash is 50% cheaper per character on the API. Exact prices are UNVERIFIED; see
  https://elevenlabs.io/pricing/api.

---

## 12. Proposed client: `src/lib/tts/elevenlabs.ts` [CODE]

**Verification:**

- Typechecked with tsc 5.9.3 (strict, `lib: dom+esnext`, `moduleResolution: bundler`).
- Run with `node --conditions=react-server --import tsx`, so `server-only` resolves to its empty export.
- Uses Node 24 `fetch`, `AbortSignal.timeout` and `AbortSignal.any`. `AbortSignal.any` needs
  Node ≥ 20.3, which satisfies the project's `engines >=20.9`. zod 4.6.5 is already a dependency.
  `z.record(z.string(), z.string())` is the two-argument zod 4 form.

**Results against the mock server and the live API:**

| Scenario | Result |
|---|---|
| 200 audio with `request-id: req123` and `character-cost: 42` | `{bytes, contentType:"audio/mpeg", requestId:"req123", characterCount:42}` |
| `voiceId "abc/def"` | Path-encoded as `abc%2Fdef`. Query `?output_format=mp3_44100_128` |
| `modelId eleven_multilingual_v2` with `languageCode "bg"` | `language_code` **not sent** |
| `eleven_flash_v2_5` with `"hr"` | `language_code:"hr"` sent |
| `listModels` | STS and alpha models filtered out. Unknown keys stripped |
| `listVoices` | Followed `next_page_token`. Query `page_size=100&include_total_count=false&search=…` |
| 401 legacy `quota_exceeded` | `quota` |
| 429 `too_many_concurrent_requests` + `Retry-After: 2` | `rate_limited`, `retryAfterMs` 2000 |
| 429 new `concurrent_limit_exceeded` | `rate_limited`, requestId from `detail.request_id` |
| 404 `voice_not_found` | `voice_not_found` |
| 400 legacy `voice_does_not_exist` | `voice_not_found` |
| 402 library voice | `quota` |
| 400 "creator tier or above" | `quota` |
| 400 `max_character_limit_exceeded` | `validation` |
| 400 unsupported language_code | `validation` |
| 503 HTML | `provider_unavailable` |
| 403 `forbidden` | `auth` |
| 200 `application/json` or empty body | `provider_unavailable` |
| Headers never sent, 300 ms timeout | `timeout` after about 306 ms |
| Body stalls after the first bytes, 300 ms timeout | `timeout` after about 302 ms, so the deadline covers the body |
| Caller `AbortController` | Re-throws the caller's reason |
| Connection refused | `provider_unavailable` |
| **LIVE** invalid key on TTS, models, voices and subscription | `auth`, `code=unauthorized`, requestId from body |
| **LIVE** `stability: 1.5` | `validation` 422 with "body.voice_settings.stability: Input should be less than or equal to 1" |

```ts
// Proposed src/lib/tts/elevenlabs.ts — minimal server-only ElevenLabs REST client (fetch, no SDK).
import "server-only";
import { z } from "zod";

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

/** Every value accepted by `output_format` (OpenAPI enum, 2026-09). */
export const OUTPUT_FORMATS = [
  "alaw_8000",
  "mp3_22050_32", "mp3_24000_48", "mp3_44100_32", "mp3_44100_64", "mp3_44100_96",
  "mp3_44100_128", // default; allowed on every plan
  "mp3_44100_192", // Creator tier or above
  "opus_48000_32", "opus_48000_64", "opus_48000_96", "opus_48000_128", "opus_48000_192",
  "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_32000",
  "pcm_44100", // Pro tier or above
  "pcm_48000",
  "ulaw_8000",
  "wav_8000", "wav_16000", "wav_22050", "wav_24000", "wav_32000",
  "wav_44100", // Pro tier or above
  "wav_48000",
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Models whose docs say `language_code` is NOT supported: never send it to them. */
const MODELS_WITHOUT_LANGUAGE_CODE = new Set(["eleven_multilingual_v2", "eleven_multilingual_v1"]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ElevenLabsErrorKind =
  | "auth" // bad/missing/expired key, missing key scope, IP allowlist (401/403)
  | "quota" // out of credits, plan/tier does not allow this voice/format (402, 401 quota_exceeded)
  | "rate_limited" // 429: concurrency limit, rate limit, system_busy
  | "validation" // 400/422: bad text, voice settings, model, language_code, text too long
  | "voice_not_found" // voice id unknown or not accessible to this account
  | "provider_unavailable" // 5xx/408, network failure, unexpected non-audio 200
  | "timeout"; // our AbortSignal.timeout fired (connect, headers or body)

export class ElevenLabsError extends Error {
  readonly kind: ElevenLabsErrorKind;
  readonly httpStatus?: number;
  /** detail.code (new format) or detail.status (legacy format) */
  readonly providerCode?: string;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(
    kind: ElevenLabsErrorKind,
    message: string,
    extra: {
      httpStatus?: number;
      providerCode?: string;
      requestId?: string;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "ElevenLabsError";
    this.kind = kind;
    this.httpStatus = extra.httpStatus;
    this.providerCode = extra.providerCode;
    this.requestId = extra.requestId;
    this.retryAfterMs = extra.retryAfterMs;
  }

  /** Worth retrying later with backoff (never retry auth/quota/validation/voice_not_found). */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "provider_unavailable" || this.kind === "timeout";
  }
}

const has = (tokens: string[], ...wanted: string[]) => tokens.some((t) => wanted.includes(t));

/** Exported for unit tests. `voiceScoped` = the URL contains a voice id (TTS, GET voice). */
export function classifyElevenLabsError(
  httpStatus: number,
  tokens: string[],
  message: string,
  voiceScoped: boolean,
): ElevenLabsErrorKind {
  const msg = message.toLowerCase();
  if (has(tokens, "voice_not_found", "voice_does_not_exist", "voice_access_denied")) return "voice_not_found";
  if (has(tokens, "model_not_found", "unsupported_model", "model_access_denied")) return "validation";
  if (
    httpStatus === 402 ||
    has(tokens, "quota_exceeded", "insufficient_credits", "payment_required", "subscription_required", "feature_not_available") ||
    /quota|credits|upgrade your subscription|tier or above/.test(msg)
  ) return "quota";
  if (
    httpStatus === 429 ||
    has(tokens, "too_many_concurrent_requests", "concurrent_limit_exceeded", "rate_limit_exceeded", "rate_limit_error", "system_busy")
  ) return "rate_limited";
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    has(tokens, "authentication_error", "authorization_error", "invalid_api_key", "needs_authorization",
      "missing_permissions", "unauthorized", "workspace_not_found")
  ) return "auth";
  if (httpStatus === 404) return voiceScoped ? "voice_not_found" : "provider_unavailable";
  if (httpStatus === 408 || httpStatus >= 500) return "provider_unavailable";
  return "validation"; // 400, 409, 413, 422, other 4xx
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

async function errorFromResponse(res: Response, voiceScoped: boolean): Promise<ElevenLabsError> {
  const raw = await res.text().catch(() => "");
  let detail: unknown;
  try {
    detail = (JSON.parse(raw) as { detail?: unknown }).detail;
  } catch {
    detail = undefined;
  }
  const tokens: string[] = [];
  let message = raw.slice(0, 300) || `HTTP ${res.status}`;
  let providerCode: string | undefined;
  let bodyRequestId: string | undefined;

  if (Array.isArray(detail)) {
    // FastAPI/pydantic 422: [{ type, loc: ["body","voice_settings","stability"], msg, input, ctx }]
    tokens.push("validation_error");
    providerCode = "validation_error";
    message = detail
      .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join(".")}: ${d.msg ?? "invalid"}`)
      .join("; ");
  } else if (detail && typeof detail === "object") {
    // New: { type, code, message, status (legacy mirror), request_id, param }; legacy: { status, message }
    const d = detail as Record<string, unknown>;
    for (const k of ["type", "code", "status"] as const) {
      if (typeof d[k] === "string") tokens.push((d[k] as string).toLowerCase());
    }
    providerCode = typeof d.code === "string" ? d.code : typeof d.status === "string" ? d.status : undefined;
    if (typeof d.message === "string") message = d.message;
    if (typeof d.request_id === "string") bodyRequestId = d.request_id;
  } else if (typeof detail === "string") {
    message = detail;
  }

  const kind = classifyElevenLabsError(res.status, tokens, message, voiceScoped);
  return new ElevenLabsError(kind, `ElevenLabs ${res.status} ${providerCode ?? ""}: ${message}`.trim(), {
    httpStatus: res.status,
    providerCode,
    requestId: res.headers.get("request-id") ?? bodyRequestId ?? res.headers.get("x-trace-id") ?? undefined,
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
  });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface ElevenLabsClientOptions {
  apiKey: string;
  baseUrl?: string; // e.g. "https://api.us.elevenlabs.io" to pin US; EU/IN residency are enterprise-only
  fetch?: typeof fetch; // injectable for tests
}

interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal; // caller cancellation; re-thrown as-is (not classified)
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

function buildUrl(base: string, path: string, query?: Query): string {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item)); // repeat-key style
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Runs fetch + body read under ONE deadline so a stalled audio body also times out.
 * `read` must consume the body (arrayBuffer/json) inside this call.
 */
async function call<T>(
  opts: ElevenLabsClientOptions,
  req: { method: "GET" | "POST"; path: string; query?: Query; body?: unknown; voiceScoped?: boolean },
  co: CallOptions,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(co.timeoutMs ?? 30_000);
  const signal = co.signal ? AbortSignal.any([timeout, co.signal]) : timeout;
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(buildUrl(opts.baseUrl ?? ELEVENLABS_BASE_URL, req.path, req.query), {
      method: req.method,
      headers: {
        "xi-api-key": opts.apiKey,
        ...(req.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal,
      cache: "no-store", // Next.js: never cache provider calls in the Data Cache
    });
    if (!res.ok) throw await errorFromResponse(res, req.voiceScoped ?? false);
    return await read(res);
  } catch (err) {
    if (err instanceof ElevenLabsError) throw err;
    if (timeout.aborted) {
      throw new ElevenLabsError("timeout", `ElevenLabs request timed out after ${co.timeoutMs ?? 30_000} ms`, { cause: err });
    }
    if (co.signal?.aborted) throw co.signal.reason ?? err;
    throw new ElevenLabsError("provider_unavailable", "Network error contacting ElevenLabs", { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Response schemas (lenient: only what we use; unknown keys are stripped)
// ---------------------------------------------------------------------------

const ModelSchema = z.object({
  model_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  can_do_text_to_speech: z.boolean().nullish(),
  requires_alpha_access: z.boolean().nullish(),
  can_use_style: z.boolean().nullish(),
  can_use_speaker_boost: z.boolean().nullish(),
  maximum_text_length_per_request: z.number().nullish(),
  languages: z.array(z.object({ language_id: z.string(), name: z.string() })).nullish(),
  model_rates: z.object({ character_cost_multiplier: z.number() }).nullish(),
});

const VoiceSchema = z.object({
  voice_id: z.string(),
  name: z.string().nullish(),
  category: z.string().nullish(), // generated | cloned | premade | professional | famous | high_quality
  description: z.string().nullish(),
  labels: z.record(z.string(), z.string()).nullish(), // accent, gender, age, language, use_case, descriptive...
  preview_url: z.string().nullish(),
  verified_languages: z
    .array(
      z.object({
        language: z.string(),
        model_id: z.string(),
        accent: z.string().nullish(),
        locale: z.string().nullish(),
        preview_url: z.string().nullish(),
      }),
    )
    .nullish(),
});

const VoicesPageSchema = z.object({
  voices: z.array(VoiceSchema),
  has_more: z.boolean(),
  next_page_token: z.string().nullish(),
});

const SubscriptionSchema = z.object({
  tier: z.string(),
  status: z.string(),
  character_count: z.number(),
  character_limit: z.number(),
  next_character_count_reset_unix: z.number().nullish(),
});

async function parseJson<S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> {
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ElevenLabsError("provider_unavailable", `Unexpected ElevenLabs response shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TtsModel {
  modelId: string;
  name: string;
  description: string | null;
  /** language_id values as returned by /v1/models (ISO 639-1 style, e.g. "en", "bg"). */
  languages: { id: string; name: string }[];
  maxTextLength: number | null;
  costMultiplier: number | null;
  canUseStyle: boolean;
  canUseSpeakerBoost: boolean;
}

export interface Voice {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
  verifiedLanguages: { language: string; modelId: string; accent: string | null; locale: string | null }[];
}

export interface VoiceSettings {
  stability?: number; // 0..1 (422 outside); eleven_v3 reportedly only 0 | 0.5 | 1
  similarity_boost?: number; // 0..1 (422 outside)
  style?: number; // 0..1 by convention; not schema-validated; >0 adds latency
  use_speaker_boost?: boolean;
  speed?: number; // 0.7..1.2 per docs; not schema-validated
}

export interface SynthesizeInput extends CallOptions {
  voiceId: string;
  modelId: string;
  text: string;
  /** ISO 639-1. Dropped for multilingual_v2. Send only if listed in the model's languages. */
  languageCode?: string;
  voiceSettings?: VoiceSettings;
  outputFormat?: OutputFormat;
  seed?: number; // 0..4294967295, best-effort determinism
  applyTextNormalization?: "auto" | "on" | "off";
  pronunciationDictionaryLocators?: { pronunciation_dictionary_id: string; version_id?: string }[]; // max 3
}

export interface SynthesizeResult {
  audio: ArrayBuffer;
  contentType: string;
  requestId?: string;
  characterCount?: number;
}

export function createElevenLabsClient(opts: ElevenLabsClientOptions) {
  if (!opts.apiKey) throw new ElevenLabsError("auth", "ELEVENLABS_API_KEY is not set");

  return {
    /** GET /v1/models → TTS-capable, non-alpha models only. */
    async listModels(o: CallOptions = {}): Promise<TtsModel[]> {
      const models = await call(opts, { method: "GET", path: "/v1/models" }, { timeoutMs: 15_000, ...o }, (res) =>
        parseJson(res, z.array(ModelSchema)),
      );
      return models
        .filter((m) => m.can_do_text_to_speech === true && m.requires_alpha_access !== true)
        .map((m) => ({
          modelId: m.model_id,
          name: m.name ?? m.model_id,
          description: m.description ?? null,
          languages: (m.languages ?? []).map((l) => ({ id: l.language_id, name: l.name })),
          maxTextLength: m.maximum_text_length_per_request ?? null,
          costMultiplier: m.model_rates?.character_cost_multiplier ?? null,
          canUseStyle: m.can_use_style === true,
          canUseSpeakerBoost: m.can_use_speaker_boost === true,
        }));
    },

    /** GET /v2/voices, following next_page_token (page_size max 100). */
    async listVoices(o: CallOptions & { search?: string; maxPages?: number } = {}): Promise<Voice[]> {
      const out: Voice[] = [];
      let token: string | undefined;
      for (let page = 0; page < (o.maxPages ?? 10); page++) {
        const data = await call(
          opts,
          {
            method: "GET",
            path: "/v2/voices",
            query: { page_size: 100, include_total_count: false, search: o.search, next_page_token: token },
          },
          { timeoutMs: 15_000, ...o },
          (res) => parseJson(res, VoicesPageSchema),
        );
        for (const v of data.voices) {
          out.push({
            voiceId: v.voice_id,
            name: v.name ?? v.voice_id,
            category: v.category ?? null,
            description: v.description ?? null,
            labels: v.labels ?? {},
            previewUrl: v.preview_url ?? null,
            verifiedLanguages: (v.verified_languages ?? []).map((l) => ({
              language: l.language,
              modelId: l.model_id,
              accent: l.accent ?? null,
              locale: l.locale ?? null,
            })),
          });
        }
        if (!data.has_more || !data.next_page_token) break;
        token = data.next_page_token;
      }
      return out;
    },

    /** GET /v1/user/subscription (key needs the user_read scope). */
    async getSubscription(o: CallOptions = {}) {
      return call(opts, { method: "GET", path: "/v1/user/subscription" }, { timeoutMs: 15_000, ...o }, (res) =>
        parseJson(res, SubscriptionSchema),
      );
    },

    /** POST /v1/text-to-speech/{voice_id}?output_format=… → whole audio file in memory. */
    async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
      const text = input.text.trim();
      if (!text) throw new ElevenLabsError("validation", "Text is empty");
      const body: Record<string, unknown> = { text, model_id: input.modelId };
      if (input.languageCode && !MODELS_WITHOUT_LANGUAGE_CODE.has(input.modelId)) body.language_code = input.languageCode;
      if (input.voiceSettings) body.voice_settings = input.voiceSettings;
      if (input.seed !== undefined) body.seed = input.seed;
      if (input.applyTextNormalization) body.apply_text_normalization = input.applyTextNormalization;
      if (input.pronunciationDictionaryLocators?.length) {
        body.pronunciation_dictionary_locators = input.pronunciationDictionaryLocators.slice(0, 3);
      }

      return call(
        opts,
        {
          method: "POST",
          path: `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`,
          query: { output_format: input.outputFormat ?? "mp3_44100_128" },
          body,
          voiceScoped: true,
        },
        { timeoutMs: 60_000, signal: input.signal, ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}) },
        async (res) => {
          const contentType = res.headers.get("content-type") ?? "";
          const requestId = res.headers.get("request-id") ?? undefined;
          if (!contentType.startsWith("audio/") && !contentType.startsWith("application/octet-stream")) {
            throw new ElevenLabsError("provider_unavailable", `Expected audio, got "${contentType}"`, { requestId });
          }
          const audio = await res.arrayBuffer();
          if (audio.byteLength === 0) {
            throw new ElevenLabsError("provider_unavailable", "ElevenLabs returned empty audio", { requestId });
          }
          const cost = res.headers.get("character-cost") ?? res.headers.get("x-character-count");
          const characterCount = cost !== null && Number.isFinite(Number(cost)) ? Number(cost) : undefined;
          return { audio, contentType, requestId, characterCount };
        },
      );
    },
  };
}

export type ElevenLabsClient = ReturnType<typeof createElevenLabsClient>;
```

### Usage sketch (route handler, server-only)

```ts
import { createElevenLabsClient, ElevenLabsError } from "@/lib/tts/elevenlabs";

const tts = createElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY ?? "" }); // guard with isTtsConfigured() first
const { audio, requestId, characterCount } = await tts.synthesize({
  voiceId, modelId, text: spokenText, languageCode: primarySubtag(business.announcement_language),
  voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 },
  outputFormat: "mp3_44100_128", timeoutMs: 60_000, signal: request.signal,
});
// then: parseBuffer(new Uint8Array(audio), "audio/mpeg") from music-metadata for duration
// (signature verified: parseBuffer(uint8Array, fileInfo?: IFileInfo | string, options?)),
// upload as audio/mpeg to announcements/{business_id}/{announcement_id}/{random}.mp3
```

---

## 13. Integration gotchas

- **Error mapping.** Map `ElevenLabsError.kind` onto the existing `ApiErrorCode` values:

  | `kind` | `ApiErrorCode` | Notes |
  |---|---|---|
  | `auth` | `tts_not_configured` | Log it loudly. An admin must fix the key or its scopes |
  | `quota` | `tts_failed` | Message: "ElevenLabs credits/plan" |
  | `rate_limited` | `rate_limited` | |
  | `validation` | `invalid_request` | |
  | `voice_not_found` | `invalid_request` | Use `fields.voice_id` |
  | `provider_unavailable`, `timeout` | `tts_failed` | Mark retryable |

  Always log `requestId` and `characterCount`. Never log the key or the full text of the error body.
- **`generation_hash`.** Compute sha256 over the exact request: `{voiceId, modelId, outputFormat, body}`
  after trimming, respelling and dropping `language_code`. Skip regeneration when the hash is unchanged.
  `seed` is not guaranteed deterministic, so reuse the stored audio instead of regenerating.
- **Concurrency guard.** Set `status='generating'` in the database before calling and allow at most one
  in-flight generation per announcement. Admin-triggered volume stays far below even Free-plan
  concurrency.
- **Next.js.** The fetch sets `cache: "no-store"`. The route handler stays on the Node runtime. If
  hosting has a function time limit, set `maxDuration` of at least 60 s (hosting is UNVERIFIED).
- **Tests.** `vitest.config.ts` already aliases `server-only` to `tests/stubs/server-only.ts`. Inject
  `fetch` via `createElevenLabsClient({ apiKey, fetch })`. `classifyElevenLabsError` is exported for
  table-driven tests.
- **Stored settings.** Voices have stored settings. `voice_settings` in the request overrides them for
  that request only, so always send them explicitly for reproducibility.
- **Model and language checks.** Validate `model_id` and language against a cached `listModels()` result
  (cache it about 1 hour server-side). Reject text longer than the model limit before calling.
- **Deprecated parameters.** Do not send `optimize_streaming_latency`, `use_pvc_as_ivc` or
  `enable_logging=false` (Enterprise only).

## 14. UNVERIFIED (confirm with a real key)

1. The actual `GET /v1/models` output for our account:
   - whether `eleven_v3` has `requires_alpha_access: false`
   - the format of `languages[].language_id` (expected ISO 639-1, e.g. `bg`, `sr`)
   - the real `maximum_text_length_per_request` values
2. Whether `language_code` sent to an unsupported model gives 400 or is ignored. The docs say "ignored";
   pipecat (2026) says 400.
3. Whether the v3 stability restriction to `{0, 0.5, 1}` still applies to `/v1/text-to-speech`
   (third-party reports).
4. Whether the TTS 200 response really includes `character-cost`, and whether it also includes
   `x-character-count` or `history-item-id`. Also whether 429 responses carry `Retry-After`.
5. The current quota-exceeded format: legacy `401 quota_exceeded`, or the new
   `402 payment_required / insufficient_credits`. The client handles both.
6. Serbian Latin vs Cyrillic quality on v3. The exact error for a free-tier library voice (402 per a
   third party). Whether `preview_url` is publicly fetchable.
