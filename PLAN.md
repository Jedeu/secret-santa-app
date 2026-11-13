# PLAN.md: Image and GIF attachments in chat (pasted or file-selected, no-cost media host)

## Status

**Status: APPROVED — owner approved the reviewed plan and recommended decisions O1–O6 on 2026-11-12 MST by replying “Yes” to the explicit approval question. Primary adversarial review COMPLETE.** Approval covers the exact listed implementation and verification scope, public-by-link JPEG/PNG/GIF attachments, one image per message, the stated caps, online-first upload, ship-dark setup, deferred orphan deletion and the documented limits of free allowances. It does not authorize account creation, real Firebase/Cloudinary access, deployment, billing changes or Git publication. Replaces all earlier drafts and the older mobile-reveal plan; no earlier status carries over.

Planner: Claude Fable 5.2 at explicit xhigh effort, read/search only. Primary reviewed the initial draft and two complete revisions, with no blocking design objection remaining. Review corrections cover writable-scope/ABA fencing, successful and failed upload lifecycle races, payload-digest idempotency, pre-decode header checks, bounded body reads, distinct timeout/cancel handling, safe error logging, synthetic provider/CDN verification and accurate free-tier limits. The final own-draft clearing rule and token-before-abort ordering are accepted as necessary timeout/cancellation behavior. These are plan-review conclusions, not runtime verification or user approval.

At approval, no implementation or app checks had run. No provider account, real Firebase project, production or database access occurred. Primary planning checks: Markdown diff/whitespace and file-reference checks only. The planner itself ran no commands. Implementation and verification evidence will be appended by the primary.

## Publication authorization — 2026-11-12 MST

The owner reported completing the Cloudinary configuration and then explicitly requested: “Ok done push a PR and I will merge after”. This separately authorizes committing the reviewed changes, normally pushing a new feature branch and opening a PR against `main`; the owner will merge it. It does not authorize direct pushes to `main`, force-pushing, manual deployment or real Firebase/Cloudinary access. Configuration is owner-reported, not independently inspected or smoke-tested.

Primary fetched `origin` and confirmed the previous recipient-reveal PR #66 is merged and its branch's committed tree equals `origin/main`. Publication will use a fresh `feat/chat-media-attachments` branch based on that main tree. Commit scope is the 35 approved implementation files plus PLAN.md and RESEARCH.md, staged by explicit path; owner settings, UI concepts and generated public workers remain excluded. The implementation source fingerprints still match the passing verification snapshot, so application suites do not need rerunning for publication-only status notes. GitHub CI will run independently on the PR.

## Goal

Let a participant paste or pick one image or animated GIF per message, preview and remove it before sending, and see it in chat, the public feed and archives, using a free no-card media host and leaving text messaging unchanged.

## Scope and key decisions

**In scope:** one image per message (media-only or captioned); input by paste or file button; JPEG, PNG and GIF only; removable composer preview; rendering in chat (delivered, pending, failed), public feed, archive and thread previews; server-mediated upload to Cloudinary Free, invisible when unconfigured.

**Out of scope (deferred):** WebP input, searchable GIF picker, participant-only delivery, provider-side orphan deletion, drag-and-drop, multiple images, lightbox, offline upload persistence, video.

| # | Decision | Reason |
|---|---|---|
| D1 | Server-mediated upload: browser → app route → Cloudinary with Basic Auth. | Secret stays on the server; the server inspects the bytes it forwards; Cloudinary never sees an uploader's IP; one origin; fully mockable. Direct signed upload would allow larger files but needs a signing route, upload-proof verification and reject cleanup. |
| D2 | Raw request body browser → server, metadata in headers. Multipart only server → Cloudinary, built with Node's global `FormData`/`Blob`. No new dependency. | A raw body can be bounded by bytes and time; no filename leaves the browser. |
| D3 | Online-first: bytes upload when Send is pressed; only a small reference enters the localStorage outbox. | The outbox never holds bytes or base64; after upload, delivery keeps today's durable retry. |
| D4 | Server-owned reference: `mediaUploads/{clientMessageId}` binds an upload to account, sender, recipient, conversation, year, epoch and a SHA-256 of the bytes. The send route copies the attachment from that record; the client sends only an id. | No client-supplied URL or metadata is ever stored or rendered. |
| D5 | Stills are always re-encoded in the browser (max edge 1600 px, ≤ 1 MiB, PNG or JPEG). GIFs are uploaded byte-for-byte (≤ 3 MiB). No Cloudinary transformations are requested. | Re-encoding strips EXIF/GPS; untouched GIF bytes keep animation. |
| D6 | Public-by-link delivery (Cloudinary default). | Owner decision O1; not assumed. |
| D7 | Media outbox items use their own localStorage key prefix. | A tab on the old build cannot delete them or send a caption without its image. |
| D8 | Every asynchronous client step is fenced on the captured writable scope object from `src/lib/year-client.js` plus the captured account, under one total deadline. | Same rule the read-marker, typing and reaction writers already follow; no step can hang the composer. |
| D9 | Every server write to `mediaUploads` happens inside `runFencedTransaction` in the open year and only while the reservation is still the caller's current attempt; provider HTTP is never inside a callback. | Annual contract; retry-safe. |
| D10 | No Firestore rules change, no index, no new listener, no routing-function change. | Messages stay server-written; the new collection falls under the catch-all deny. |

## How it works

1. **Attach.** Paste or pick a file. The browser preflights the header, prepares the image (D5) and shows a removable preview. Nothing leaves the browser.
2. **Send.** The browser captures the session (D8) and POSTs the bytes to `POST /api/messages/media`.
3. **Server.** Authenticate and check the roster before reading; read the body under byte and time bounds; parse the header; hash the bytes; reserve the record in a fenced transaction; upload to Cloudinary outside any transaction; finalize in a second fenced transaction; return a server-built `attachment`.
4. **Enqueue.** If the captured session is still current, the browser enqueues `{ content, attachment }` under the same `clientMessageId` and drains. The drain posts `/api/messages/send` with `attachment: { id }`.
5. **Commit.** The send route re-authorizes as today, checks the record's binding in the same fenced transaction, writes the message with the server-owned `attachment` and marks the record `attached`.
6. **Render.** Clients build the image URL from validated structured fields on a fixed host.

## Data shapes and limits

**`attachment` on a message (optional; absent on text messages, never `null`)**

```js
{
  id: string,            // UUID v4 generated by the server (mediaId)
  kind: 'image',
  provider: 'cloudinary',
  cloudName: string,     // /^[a-z0-9][a-z0-9_-]{0,62}$/i
  publicId: string,      // /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/  -> `ss-${year}-${mediaId}`
  version: number,       // positive safe integer, from the provider
  format: 'jpg' | 'png' | 'gif',  // header-parsed format, confirmed equal to the provider's
  width: number,         // integer 1..4096, as reported by the provider
  height: number,        // integer 1..4096, as reported by the provider
  bytes: number          // integer 1..3145728, as reported by the provider
}
```

`content` may be `''` only when `attachment` is present; the 4000-character maximum is unchanged.

**`mediaUploads/{clientMessageId}`** (global, server-written; clients denied by the catch-all rule)

```js
{
  id: string,              // doc id = clientMessageId of the message this upload is for
  mediaId: string,         // UUID of the current attempt (becomes attachment.id)
  status: 'reserved' | 'uploaded' | 'attached' | 'failed',
  attempts: number,        // 1..3
  authUid: string, fromId: string, toId: string, conversationId: string,
  year: number, epoch: number,
  quotaKey: string,        // `${authUid}|${YYYY-MM-DD}` (UTC)
  sha256: string,          // hex digest of the received bytes; never copied to an attachment
  provider: 'cloudinary', cloudName: string, publicId: string,
  staleProviderIds: string[],   // publicIds of superseded attempts that may exist at the provider
  format: 'jpg' | 'png' | 'gif',
  width: number, height: number, bytes: number,   // header-parsed at reservation; provider values after finalize
  version: number | null,
  createdAt: string, updatedAt: string, uploadedAt: string | null, attachedAt: string | null
}
```

**Outbox media item** — key `secret-santa-message-outbox-v2:media-item:{id}`: `{ clientMessageId, ownerUid, fromUserId, toId, conversationId, content, createdAt, attachment }` with the 10-key attachment. State and tombstone keys are unchanged.

**Limits**

| Constant (module) | Value |
|---|---|
| `MEDIA_MAX_UPLOAD_BYTES` (message-media) | 3 × 1024 × 1024, server hard cap for all types |
| `MEDIA_STILL_TARGET_BYTES` | 1024 × 1024 |
| `MEDIA_STILL_MAX_EDGE`, `MEDIA_STILL_FALLBACK_EDGE` | 1600, 1280 px |
| `MEDIA_MAX_DIMENSION` | 4096 px per side (16.7 MP, under the provider's 25 MP) |
| `MEDIA_MAX_INPUT_BYTES`, `MEDIA_MAX_INPUT_PIXELS` | 25 MiB, 50,000,000 — both checked from the file header before any browser decode |
| `MEDIA_HEADER_SCAN_BYTES` | 1024 × 1024 |
| `MEDIA_DAILY_UPLOAD_LIMIT` | 20 new reservations per account per UTC day |
| `MEDIA_RESERVATION_TTL_MS` (media-server) | 60000 |
| `MEDIA_PROVIDER_TIMEOUT_MS` | 8000 |
| `MEDIA_BODY_READ_TIMEOUT_MS` | 25000 |
| `MEDIA_MAX_ATTEMPTS` | 3 |
| `MEDIA_CLIENT_UPLOAD_TIMEOUT_MS` (media-client) | 45000, one total deadline per upload call |

## Cost and provider limits

Facts the primary verified from official pages during review (the planner did not fetch them):
- Cloudinary Free: no card; 25 shared monthly credits; max image file 10 MB; max image 25 MP; max 50 MP across all frames of a multi-frame image.
- **Every original upload counts as one transformation**, even with no manipulation requested. So each upload that reaches the provider costs one transformation, plus storage while the object exists, plus delivery bandwidth for each view not served from a cache.
- Cloudinary's limits are **soft**: on exceeding them the owner is asked to upgrade. There is no promised hard stop or automatic shutdown.
- Vercel documents a 4.5 MB request-body limit for functions. A 3 MiB raw body fits. The actual deployment was not inspected.

What this plan does and does not claim:
- **What the feature does.** It adds no billing account, payment method or paid add-on anywhere, and contains nothing that can enable one.
- **The Cloudinary boundary.** A Cloudinary Free account with no payment method, with the owner declining every upgrade, is intended to keep Cloudinary charges at zero. That is a statement about Cloudinary only.
- **What is not claimed.** The app's existing hosting and Firebase accounts, their quotas and their billing settings were not inspected and are not changed by this plan. Uploads pass through the app host and add Firestore reads and writes (counts under Risk review), so they draw on those existing accounts. This plan does not promise zero charges across accounts it has not seen.
- **The free allowance is not a guarantee of service.** Repeated delivery, traffic through the app host, failed attempts and abandoned objects all consume resources. If Cloudinary asks for an upgrade, the owner declines and turns uploads off (remove one environment variable); whether already-uploaded images keep being served is not known.
- **The upload guard is a loop guard, not a budget.** Its worst case is 6 accounts × 20 reservations × 3 attempts × 3 MiB ≈ 1 GiB and 360 transformations per day, which can exhaust 25 shared credits within weeks. Expected use by six people is a small fraction of that, but the guard does not bound it.
- The 50 MP multi-frame limit is not pre-checked. A GIF over it is rejected by the provider and the user sees a rejection message.

## Proposed changes

### Create — application code (5 files)

#### C1. `src/lib/message-media.js` — pure, **no Firebase SDK**, no imports; shared by client and server.

Exports:
- The message-media constants above, `MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif']` and `MEDIA_FORMATS = ['jpg', 'png', 'gif']`.
- `isUuid(value): boolean` — same pattern as the send route's `UUID_V4_REGEX`.
- `sniffImage(bytes: Uint8Array): { mimeType, format, width, height } | null` — a bounded **header parser, not a validator**:
  - PNG: 8-byte signature, `IHDR` at offset 12, big-endian u32 width/height at 16/20.
  - GIF: `GIF87a` or `GIF89a`, little-endian u16 width/height at 6/8.
  - JPEG: starts `FF D8 FF`; walk segments; the first SOF marker (`C0–CF` except `C4`, `C8`, `CC`) gives big-endian u16 height/width at segment offset +5/+7; stop at SOS or end of data.
  - `null` for anything else, for a zero dimension, or when the data ends first. Never reads past `bytes.length`.
- `fitWithin(width, height, maxEdge): { width, height }` — never upscales; rounds; minimum 1.
- `isRenderableAttachment(value): boolean` — a non-null object whose 10 fields all satisfy the shape above.
- `toPublicAttachment(value): object | null` — a copy of exactly the 10 keys when renderable, else `null`.
- `getAttachmentUrl(attachment): string | null` — `https://res.cloudinary.com/${cloudName}/image/upload/v${version}/${publicId}.${format}` when renderable, else `null`.
- `getMessagePreviewText(message): string` — `content` when it is a string, else `''`; with an `attachment` object: `'📷 ' + content` when `content.trim()` is non-empty, else `'📷 GIF'` for format `gif`, else `'📷 Photo'`.

#### C2. `src/lib/media-server.js` — server-only, **no Firebase SDK import**. Uses `process.env`, `node:crypto`, global `fetch`/`FormData`/`Blob`. Imports only `@/lib/message-media`. Never imported by components, hooks or client libs.

Exports:
- `MEDIA_UPLOADS_COLLECTION = 'mediaUploads'` and the four media-server constants.
- `class MediaError extends Error` — `constructor(status, code, message)`; fields `status`, `code`, `isMediaError = true`.
- `getMediaConfig(env = process.env): { cloudName, apiKey, apiSecret, apiBase, sandbox } | null`
  - `null` unless `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` are all non-empty after trim and the cloud name matches the attachment regex.
  - `apiBase` is `'https://api.cloudinary.com'`, replaced by `MEDIA_UPLOAD_API_BASE` only when `env.NODE_ENV !== 'production'` **and** the value matches `^http://(127\.0\.0\.1|localhost):\d+$`. `sandbox` is `true` exactly then.
- `sha256Hex(bytes): string`.
- `readBodyWithLimit(request, { maxBytes, timeoutMs }): Promise<Uint8Array>`
  - A numeric `content-length` above `maxBytes` → `MediaError(413, 'MEDIA_TOO_LARGE')` without reading.
  - One deadline timer for the whole read. Each `reader.read()` is raced against it.
  - Deadline first → call `reader.cancel()` once (errors ignored, not awaited) and throw `MediaError(408, 'UPLOAD_TIMEOUT')`.
  - Running total above `maxBytes` → `reader.cancel()` once and throw the 413.
  - No body or zero bytes → `MediaError(400, 'EMPTY_BODY')`.
  - The timer is cleared in `finally` on every path.
- `buildPublicId(year, mediaId)` → `` `ss-${year}-${mediaId}` ``; `quotaKeyFor(authUid, date = new Date())`.
- `uploadImageToProvider({ config, bytes, mimeType, publicId, fetchImpl = fetch, timeoutMs = MEDIA_PROVIDER_TIMEOUT_MS }): Promise<{ version, width, height, bytes }>`
  - `POST ${config.apiBase}/v1_1/${config.cloudName}/image/upload`; header `Authorization: Basic base64(apiKey:apiSecret)`; `cache: 'no-store'`.
  - `FormData`: `file` = `new Blob([bytes], { type: mimeType })` with the fixed filename `'upload'`; `public_id`; `overwrite` = `'false'`; `allowed_formats` = `'jpg,png,gif'`. No tags, context, folder or transformation.
  - One `AbortController` and one timer cover the request **and** reading the response body; the timer is cleared in `finally`.
  - Success: HTTP 200 and a JSON object with `public_id === publicId`, `resource_type === 'image'`, `type === 'upload'`, `format` equal to the format for `mimeType`, `version` a positive safe integer, `width`/`height` integers in 1..`MEDIA_MAX_DIMENSION`, `bytes` an integer in 1..`MEDIA_MAX_UPLOAD_BYTES`. Returns those four values. Unknown fields ignored; `url`/`secure_url` never read.
  - Provider HTTP 400 → `MediaError(422, 'MEDIA_REJECTED')`. Everything else → `MediaError(502, 'MEDIA_UPLOAD_FAILED')`.
  - Logging: exactly `console.error('Media provider upload failed', { code, status })`, with `code` one of `PROVIDER_TIMEOUT`, `PROVIDER_NETWORK`, `PROVIDER_HTTP`, `PROVIDER_INVALID_RESPONSE` and `status` the HTTP status or `null`. Never provider text, headers, credentials, config or bytes.
- `recordToAttachment(record): object | null` — maps `mediaId → id`, returns `toPublicAttachment(...)`.
- `getAttachmentBindingError(record, expected): null | 'ATTACHMENT_NOT_FOUND' | 'ATTACHMENT_MISMATCH' | 'ATTACHMENT_NOT_READY'` — `expected = { mediaId, authUid, fromId, toId, conversationId, year, epoch }`. No record → `NOT_FOUND`; any of the seven differing → `MISMATCH`; `status !== 'uploaded'` or `recordToAttachment(record) === null` → `NOT_READY`.

#### C3. `src/app/api/messages/media/route.js` — **Admin SDK** (`import { auth as adminAuth, firestore } from '@/lib/firebase'`).

Other imports: `NextResponse`; `v4 as uuidv4` from `uuid`; `verifyRequestToken`, `assertAdmissibleToken`, `runFencedTransaction`, `admissionErrorResponse` from `@/lib/participant-admission`; `resolveAuthorizedConversationId` from `@/lib/message-utils`; `yearCollectionPath` from `@/lib/year-paths`; needed names from `@/lib/message-media` and `@/lib/media-server`. Also `export const dynamic = 'force-dynamic'`. Error bodies are `{ error, code }`.

**`GET`** — capability probe: `verifyRequestToken`, `assertAdmissibleToken`, then `{ enabled, sandbox }`. `enabled` is true only when `adminAuth`, `firestore` and `getMediaConfig()` are all present. No Firestore read.

**`POST`** — upload. Request: `Authorization: Bearer`; `Content-Type` in `MEDIA_MIME_TYPES`; `X-Media-To-Id` and `X-Media-Sender-User-Id` (`^[A-Za-z0-9_-]{1,128}$`); `X-Media-Conversation-Id` (`^[A-Za-z0-9_-]{1,300}$`); `X-Media-Client-Message-Id` (UUID); raw bytes as body.

**Reservation check (one private function, used by steps 9 and 10).** Given the re-read record and a callback context `{ uid, user, year, epoch }`, the attempt is still held only when **all** of these hold:
- the record exists;
- `authUid === uid` and `fromId === user.id`;
- the record's `year` and `epoch` equal the callback's `year` and `epoch`, **and** equal the `year` and `epoch` returned by the reservation in step 7;
- `mediaId` is this attempt's and `sha256` matches;
- status is `reserved`.

Order of work:
1. `adminAuth`/`firestore` missing → 503. No config → 503 `MEDIA_DISABLED`. No body read.
2. `verifyRequestToken`, then `assertAdmissibleToken`. No body read on failure.
3. Header validation → 400 `INVALID_REQUEST`; unlisted content type → 415 `UNSUPPORTED_MEDIA_TYPE`.
4. `readBodyWithLimit(request, { maxBytes: MEDIA_MAX_UPLOAD_BYTES, timeoutMs: MEDIA_BODY_READ_TIMEOUT_MS })`.
5. `sniffImage(bytes)`: `null` or a type different from the declared one → 415; a side above `MEDIA_MAX_DIMENSION` → 400 `MEDIA_DIMENSIONS`.
6. Before any transaction: `sha256 = sha256Hex(bytes)` and `mediaId = uuidv4()`. `publicId` is built inside the callback from `year` and this fixed `mediaId`.
7. **Reservation** — `runFencedTransaction(decoded, work)`, no `allowClosed`. In `work(tx, { user: sender, year, epoch, uid })`, all reads precede writes:
   - `tx.getAll(recipientRef, messageRef, mediaRef)` — recipient profile and `messages/{clientMessageId}` via `yearCollectionPath(year, …)`, and `mediaUploads/{clientMessageId}`.
   - Sender header ≠ `sender.id` → 403 `SENDER_MISMATCH`. Message exists → 409 `MESSAGE_ALREADY_SENT`. Recipient missing → 400 `Recipient not found`. `resolveAuthorizedConversationId` error → 400 with that code.
   - **Record exists.** If any of `authUid`, `fromId`, `toId`, `conversationId`, `year`, `epoch`, `sha256` differs → 409 `MEDIA_ID_CONFLICT`. Then by status: `uploaded` or `attached` → return it as existing (no write, no provider call); `reserved` younger than the TTL → 409 `UPLOAD_IN_PROGRESS`; `attempts >= MEDIA_MAX_ATTEMPTS` → 409 `UPLOAD_ATTEMPTS_EXCEEDED`; otherwise take over with `tx.set`: new `mediaId`/`publicId`, `attempts + 1`, previous `publicId` appended to `staleProviderIds`, status `reserved`.
   - **No record.** `tx.get(mediaUploads.where('quotaKey', '==', quotaKey).limit(MEDIA_DAILY_UPLOAD_LIMIT))`; a full page → 429 `MEDIA_QUOTA_EXCEEDED`. Otherwise `tx.create` with status `reserved`, `attempts: 1`, `staleProviderIds: []`, the header-parsed `format`/`width`/`height`, `bytes: bytes.length`.
   - Returns the record and `{ year, epoch }`.
8. **Provider call, outside every transaction:** `uploadImageToProvider(...)`.
9. **On provider failure — fenced failure mark.** `runFencedTransaction(decoded, work)`, no `allowClosed`. The callback re-reads the record and applies the reservation check. If it holds: `tx.update` with `status: 'failed'` and `updatedAt`. If it does not hold: write nothing and return. Any error thrown by this call is swallowed. In every case the response is the **original provider error** (422 or 502).
10. **Finalize — fenced.** `runFencedTransaction(decoded, work)`, no `allowClosed`. The callback re-reads the record and applies the reservation check. If it does not hold → `MediaError(409, 'UPLOAD_STALE')`. Otherwise `tx.update` with `status: 'uploaded'`, the provider's `version`, `width`, `height`, `bytes`, and `uploadedAt`/`updatedAt`.
11. Respond `{ success: true, attachment }`, adding `replayed: true` for the existing case.

**Lifecycle change during the provider call.**
- After Close: the fence in step 9 or 10 throws `YEAR_CLOSED`. Success path → 409 `YEAR_CLOSED`. Failure path → the provider error.
- After Close and Start: the fence may succeed in the new year, but the reservation check fails on year and epoch. Success path → 409 `UPLOAD_STALE` (or 403 if the caller is off the new roster). Failure path → the provider error.
- In all four cases the old record is **not updated** and stays `reserved` as a tracked orphan; no attachment is returned; no message, no new `mediaUploads` document and no year-collection write occurs. The only possible write is the standard `authIdentities` admission that `runFencedTransaction` performs for any authenticated roster member in the new year, as the send route does today (accepted in review).

Error mapping mirrors the send route: typed errors and `MediaError` → their status; `admissionErrorResponse`; otherwise 500 `{ error: 'Failed to upload image', code: 'INTERNAL' }`. Provider text is never returned.

#### C4. `src/lib/media-client.js` — client module (`'use client'`), **Client SDK** via `import { clientAuth } from '@/lib/firebase-client'`; also imports `getWritableScope` from `@/lib/year-client` and names from `@/lib/message-media`.

Exports:
- `MEDIA_CLIENT_UPLOAD_TIMEOUT_MS = 45000`.
- `class MediaClientError extends Error`
  - `constructor(code = 'UPLOAD_FAILED', status = null, message = null)`
  - `super(message || code)`; `this.name = 'MediaClientError'`; `this.code = code`; `this.status = status` (HTTP status number or `null`); `this.isMediaClientError = true`.
- `describeMediaError(error): string` — reads `error?.code`; fixed strings:
  - `MEDIA_DISABLED`, `MEDIA_TOO_LARGE`, `MEDIA_DIMENSIONS`, `MEDIA_ENCODE_FAILED`, `MEDIA_QUOTA_EXCEEDED`, `UPLOAD_IN_PROGRESS`, `OFFLINE`;
  - `UNSUPPORTED_MEDIA_TYPE`: "That image type isn't supported. Use JPEG, PNG or GIF.";
  - `MEDIA_REJECTED`: "The image host rejected this file. It may be damaged or, for a GIF, too long.";
  - `UPLOAD_TIMEOUT`: "The upload took too long. Check your connection and press Send to try again.";
  - `YEAR_CLOSED`: the error's own message;
  - anything else, including a non-`MediaClientError`: "Couldn't upload the image. Check your connection and try again."
- `captureMediaSession({ ownerUid, fromUserId }): { scope, ownerUid } | null` — synchronous. `null` unless both ids are truthy, `scope = getWritableScope()` is non-null, `scope.key.startsWith(`${ownerUid}|${fromUserId}|`)`, and `clientAuth?.currentUser?.uid === ownerUid`.
- `isMediaSessionCurrent(session): boolean` — `getWritableScope() === session.scope` (object identity) and `clientAuth?.currentUser?.uid === session.ownerUid`.
- `getMediaStatus({ ownerUid, fetchImpl = fetch }): Promise<boolean>` — `false` with no request unless `ownerUid` is truthy and equals the current uid. After the token await and after the fetch await, a uid change resolves `false` and caches nothing. `true` only when `response.ok` and `enabled === true`. Never throws. Successes cached per uid in a module `Map`.
- `resetMediaStatusCache()` — tests.
- `prepareImageForUpload(file, deps = {}): Promise<{ blob, mimeType, width, height, bytes }>`
  - `deps.loadImage(blob)` resolves a drawable with `naturalWidth`/`naturalHeight`; the default creates an object URL and an `Image`, awaits decode, and revokes the URL in `finally`. `deps.createCanvas(width, height)` defaults to a DOM canvas.
  - **Preflight, before any object URL or `Image`:** `file.type` must be in `MEDIA_MIME_TYPES`; `file.size ≤ MEDIA_MAX_INPUT_BYTES`; `sniffImage` on the first `MEDIA_HEADER_SCAN_BYTES` must return a type equal to `file.type`; each side ≤ 16384 and `width × height ≤ MEDIA_MAX_INPUT_PIXELS`. Failures → `UNSUPPORTED_MEDIA_TYPE`, `MEDIA_TOO_LARGE` or `MEDIA_DIMENSIONS`.
  - **GIF:** `file.size ≤ MEDIA_MAX_UPLOAD_BYTES` and each side ≤ `MEDIA_MAX_DIMENSION`, else `MEDIA_TOO_LARGE`/`MEDIA_DIMENSIONS`. Returns `file.slice(0, file.size, 'image/gif')` — never decoded or re-encoded.
  - **Still:** `loadImage`; reject zero size or more than `MEDIA_MAX_INPUT_PIXELS` after decode. Then try in order, accepting the first step whose blob is non-null, has exactly the requested type, and is ≤ `MEDIA_STILL_TARGET_BYTES`:
    1. only when the source is PNG: canvas at `fitWithin(…, 1600)`, no fill, `toBlob('image/png')` (keeps alpha);
    2. canvas at 1600, white fill, `toBlob('image/jpeg', 0.82)`;
    3. canvas at 1280, white fill, `toBlob('image/jpeg', 0.7)`.
  - No step accepted: `MEDIA_TOO_LARGE` if any step produced a correctly typed blob, else `MEDIA_ENCODE_FAILED`. A PNG that falls through to JPEG loses transparency onto white.
- `uploadMessageMedia({ session, fromUserId, toId, conversationId, clientMessageId, blob, mimeType, signal = null, fetchImpl = fetch, timeoutMs = MEDIA_CLIENT_UPLOAD_TIMEOUT_MS }): Promise<attachment>`
  - **One stop mechanism for the whole call.** On entry create one internal `AbortController` (its signal is the only one passed to `fetchImpl`), one timer of `timeoutMs`, and one promise `stopped` that never resolves.
    - Timer fires → reject `stopped` with `MediaClientError('UPLOAD_TIMEOUT')`, then abort the internal controller.
    - The caller's `signal` aborts, or is already aborted on entry → reject `stopped` with `MediaClientError('UPLOAD_CANCELLED')`, then abort the internal controller. Exactly one `abort` listener is added for this.
    - The first trigger wins; later triggers do nothing. The deadline is total and is never restarted between steps.
  - **Every asynchronous step is awaited as `Promise.race([step, stopped])`:** `getIdToken(false)`, the fetch, reading its body, and on a 401 `getIdToken(true)`, the retry fetch and reading its body. Each raw step promise also gets a no-op rejection handler.
  - Consequences: the call settles at the deadline even when a token request, fetch or body read never resolves; and once stopped, control has left the function, so a step that completes late has no continuation — it cannot start a fetch, read a body or return a result.
  - **Session checks.** `MediaClientError('SESSION_CHANGED')` whenever `isMediaSessionCurrent(session)` is false: on entry and after each of the six steps above. No request is started after a failed check.
  - Tokens come from the `clientAuth.currentUser` captured on entry. One 401 refresh and retry at most.
  - Non-2xx → `MediaClientError(body.code || 'UPLOAD_FAILED', response.status, body.error || null)`. A 2xx body whose `attachment` fails `isRenderableAttachment` → `MediaClientError('INVALID_RESPONSE', response.status)`. Any other thrown error that is not a `MediaClientError` → `MediaClientError('UPLOAD_FAILED')`.
  - **Cleanup in `finally` on every path:** clear the timer and remove the `abort` listener.

#### C5. `src/components/MessageAttachment.js` — client component, **no Firebase**. Imports `getAttachmentUrl` from `@/lib/message-media`.

`export default function MessageAttachment({ attachment, maxHeight = 320 })` renders `<img data-testid="message-attachment">` with `src` from `getAttachmentUrl`; `alt` `'GIF'` or `'Image'`; `width`/`height` attributes and CSS `aspectRatio`; `loading="lazy"`, `decoding="async"`, `referrerPolicy="no-referrer"`; style `maxWidth: '100%'`, `height: 'auto'`, `maxHeight`, `objectFit: 'contain'`, `borderRadius: 8`, `display: 'block'`. When the URL is `null` or the image errors: `<span data-testid="message-attachment-unavailable">Image unavailable</span>`. Plain `<img>` with an `eslint-disable-next-line @next/next/no-img-element` comment.

### Modify — application code (8 files)

#### M1. `src/app/api/messages/send/route.js` — Admin SDK (unchanged).

- Import `MEDIA_UPLOADS_COLLECTION`, `getAttachmentBindingError`, `recordToAttachment` from `@/lib/media-server`.
- Parse: `body.attachment` is present when neither `undefined` nor `null`; `attachmentId` is its trimmed string `id`, else `''`. Present but not `isUUIDLike(attachmentId)` → 400 `{ error: 'Invalid attachment', code: 'ATTACHMENT_INVALID' }`. `!content && !attachmentId` → the existing 400 `Message cannot be empty`. `attachmentId && !clientMessageId` → 400 `ATTACHMENT_INVALID`.
- `work` also destructures `uid`, `epoch`. Refs are `[recipientRef, messageRef]` plus the `mediaUploads/{messageId}` ref **only when `attachmentId` is set**; text sends keep today's two-document `tx.getAll`.
- The replay check passes `attachmentId: attachmentId || null` to `matchesStoredMessage`.
- After the conversation resolves and when `attachmentId` is set: `getAttachmentBindingError(record, { mediaId: attachmentId, authUid: uid, fromId: sender.id, toId, conversationId: resolved.conversationId, year, epoch })`; non-null → `SendRouteError(400, { error: 'Attachment is not available for this message', code })`.
- The message gains `...(attachment ? { attachment } : {})`. After `tx.create`, when attached: `tx.update(mediaRef, { status: 'attached', attachedAt: message.timestamp, updatedAt: message.timestamp })`.
- Retry loop, push, response shape and error mapping unchanged.

#### M2. `src/lib/message-utils.js` — pure.

`matchesStoredMessage` only: add before the conversation comparison `if (nullable(existing.attachment?.id) !== nullable(request.attachmentId)) return false;` and update its JSDoc. Every other function stays byte-for-byte unchanged.

#### M3. `src/lib/message-outbox.js` — client, Client SDK (unchanged). Add `import { isRenderableAttachment, toPublicAttachment, isUuid } from '@/lib/message-media'`.

- Export `OUTBOX_MEDIA_ITEM_PREFIX = 'secret-santa-message-outbox-v2:media-item:'`; private `mediaItemKey(id)`.
- Export `createClientMessageId()` returning the private `generateClientMessageId()`.
- Validity: text item (existing key) keeps today's rule. Media item (new key): same id/user/date checks, `content` a string that may be empty, `attachment` passing `isRenderableAttachment`.
- `readPayload(id)`: text key first, then media key. A private `listItemIds()` returns the union of both prefixes; `readLiveItems` and `clearDeliveredOrExpired` use it.
- `clearDeliveredOrExpired`: removal deletes both item keys and the state key; the orphan-state and old-tombstone checks treat an id as having a payload when either item key exists.
- `markDelivered(id)` removes both item keys. `isOutboxStorageKey` also matches the media prefix.
- `enqueueMessage({ ownerUid, fromUserId, toId, conversationId = null, content, attachment = null, clientMessageId = null })`:
  - No attachment: exactly today's behavior and stored JSON; `clientMessageId` is ignored.
  - With attachment: requires `isUuid(clientMessageId)` and non-null `toPublicAttachment(attachment)`, else throws `Invalid outbox enqueue payload`; `content` may be empty; if a tombstone or either item key exists for the id, writes nothing and returns `readLiveItem(id)`; otherwise one `setItem` on the media key (may throw on quota, as today).
- `sendOutboxItem`: body gains `attachment: { id: item.attachment.id }` only when present.
- Header comment updated. Drain, retry, cancel and legacy import untouched.

#### M4. `src/components/Chat.js` — client component; still imports no Firebase module.

New imports: `MessageAttachment`; `getMediaStatus`, `captureMediaSession`, `isMediaSessionCurrent`, `prepareImageForUpload`, `uploadMessageMedia`, `describeMediaError` from `@/lib/media-client`; `createClientMessageId` added to the `@/lib/message-outbox` import.

**State**
- `mediaStatus: { uid: string | null, enabled: boolean }`, initial `{ uid: null, enabled: false }`. Derived: `mediaEnabled = !!authUid && mediaStatus.uid === authUid && mediaStatus.enabled`. A result for another uid is therefore never applied, and a uid change hides the controls without an effect.
- `draftMedia`, one of:
  - `null`
  - `{ phase: 'preparing', clientMessageId }`
  - `{ phase: 'ready' | 'uploading' | 'error', clientMessageId, blob, mimeType, previewUrl, uploaded: attachment | null, errorText: string | null }`
- Refs: `draftMediaRef`, `uploadTokenRef`, `uploadAbortRef`, `sendingMediaRef`, `mountedRef`, `fileInputRef`. Read and written only in handlers and effects. `mountedRef` is set `true` in an effect and `false` in its cleanup.

**Capability effect** (deps `[authUid]`): `getMediaStatus({ ownerUid: authUid })`; only when it resolves `true` and the effect is still active, `setMediaStatus({ uid: authUid, enabled: true })`.

**`attachFile(file)`** (paste and file input):
- Ignored with a toast while `phase === 'uploading'`.
- Replaces any draft, revoking its object URL; sets `{ phase: 'preparing', clientMessageId: createClientMessageId() }`; awaits `prepareImageForUpload`.
- After the await, the result is applied only if the component is mounted and the current draft is still `preparing` with the same `clientMessageId`. Otherwise it is discarded and **no object URL is created for it**.
- Applied success → `phase: 'ready'`, `previewUrl = URL.createObjectURL(blob)`, `uploaded: null`. Applied failure → draft cleared and `describeMediaError` toasted.

**Paste:** does nothing when `!mediaEnabled`. Otherwise the first file in `event.clipboardData.files` whose type starts with `image/` → `preventDefault()` and `attachFile`. Text pastes untouched.

**`removeDraftMedia()`:** increments `uploadTokenRef` **first**, then aborts `uploadAbortRef`, clears `sendingMediaRef`, revokes the URL, sets the draft to `null`. Available in every phase.

**`sendMessage`** — with no draft, the existing path runs unchanged. With a draft:
1. Return if `sendingMediaRef.current` or `phase === 'preparing'`.
2. `session = captureMediaSession({ ownerUid: authUid, fromUserId: currentUser.id })`. If `session` is `null`, or `otherUser.id` or `conversationId` is missing → the existing queue-failure toast; return.
3. If `draft.uploaded` is `null` and `navigator.onLine === false` → toast `OFFLINE`; return.
4. Capture `{ ownerUid, fromUserId, toId, conversationId, content, clientMessageId }` and `token = ++uploadTokenRef.current`; set `sendingMediaRef`.
5. `attachment = draft.uploaded`. If `null`: set `phase: 'uploading'`, store a new `AbortController` in `uploadAbortRef`, and `await uploadMessageMedia({ session, …, signal })`.
6. **Stale checks, in this order, before any effect:** token stale → return. `!isMediaSessionCurrent(session)` → enqueue nothing, drain nothing, toast nothing; apply the own-draft rule below; return.
7. `enqueueMessage({ ...captured, attachment })`. If it throws: when mounted, set `phase: 'error'`, `uploaded: attachment`, `errorText: "Couldn't queue the message on this device. Press Send to try again."`; toast the same text; return. The next Send skips the upload and retries the enqueue with the same id.
8. `drainOutboxForUser(...)`. Only if mounted: clear the draft, clear the text, scroll to bottom.
9. **On upload error, in this order:**
   - Token stale → return. This is the **only** way a user cancellation is ignored: Remove always invalidates the token before aborting.
   - `error.code === 'SESSION_CHANGED'` or `!isMediaSessionCurrent(session)` → no toast; apply the own-draft rule; return.
   - `MESSAGE_ALREADY_SENT` → clear the draft if mounted; return.
   - **Every other error** — including `UPLOAD_TIMEOUT`, an unexpected `UPLOAD_CANCELLED` and any non-`MediaClientError` — is a visible, retryable failure: if mounted, `phase: 'error'` with `errorText: 'Upload failed. Press Send to try again.'`; toast `describeMediaError(error)`.
10. `finally`: clear `sendingMediaRef` when the token is still current.

**Own-draft rule (steps 6 and 9).** After a stale-session result, if this instance is still mounted and its token is current, it clears its own draft silently. No other Chat instance is ever touched: every setter is guarded by this instance's `mountedRef`.

**No stuck upload.** Every exit from step 5 either finds the token stale (the draft was already removed or replaced), clears the draft, or sets a phase other than `uploading`. Because `uploadMessageMedia` always settles within its deadline, the composer cannot stay disabled.

**Unmount:** revokes the preview URL. Does not abort an in-flight upload or change the token, so a Send already pressed completes into its original conversation after an ordinary tab switch — subject to step 6.

**Composer markup**
- When `mediaEnabled`: a button `aria-label="Attach image"` (📎) inside the input wrapper at `right: '40px'`, input `paddingRight: '80px'`; a hidden `<input type="file" accept="image/jpeg,image/png,image/gif" data-testid="composer-file-input">`, reset after each selection.
- When a draft exists: a strip `data-testid="composer-attachment"` above the input row with a thumbnail `<img alt="Attachment preview">` (ready, uploading, error phases only; max 96 px; eslint-disable comment), a status `data-testid="composer-attachment-status"` (`Preparing…`, empty when ready, `Uploading…`, or `errorText`), a button `aria-label="Remove image"`, and the notice `Images are stored at an unlisted link. Anyone who has the link can open it.`
- While uploading: text input, attach button and Send are disabled. Send is also disabled while preparing.
- No new control's accessible name contains "send", "santa" or "recipient".

**Bubbles**
- Delivered: `<MessageAttachment>` above the text when `msg.attachment` is an object; the existing `ReactMarkdown` block only when `msg.content` is non-empty; markdown configuration unchanged.
- Pending and failed: `<MessageAttachment>` above the existing plain-text content; status line and Retry unchanged.

#### M5. `src/components/PublicFeed.js` — client.
Import `MessageAttachment` and `getMessagePreviewText`. Thread list preview renders `getMessagePreviewText(thread.lastMessage)`. Message view renders `<MessageAttachment>` above `{msg.content}` when `msg.attachment` is an object, and the plain-text node only when content is non-empty. Grouping, routing, naming and read markers untouched.

#### M6. `src/components/ArchiveViewer.js` — client.
Same two changes; `previewOf` uses `getMessagePreviewText(latest)` and keeps the 80-character truncation.

#### M7. `src/lib/year-paths.js` — pure.
`GLOBAL_COLLECTIONS = ['authIdentities', 'participantIndex', 'pushTokens', 'mediaUploads']`. `YEAR_COLLECTIONS` unchanged.

#### M8. `scripts/lib/emulator-firestore.js` — CommonJS, Admin SDK.
Add `'mediaUploads'` to `APP_COLLECTIONS`.

### Create — tests and support (12 files)

| File | Environment | Covers |
|---|---|---|
| T0 `__tests__/helpers/synthetic-images.js` | helper | `pngHeaderBytes(w, h, opts)`, `gifHeaderBytes(w, h, opts)`, `jpegHeaderBytes(w, h, opts)` returning `Uint8Array`s built from literal byte arrays plus padding. Header-only: enough for `sniffImage`, **not decodable images**, and no test may describe them as valid. |
| T1 `__tests__/unit/message_media.test.js` | node | `sniffImage` on the three header kinds, truncation, and HTML/SVG/WebP → `null`; `fitWithin`; `isRenderableAttachment` per bad field; `toPublicAttachment` dropping extra keys including `sha256`; `getAttachmentUrl` exact output and `null` cases; `getMessagePreviewText`. |
| T2 `__tests__/lib/media_server.test.js` | node | `getMediaConfig` gates. `readBodyWithLimit` with a hand-written fake reader and fake timers: content-length pre-check; mid-stream overflow → one `cancel`, no further reads; a read that never resolves → 408 `UPLOAD_TIMEOUT` exactly at the deadline, one `cancel`; `jest.getTimerCount() === 0` after success, 413, 400 and 408. `uploadImageToProvider` with injected `fetchImpl`: URL, Basic header, form fields, filename `upload`; returns the provider's four values; HTTP 400 → `MEDIA_REJECTED`; non-200, non-JSON, each wrong field → `MEDIA_UPLOAD_FAILED`; timeout aborts the signal and clears the timer; the logged arguments are exactly `{ code, status }` and contain no provider text even when the body echoes a marker string. `sha256Hex`. `getAttachmentBindingError`. |
| T3 `__tests__/api/messages_media_api.test.js` | node | Cases below. |
| T4 `__tests__/unit/media_client.test.js` | jsdom | Cases below. |
| T5 `__tests__/unit/MessageAttachment.test.js` | jsdom | Attributes; fallback for an invalid attachment and on `error`. |
| T6 `__tests__/unit/Chat_media.test.js` | jsdom | Cases below. |
| T7 `__tests__/unit/PublicFeed_media.test.js` | jsdom | Preview labels; image with caption; media-only; text-only preview unchanged. |
| T8 `__tests__/integration/message-media.test.js` | emulator | Cases below. |
| T9 `e2e/support/synthetic-images.ts` | Playwright helper | Contract below. |
| T10 `e2e/support/fake-media-provider.ts` | Playwright helper | Contract below. |
| T11 `e2e/media-messages.spec.ts` | Playwright | Cases below. |

**T3 cases** (mocks `@/lib/firebase` with an in-memory store offering `collection().doc()` and `where().limit()`; `@/lib/participant-admission` actual plus mocked `verifyRequestToken`, `assertAdmissibleToken`, `runFencedTransaction`; global `fetch`; synthetic `CLOUDINARY_*` set and restored per test)
- 503 `MEDIA_DISABLED`, 401, 403: the body reader is never touched.
- Header validation; 415 for declared/parsed mismatch and for HTML labelled `image/png`; 413; 408; 400 dimensions.
- Happy path: record `reserved` → `uploaded`; the attachment carries the provider's `version`, `width`, `height`, `bytes`; neither response nor record-derived attachment has a `sha256` key.
- `fetch` is called only after the reservation callback has returned and never while any `runFencedTransaction` callback is running (flag set around each callback).
- `SENDER_MISMATCH`, `NOT_ASSIGNED`, `INVALID_CONVERSATION`, missing recipient, reservation `YEAR_CLOSED`: no record, no fetch.
- **Same id, same bytes:** `uploaded` record → `replayed: true`, no fetch.
- **Same id, different bytes:** (a) different length; (b) equal length and equal parsed dimensions, one byte changed → 409 `MEDIA_ID_CONFLICT`, no fetch, record unchanged — for records in `uploaded`, `failed` and stale `reserved` status.
- Fresh `reserved` → 409 `UPLOAD_IN_PROGRESS`; stale `reserved` or `failed` with the same digest → takeover, new `publicId`, old one in `staleProviderIds`; attempts cap; quota 429; binding conflict; `MESSAGE_ALREADY_SENT`.
- **Provider failure, reservation still held** → 502 (or 422), record `failed`, no provider text in the response.
- **Provider failure, failure mark must not write** — for each of: the failure-mark fence throws `YEAR_CLOSED`; the failure-mark callback runs with a different `year`; a different `epoch`; a different `user.id`; a different `uid`; a record whose `mediaId` changed; a record no longer `reserved` → the response is the same provider error and the record is byte-for-byte unchanged.
- **Finalize must not write** — the fence throws `YEAR_CLOSED` → 409, record `reserved`, no attachment in the body; the callback sees a different year, epoch, `user.id`, `uid`, `mediaId` or status → 409 `UPLOAD_STALE`, record unchanged.
- `GET` returns `enabled`/`sandbox` and performs no Firestore call.

**T4 cases**
- `MediaClientError`: defaults (`code` `'UPLOAD_FAILED'`, `status` `null`, `message` equal to the code), explicit values, `name` and `isMediaClientError`.
- `captureMediaSession`: `null` for no scope, a scope key with another profile, or a uid mismatch. `isMediaSessionCurrent`: false after `setWritableScope(null)`, after a new key, after `null` then the **same key** (new object), and after a uid change.
- `uploadMessageMedia` basics: headers and body; non-2xx maps to the body's `code`, `status` and `error`; invalid response; a thrown network error → `UPLOAD_FAILED`.
- `uploadMessageMedia` session boundaries, with the exact fetch count: session changes before the token, after the token (0 fetches), after the fetch, after the body, after the 401 refresh token (1 fetch), after the retry fetch (2 fetches) → `SESSION_CHANGED`.
- **`uploadMessageMedia` deadline, with Jest fake timers:**
  - initial `getIdToken` never resolves → rejects `UPLOAD_TIMEOUT` at exactly 45,000 ms with 0 fetches; resolving the token afterwards starts no fetch;
  - fetch never resolves → `UPLOAD_TIMEOUT`; the signal given to `fetchImpl` is aborted; resolving the fetch afterwards reads no body and starts no second fetch;
  - body read never resolves → `UPLOAD_TIMEOUT`;
  - 401, then the refresh `getIdToken(true)` never resolves → `UPLOAD_TIMEOUT` with exactly 1 fetch; resolving it afterwards starts no second fetch;
  - the deadline is total: a token that takes 30,000 ms followed by a fetch that takes 20,000 ms times out at 45,000 ms;
  - a custom `timeoutMs` is honored.
- **`uploadMessageMedia` cancellation:** caller's signal aborted during the fetch → `UPLOAD_CANCELLED`, not `UPLOAD_TIMEOUT`; signal already aborted on entry → `UPLOAD_CANCELLED` with 0 token requests and 0 fetches; cancel then timer → still `UPLOAD_CANCELLED`.
- **Cleanup:** after success, HTTP error, session change, timeout and cancellation, `jest.getTimerCount() === 0` and the `abort` listener has been removed (asserted with a signal whose `addEventListener`/`removeEventListener` are spied); no unhandled rejection is reported when a step rejects after the stop.
- `getMediaStatus`: no request without a matching uid; caching; uid change during the token or fetch await → `false`, not cached; never throws.
- `prepareImageForUpload` preflight with duck-typed files from T0: wrong `file.type`, unknown signature, type/signature mismatch, header pixels over the limit, oversize bytes → rejected **with `loadImage` and `URL.createObjectURL` never called**.
- GIF branch: same bytes returned; `loadImage` never called; too large; dimensions.
- Still branch via injected `loadImage`/`createCanvas` fakes (control flow only; JSDOM cannot decode): small PNG stays `image/png` with no white fill; oversized PNG falls to JPEG at 1600; oversized first JPEG falls to 1280 at 0.7; all oversized → `MEDIA_TOO_LARGE`; `toBlob` yielding `null` or a wrong type at every step → `MEDIA_ENCODE_FAILED`; a `null` first step then a valid second step succeeds; JPEG source never attempts PNG and outputs `image/jpeg`; post-decode pixel limit enforced; output dimensions equal the accepted canvas.

**T6 cases** (mocks `uploadMessageMedia`, `prepareImageForUpload`, `getMediaStatus` and `@/lib/message-outbox`; uses the real `MediaClientError`, `describeMediaError`, `captureMediaSession`, `isMediaSessionCurrent`, the real `setWritableScope`, a mutable mocked `clientAuth.currentUser`; stubs `URL.createObjectURL`/`revokeObjectURL`)
- Disabled: no Attach button; an image paste is not intercepted.
- Capability: enabled for uid A; re-render with uid B hides the control immediately; a late `true` for uid A is ignored.
- Paste → preview and notice; Remove → cleared, URL revoked, no upload ever.
- While `preparing`, the draft has no `blob`/`previewUrl` and no thumbnail renders.
- **Old prepare result cannot replace a new draft:** paste A (deferred), paste B (deferred), resolve B then A → B's preview shown; `createObjectURL` called once.
- Captioned and media-only sends: one upload, then `enqueueMessage` with the captured routing, same `clientMessageId` and attachment; composer cleared.
- Double submit → one upload. Upload failure → nothing enqueued, text and preview kept, retry reuses the same `clientMessageId`.
- **Timeout is visible and retryable:** the upload rejects with `new MediaClientError('UPLOAD_TIMEOUT')` → status shows `Upload failed. Press Send to try again.`; the text input, attach button and Send are enabled; the timeout toast is shown; nothing enqueued. Send again → the upload resolves → `enqueueMessage` once with the same `clientMessageId`; composer cleared.
- **Timeout end to end:** one case swaps in the real `uploadMessageMedia` with a `fetch` that never resolves and Jest fake timers; advancing 45,000 ms re-enables the composer and shows the error, with nothing enqueued.
- **Cancellation is ignored only through the token:** Remove during upload, then the upload rejects with `UPLOAD_CANCELLED` → no toast, no enqueue, draft stays cleared. An `UPLOAD_CANCELLED` rejection while the token is still current → treated as a visible retryable failure (controls enabled).
- **Late completion, allowed:** upload pending → `ChatTabs` switches to the other tab (scope unchanged) → resolve → `enqueueMessage` once with the **original** conversation's ids, drain called, the other tab's input and draft untouched, no React warning.
- **Late completion, rejected** — for each of: Remove; `setWritableScope(null)` (Close); a new scope key (Start); a different `clientAuth.currentUser.uid` with a new scope (account switch); `setWritableScope(null)` then the same key again (same-uid sign-out/in) → on resolve **and** on reject: no `enqueueMessage`, no `drainOutboxForUser`, no toast.
- **Queue failure:** `enqueueMessage` throws once → draft kept in `error` with the queue text; second Send → `uploadMessageMedia` total call count is 1 and `enqueueMessage` is called with the same `clientMessageId` and attachment.
- Offline → no upload; a text-only send while offline still enqueues.
- Pending and failed outbox items with an attachment render the image; a delivered media-only message renders the image and no empty markdown node; a draft attachment does not survive a tab switch.

**T8 cases** (real routes on the Firestore emulator; synthetic rosters from `helpers/emulator-admin.js`; provider is `jest.spyOn(global, 'fetch')` answering from the submitted `FormData`; every provider call resolves or rejects from the spy)
1. Upload then send: message carries the server-built attachment; record `attached`.
2. Send replay → `replayed`, one message. Upload after send → 409. Provider called once.
3. Same id and bytes before send → same attachment, provider called once. Same id, different bytes of equal length → 409 `MEDIA_ID_CONFLICT`, provider not called again.
4. Not assigned or wrong conversation → 400; no record; provider not called.
5. A send whose attachment is bound to another sender or conversation → 400; no message.
6. Closed year: upload → 409 with nothing written; a record uploaded before Close cannot be sent after Close.
7. After Start 2026: a 2025 record cannot be attached; the 2025 snapshot is unchanged.
8. Provider failure then retry → takeover; `staleProviderIds` length 1. Daily quota → 429.
9. **Close during a succeeding provider call** (the spy awaits a gate; `closeYear` runs; gate opens with success): response 409 `YEAR_CLOSED`; record `reserved`; no message; lifecycle closed.
10. **Close and Start during a succeeding provider call** (`closeYear` then `startNewYear` while the gate is held): response 409 `UPLOAD_STALE`; the 2025 record is still `reserved`; a snapshot of the five `years/2026/*` collections is identical before and after the gate opens; no `mediaUploads` document has year 2026; no message anywhere.
11. **Close and Start during a failing provider call** (same gate; while it is held, snapshot the 2025 record and the five `years/2026/*` collections; then the gate opens with HTTP 500): the response is the provider error, 502 `MEDIA_UPLOAD_FAILED`; the 2025 record deep-equals its snapshot (still `reserved`, same `updatedAt` and `attempts`); the 2026 collections deep-equal their snapshot; no `mediaUploads` document has year 2026; no message anywhere.
12. **Close during a failing provider call:** response 502; the record deep-equals its snapshot taken while the gate was held.
13. **Held transaction, Close vs reservation** (`interceptNextTransaction`): response is 409 `YEAR_CLOSED`; the provider was called exactly when a record exists; no message; year ends closed.
14. **Held transaction, Close vs finalize** (interceptor armed inside the provider spy so it holds the finalize): status 200 exactly when the record is `uploaded`, otherwise 409 and `reserved`; the year ends closed; a following send returns 409 and writes no message.
15. Held transaction, Close vs send-with-attachment: 200 exactly when the message exists and the record is `attached`.

**T9 `e2e/support/synthetic-images.ts`** — no dependency, no binary file.
- `encodeUncompressedLzw(indices: number[]): Buffer` for GIF minimum code size 2: emits code `4` (clear) before every two pixels, each pixel index as a literal, then code `5` (end); every code is 3 bits, packed least-significant-bit first. Reference vectors asserted in the spec: `[0,0,0,0]` → `04 08 14`; `[1,1,1,1]` → `4C 98 14`.
- `buildAnimatedGif(size = 64): Buffer` — `GIF89a`; logical screen `size × size`, packed `0x80`, background 0, aspect 0; global color table `FF 00 00`, `00 00 FF`; application extension `21 FF 0B "NETSCAPE2.0" 03 01 00 00 00`; then two frames, each: graphic control `21 F9 04 04 32 00 00 00` (500 ms), image descriptor `2C 00 00 00 00 <w LE> <h LE> 00`, `02`, the LZW bytes split into sub-blocks of at most 255 bytes, `00`; frame 1 all index 0 (red), frame 2 all index 1 (blue); trailer `3B`.
- `makeStillInPage(page, { width, height, type, quality, noisy }): Promise<Buffer>` — draws on an in-page canvas and returns the browser's own `toBlob` bytes, so PNG and JPEG inputs are real images produced by the browser under test.
- `pasteImage(page, bytes, type)` — dispatches a synthetic `paste` with a `DataTransfer` holding one `File` on the message input.

**T10 `e2e/support/fake-media-provider.ts`**
- `startFakeMediaProvider({ port }): Promise<{ uploads: Map<string, RecordedUpload>, failNext(status: number): void, close(): Promise<void> }>`; `RecordedUpload = { publicId, authorization, fileName, mimeType, bytes: Buffer, fields: Record<string, string> }`.
- `http.createServer` listening on `127.0.0.1:port` only. A listen error (including address in use) rejects with a message naming the port; it never retries, reuses or stops another listener.
- Accepts only `POST /v1_1/e2e-sandbox/image/upload`; parses the multipart body with `new Response(buffer, { headers }).formData()`; stores the upload by `public_id`; replies 200 with `{ public_id, version: 1700000000, resource_type: 'image', type: 'upload', format, width, height, bytes }` where format and dimensions come from `sniffImage` (imported from `../../src/lib/message-media`) and `bytes` is the received length. `failNext(status)` makes the next upload answer that status with `{ error: { message: 'synthetic' } }`. Other paths → 404.
- `close()` closes open connections and resolves when the server has closed.

**T11 `e2e/media-messages.spec.ts`**
- Serial describe. `beforeAll`: `provider = await startFakeMediaProvider({ port: 8791 })`; a startup failure fails the file. `afterAll`: `await provider?.close()`.
- **Guard, first in each test:** `GET /api/messages/media` with an emulator token; unless `enabled && sandbox`, `test.skip` locally and fail when `process.env.CI` is set. This prevents any upload to a real account through a reused dev server.
- **Fake CDN per browser context:** route `https://res.cloudinary.com/e2e-sandbox/image/upload/**`. Parse `publicId` from the last path segment. Found → `route.fulfill({ status: 200, contentType: upload.mimeType, headers: { 'Access-Control-Allow-Origin': '*' }, body: upload.bytes })` — the exact uploaded bytes. Not found → 404 with the same `Access-Control-Allow-Origin: *` header. Any other `*.cloudinary.com` request is aborted and counted; the count must be 0.
- Fixture self-checks: the two LZW vectors; `sniffImage(buildAnimatedGif())` is a 64 × 64 GIF.
- **Still by paste (PNG path):** a two-color 2400 × 1800 PNG → preview; Remove → zero provider uploads; paste again, caption, Send → exactly one upload: Basic header, `public_id` matching `^ss-\d{4}-<uuid>$`, filename `upload`, type `image/png`, parsed size 1600 × 1200. The emulator message carries `attachment`; image and caption are visible to the sender, to the recipient in a second context, and in the public feed with a `📷` preview.
- **Still by file input (JPEG path):** a noisy 3000 × 2000 JPEG → upload type `image/jpeg`, longest side ≤ 1600, size ≤ 1 MiB, and different bytes from the input.
- **GIF by file input, media-only:**
  - the provider's recorded bytes equal `buildAnimatedGif()` exactly; filename `upload`; message `content` is `''`;
  - the rendered image has `naturalWidth` 64 and a `src` ending `.gif`;
  - **delivered bytes:** in the page, `fetch(img.currentSrc, { mode: 'cors', credentials: 'omit', cache: 'no-store' })`, read as an `ArrayBuffer`, equals the fixture byte for byte (readable because the fake CDN sends `Access-Control-Allow-Origin: *`);
  - **animation:** take an element screenshot, then poll until a later screenshot differs (≤ 5 s). Control: two screenshots of the still PNG taken 1.5 s apart are identical.
- **Failure then retry:** `failNext(500)` → `Upload failed` shown, no message document, no outbox item; Send again → exactly one message.
- Participant names come from the source list, as in `e2e/outbox-cross-tab.spec.ts`.

### Modify — tests (6 files)

- `__tests__/api/send_message_api.test.js` — extend `useStore` with `tx.update` and optional `mediaUploads` seeding. Add: attachment happy path (captioned and media-only); a text-only send still calls `getAll` with exactly two refs and writes no `attachment` key; attachment without `clientMessageId` → 400; malformed attachment → 400; each binding mismatch (including year and epoch) and each non-`uploaded` status → 400 with no write and no push; replay with the same attachment → `replayed`; replay with a missing or different attachment → 409; the stored message has no `sha256`. Existing cases unchanged.
- `__tests__/unit/message_routing.test.js` — `matchesStoredMessage`: equal attachment ids match; missing-vs-present and differing ids are rejected.
- `__tests__/unit/message_outbox.test.js` — media enqueue writes only the media-item key, drops extra props (`previewUrl`, `blob`, `sha256`), is under 1 KB and contains no `data:` or `blob:`; requires a UUID id and valid attachment; empty caption allowed, text-only empty content still throws; repeat enqueue and tombstoned id write nothing; a `setItem` that throws propagates and leaves no key; drain body includes `attachment: { id }`; delivery removes the media key and writes the tombstone; GC removes expired and malformed media items and keeps the state of a live one; a storage event on a media key notifies subscribers; no key under `OUTBOX_ITEM_PREFIX` exists for a media item. Existing cases unchanged.
- `__tests__/unit/year_paths.test.js` — update the `GLOBAL_COLLECTIONS` expectation.
- `__tests__/unit/ArchiveViewer.test.js` — a message with an attachment renders the image and the correct preview label.
- `__tests__/integration/firestore-rules-admission.test.js` — in `server-only collections are never readable by clients`, add a denied `getDoc` and a denied `setDoc` on `mediaUploads/x`.

### Modify — configuration and documentation (4 files)

**`playwright.config.ts`** — add to `webServer` (placeholders, not secrets):

```ts
env: {
    CLOUDINARY_CLOUD_NAME: 'e2e-sandbox',
    CLOUDINARY_API_KEY: 'e2e-key',
    CLOUDINARY_API_SECRET: 'e2e-secret',
    MEDIA_UPLOAD_API_BASE: 'http://127.0.0.1:8791',
},
```

**`README.md`** — Deployment section, after the `PUSH_DISPATCH_ENABLED` paragraph, add exactly:

```markdown
**Image attachments (server, optional):** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (secret; server only, never `NEXT_PUBLIC_*`). Set all three to enable JPEG, PNG and GIF attachments; leave any unset to keep them off — text chat is unaffected. Uploaded images are served from public, unlisted Cloudinary URLs: anyone with a link can view the image. Use a Cloudinary account with no payment method and decline upgrades; its free limits are soft, so check usage in the Cloudinary console and remove a variable to stop uploads. Uploads also pass through this app's hosting and Firestore, whose own quotas and billing are unchanged. `MEDIA_UPLOAD_API_BASE` is a test-only override, honored only outside production and only for a loopback URL.
```

**`CLAUDE.md`** — seven edits:

1. Message Architecture list, after the idempotency bullet, add:
   `- An optional `attachment` (one image or GIF) is copied by the server from a server-only `mediaUploads` record; clients never supply its fields. `content` may be empty only when an attachment is present`
2. messages block: replace the `content` line's comment with `// Message body (0–4000 chars; empty only when attachment is present)` and add after `clientCreatedAt`:

```javascript
  attachment?: {              // Optional; server-written; absent on text messages
    id: string,               // UUID generated by the server
    kind: 'image',
    provider: 'cloudinary',
    cloudName: string,
    publicId: string,         // ss-{year}-{id}
    version: number,
    format: 'jpg' | 'png' | 'gif',
    width: number, height: number, bytes: number
  }
```

3. Replace the sentence beginning "Firestore rules additionally permit the **legacy** fields" with:
   `Clients cannot create, update or delete messages under the rules; the server is the only writer. Legacy 2025 rows may carry `isSantaMsg`, `fromName`, and `toName`; `/api/messages/send` never sets them.`
4. Server-written collections paragraph, append:
   `` `mediaUploads/{clientMessageId}` `{ id, mediaId, status: 'reserved'|'uploaded'|'attached'|'failed', attempts, authUid, fromId, toId, conversationId, year, epoch, quotaKey, sha256, provider, cloudName, publicId, staleProviderIds, format, width, height, bytes, version, createdAt, updatedAt, uploadedAt, attachedAt }` records every image upload. It is global (not year-scoped), unreadable by clients, and written only inside `runFencedTransaction` in the open year. ``
5. API Routes: extend the send bullet with "A request may name `attachment: { id }`; the route then copies the attachment from the `mediaUploads` record for the same `clientMessageId` after checking its account, sender, recipient, conversation, year and epoch." and add:
   `- **GET /api/messages/media**: Report `{ enabled, sandbox }` for image attachments. Requires a Bearer token from a roster account; no Firestore read.`
   `- **POST /api/messages/media**: Upload one JPEG, PNG or GIF (raw body ≤ 3 MiB; ids in `X-Media-*` headers). Requires a Bearer token; reserves and finalizes a `mediaUploads` record in fenced transactions and calls Cloudinary between them, never inside a transaction. Idempotent per `clientMessageId` and byte digest.`
6. Key Files, add:
   `- `src/lib/message-media.js`: Pure attachment shape, limits, header parser and URL builder (shared by client and server)`
   `- `src/lib/media-server.js`: Server-only media config, bounded body reader and Cloudinary upload`
   `- `src/lib/media-client.js`: Client image preparation, session-fenced upload and capability probe`
   `- `src/components/MessageAttachment.js`: Renders a message's image`
   `- `src/app/api/messages/media/route.js`: Image upload route`
7. Important Notes, add:
   `- Image attachments need `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` on the server; with any missing, the attach control is hidden and uploads return 503 while text works. Images are public-by-link: anyone with the URL can view them. Cloudinary's free limits are soft and each upload counts as a transformation; the app does not enforce a budget and does not change any hosting or Firebase billing setting.`
   `- The outbox stores media references under `secret-santa-message-outbox-v2:media-item:*` and never stores image bytes. An image is uploaded before it is queued; a late upload is queued only while the writable scope captured at Send is still current.`

**`__tests__/integration/README.md`** — add:
`- **message-media.test.js**: Image upload reservation and finalize fences, byte-digest idempotency, attachment binding on send, and Close/Start races during an upload (provider mocked; no network)`

### Delete

None.

### Explicitly unchanged

`firestore.rules`, `firestore.indexes.json`, `firebase.json`, `package.json`, `next.config.js`, `worker/index.js`, `src/lib/participant-admission.js`, `src/lib/year-client.js`, `src/lib/archive-threads.js`, `src/components/MessageOutboxRuntime.js`, `src/components/ChatTabs.js`, `src/app/page.js`, `src/context/*`, `src/hooks/*`, `src/lib/push-server.js`, `src/app/globals.css`, all `/api/dev/*` routes.

## Behavior summary

| Situation | Outcome |
|---|---|
| Upload fails (network, 5xx) | Nothing enqueued; text and preview kept; Send retries with the same id. No background upload retry. |
| Upload exceeds the 45 s client deadline, at any step | `UPLOAD_TIMEOUT`: visible error, composer re-enabled, Send retries with the same id. A server upload that finished anyway is returned as a replay on retry. |
| Upload rejected (type, size, quota, provider rejection, disabled, closed year) | Specific toast; the user can remove the image and send text alone. |
| Upload succeeded, local queue write fails | Draft kept; next Send re-queues the returned attachment under the same id with no second upload. |
| Upload succeeded, send fails or device goes offline | Normal outbox item: `Sending...`, backoff, survives reload and other tabs, Retry on permanent failure. |
| Reload or tab close during upload | Unsent image and caption lost, like an unsent draft today. A finished server upload is a tracked orphan. |
| Offline when Send is pressed with an image | Refused with a toast; composer kept. Text still queues offline. |
| Remove before Send | Nothing uploaded. |
| Remove during upload | Token invalidated, then fetch aborted; any late result or error is ignored. |
| Double-click Send | Second submit ignored; a second request that still arrives gets 409 `UPLOAD_IN_PROGRESS`. |
| Ordinary tab switch during upload | The message is still queued into its original conversation, because the captured scope and account are unchanged. |
| Close, Start, sign-out, account switch, or same-account sign-out/in during upload | The captured scope object is no longer current: nothing is queued, drained or toasted, and no other composer is touched. |
| Close or Start while the server is calling the provider | The old record is not updated (success or failure); no attachment is returned; nothing is written for the new year. |
| Same id re-sent with different bytes | 409 `MEDIA_ID_CONFLICT`; the stored upload is never returned for a different payload. |
| Function dies between provider success and finalize | Record stays `reserved`; after 60 s a retry with the same bytes takes over with a fresh `publicId`. |
| Old-build tab in the same browser | Cannot see media items. It may reset a media item's backoff state during its own cleanup, causing an earlier retry. It does not render images until reloaded. |

**Orphans.** Every provider call has a record. An orphan is a record that is not `attached` after a day, plus every id in `staleProviderIds`. They keep using storage until deleted; this plan tracks them and defers deletion (O5).

## Risk review (CLAUDE.md risk areas)

- **Message routing.** No routing function changes. `matchesStoredMessage` gains one comparison that is a no-op for text. `PublicFeed` and `ArchiveViewer` change only what a row renders. `__tests__/unit/PublicFeed_grouping.test.js` is in Verification.
- **SDK separation.** `message-media.js`: none. `media-server.js`: none, server-only. Media and send routes: Admin SDK. `media-client.js`, `message-outbox.js`: Client SDK. Components import no server module and no Firebase module.
- **Listener reads.** No new listener and no new client read.
  - Capability probe: 0 Firestore reads.
  - Successful first upload: reservation = 3 fence reads + 3 document reads + the quota query (billed as the number of matching documents, minimum 1, at most 20) and 1 write; finalize = 3 fence reads + 1 document read and 1 write. Total 10 reads plus the quota query, and 2 writes.
  - Failed upload: the failure mark replaces finalize at the same read cost, with 1 write only when the reservation is still held.
  - Media send: today's cost plus 1 read and 1 write. Text send: unchanged.
- **Security rules.** Unchanged. `mediaUploads` falls under the catch-all deny, with a regression test. No rules or index deployment.
- **Anonymity and privacy.** Images are public-by-link (O1). Stills lose EXIF/GPS; GIF bytes are uploaded unmodified, so embedded comment or XMP blocks survive. No filename, user id or conversation id goes to Cloudinary; uploads originate from the app server; viewers' browsers contact Cloudinary's CDN with the referrer suppressed. As with text, every admitted participant can read every message, so feed images reach all six, and picture content can identify a Santa. `mediaUploads` links account to conversation but is server-only.
- **Untrusted input.** Authentication and roster check before any body read (any Google account can obtain a valid token). Body bounded by bytes and time. Header allowlist for JPEG/PNG/GIF. The header parse proves a signature and plausible dimensions, **not** a valid image; the provider's decoder is the validity check and its rejection is surfaced. Provider response validated field by field; provider URLs ignored. Rendering only through `<img>` with a URL built from validated fields on a fixed host.
- **Secrets and logs.** Secrets are read only in `media-server.js`; never logged, never `NEXT_PUBLIC_*`. Provider failures log a fixed code and HTTP status only. The test override cannot redirect credentials in production or to a non-loopback host.

**Pre-existing risk, unchanged:** `Chat.js` renders markdown image syntax, so a participant can already embed an arbitrary external image that reveals a viewer's IP to that host.

## Essential vs deferred

**Essential:** everything under Proposed changes.

**Deferred:** WebP input; searchable GIF picker; participant-only delivery; provider-side orphan deletion (needs delete-API verification and separate authorization); drag-and-drop, multiple images, lightbox, progress bar; offline upload persistence; delivery transformations; a GIF frame pre-check against the 50 MP provider limit; blocking markdown external images.

## Primary-executed steps

- No dependency installation, no generated files, no deletions or renames.
- Before emulator-backed checks, confirm ports 8080, 9099, 4000, 3000 and **8791** are free. Do not stop or reuse a listener the primary did not start; if 8791 is taken, report it.
- Run checks in a credential-free copy so no real `CLOUDINARY_*` value can be present.
- Do not commit `public/sw.js`, `public/workbox-*.js`, `public/worker-*.js`, `.claude/settings.local.json` or `docs/ui-concepts/`. Stage by explicit path.
- No Cloudinary account, credential, provider request, deployment or production read is part of implementation or verification.

**Owner configuration (after merge; separate owner action, not authorized by approving this plan)**
1. Create a Cloudinary Free account with no payment method. Do not create unsigned upload presets. Decline any upgrade.
2. Add the three variables to the host's Production environment and redeploy. Never commit them; `.gitignore` covers `.env` and `.env*.local` only.
3. Owner-authorized smoke test, **not run by this plan**: send one still and one GIF, confirm both render for a second participant, and confirm two assets named `ss-…` in the Cloudinary console. This is the first real check of the provider request and response assumptions.
4. Until step 2 the feature is invisible. To stop uploads later, remove any one variable and redeploy; existing image messages keep their links.

## Verification (primary)

Node 22.15.0, synthetic data, mocked or stub provider only.

1. **Diff review.** Only listed files changed; only `matchesStoredMessage` differs in `message-utils.js`; `firestore.rules`, `year-client.js` and `participant-admission.js` untouched; `media-server` imported only by the two routes and tests; no `firebase-client` import under `src/app/api` or in `media-server.js`; no `NEXT_PUBLIC_` Cloudinary variable; `git diff --check` clean.
2. **Focused Jest.** T1–T7 and the six modified test files pass, with these named groups present and green:
   - R1: T4 session-boundary cases; T6 late-completion allowed/rejected, old-prepare, queue-failure and capability cases.
   - R2 and R9: T3 "finalize must not write" and "failure mark must not write" cases.
   - R4: T4 preflight and still-encoding cases.
   - R5: T3 same-id/different-bytes cases.
   - R7: T2 read-deadline, timer-cleanup and log-content cases.
   - R10: T4 deadline, cancellation and cleanup cases; T6 timeout-visible-and-retryable, timeout-end-to-end and cancellation cases.
   - `PublicFeed_grouping.test.js`, `Chat_outbox.test.js`, `ChatTabs_draft_isolation.test.js`, `outbox_retry_delivery.test.js`, `message_outbox_cross_realm.test.js`, `app_flows.test.js`, `home_reveal.test.js` pass **with no edits**.
3. **`npm test`** → zero failures; report real counts against the previous 968.
4. **`npm run lint`** → exit 0, no new warnings.
5. **`npx firebase emulators:exec --project=xmasteak-app "npm run test:integration"`** → zero failures, including T8 cases 9–15 (R2, R9) and the rules addition; the provider spy shows no call left the process.
6. **`npm run build`** with `CLOUDINARY_API_SECRET=planted-marker-value` → passes; searching `.next/static` for `planted-marker-value` and `CLOUDINARY_API_SECRET` finds nothing.
7. **`npx firebase emulators:exec --project=xmasteak-app "npm run test:e2e"`** → full suite passes including T11; its guard reports `enabled && sandbox`; the stub was started and closed by the spec; the in-page delivered-bytes fetch succeeds and matches (R11); zero requests reached a real Cloudinary host.
8. **Real-browser spot check** (stub provider, synthetic accounts) at 1280 × 720 and 390 × 844: paste a real OS screenshot → preview → remove → paste → send; composer does not overflow and Send stays reachable; chat stays pinned to the bottom when an image arrives; the synthetic GIF visibly alternates red and blue in chat, feed and (after a synthetic Close) the archive; with the three variables unset there is no attach button and text send works.
9. **Report as not run:** any real Cloudinary upload or delivery (owner smoke test), real-device iOS/Android paste and photo-picker behavior, the deployed host's limits, the existing hosting and Firebase billing settings, production deployment.

## Open decisions (owner)

| # | Decision | Recommendation |
|---|---|---|
| O1 | **Public-by-link images.** Anyone who obtains a URL can view the image without signing in, for as long as it exists. The composer shows a one-line notice. | Accept for this phase. If not acceptable, do not approve this plan; participant-only delivery needs its own research and plan. |
| O2 | **Caps.** JPEG/PNG/GIF only; stills re-encoded to ≤ 1600 px and ≤ 1 MiB; GIFs ≤ 3 MiB unmodified; 20 uploads per person per day; one image per message. | Accept. |
| O3 | **Online-first.** An image that has not finished uploading is lost on reload or offline; after upload the message is as durable as text. | Accept. |
| O4 | **Ship dark.** Merge with media disabled; account creation, secrets and the smoke test are later owner steps. | Accept. |
| O5 | **Orphans tracked, not deleted** in this phase; they keep using free storage. | Accept; delete by hand in the Cloudinary console if usage matters. |
| O6 | **Free allowance is not enforced by the app.** If Cloudinary asks for an upgrade, the response is to decline and turn uploads off; existing images may or may not keep loading. Existing hosting and Firebase billing settings are outside this plan and were not inspected. | Accept, with the owner glancing at Cloudinary console usage during the season. |

## Not verified by the planner

- The deployed host: its function time limit must cover a worst case of about 35 s (25 s body read plus 8 s provider plus transactions); the 4.5 MB body limit is from the primary's check of Vercel's documentation, not from the deployment.
- The existing hosting and Firebase accounts' quotas and billing settings.
- That Cloudinary answers an over-limit or undecodable image with HTTP 400 (only the wording of the user message depends on it), and that it reports `format`, `width`, `height` and `bytes` as the validator expects. The owner smoke test is the first real check.
- Test-environment capabilities: `FormData`/`Blob` in `jest-environment-node`; `fireEvent.paste` with `clipboardData.files` in JSDOM; Playwright's `webServer.env` merging with the parent environment; a synthetic `ClipboardEvent` with a `DataTransfer` in Chromium; element-screenshot byte stability for the animation control; `route.fulfill` custom headers reaching an in-page CORS fetch.
- The hand-specified GIF bytes decode in Chromium. The primary independently confirmed the two LZW vectors are arithmetically consistent; the E2E run is the decode proof.
- Real-device behavior: iOS/Android paste, photo-picker conversion of HEIC, EXIF orientation through canvas.
- The generated service worker's cross-origin image cache rule.

## Primary execution evidence — implementation and verification COMPLETE (2026-11-12 MST)

- Owner approval recorded above. Opus launch: explicit `claude-opus-5-5` / `xhigh`; CLI init confirmed tools exactly Edit/Glob/Grep/Read/Write, restricted/dontAsk, no MCP or skills. Session `816aff2a-3cb3-4fa8-adb3-23247415d74c`. The implementer runs no commands/checks.
- Owner settings/UI concepts/generated public workers were fingerprinted and remain excluded. Initial ports 8080/9099/4000/3000/8791 were free.
- Primary created a fresh credential-free verification copy at `/tmp/secret-santa-media-verify._gx5e674` with synthetic registry/admin identities, a clean HOME, explicit loopback emulators, disabled push/telemetry, installed dependency/cache links and Node 22.15.0. A fetch guard rejects external fetches. No production credentials or `.env` files are copied.
- Initial snapshot unit/API check: **973 tests / 62 suites passed**. The snapshot includes the implementer's five new matcher tests and small collection-list edits, not the full media feature. The first run had two fixture-induced failures because name substitutions did not cover identifiers containing underscores; primary fixed only the disposable fixture transform and reran successfully. No application defect was inferred from that fixture failure.
- Primary reviewed the initial application diff (new pure/server/client helpers, upload route, send binding/idempotency, outbox compatibility and chat/feed/archive rendering). No SDK, routing or listener-scope deviation found in that snapshot.
- Application snapshot with the existing suite: **973 tests / 62 suites passed**, lint passed and production build passed. The planted secret marker and `CLOUDINARY_API_SECRET` were absent from `.next/static`.
- New media foundation checks (pure module, server helper and media API): **158 tests / 3 suites passed**. After the implementer's unit/API additions, the full available suite passed **1280 tests / 69 suites**; lint passed again. These are interim snapshots while integration/E2E support is still being written.
- Primary adversarial composer probe reproduced one bounded defect: with an image upload held, the disabled text input can still be edited via the enabled emoji picker; it changed `Caption before upload` to `Caption before upload🙂`, although the captured message caption cannot change. The temporary probe failed 1/1 as expected. Correction will be handed back to Opus within the approved Chat/composer-test files; no new feature or API contract is requested.
- Opus completed all 35 planned implementation files (primary verified **17 new + 18 modified**; its handoff's created/modified subtotal was a reporting miscount). Its implementation and correction sessions used only the allowed file tools and ran no commands.
- The bounded correction changes only `Chat.js` and `Chat_media.test.js`: Add emoji is disabled during upload, Send closes a pre-opened picker, and queued selections are guarded. Six regression cases were added. Primary's independent composer probe then passed **1/1**.
- Post-correction final unit/API suite: **1286 tests / 69 suites passed**; lint and production build passed; synthetic secret marker and `CLOUDINARY_API_SECRET` are absent from `.next/static`.
- First integration run: **160 passed / 2 failed**. One failure was a disposable-fixture admin/non-admin email collision; primary separated application fixture emails from the integration helpers' synthetic roster. The other was an unchanged admission-test emulator transaction error (`3 INVALID_ARGUMENT: Transaction is invalid or closed`). With fixture correction and metadata autodetection disabled in the isolated environment, the next complete integration run passed **162 tests / 12 suites**. No admission/auth implementation or test was changed for either failure.
- First focused media E2E attempt timed out at the default 30 s during the multi-user PNG case (1 passed, 1 failed, 3 not run). A traced diagnostic with a 90 s per-test budget passed **all 5 media cases**, including unchanged GIF bytes, CORS delivery, animation, compression and retry. No assertion or test timeout was changed in repository code.
- Final combined gate on the corrected source, with a fresh primary-owned emulator stack: **162 integration tests / 12 suites passed, then all 53 E2E tests passed with retries disabled**. Exit 0 in 215.04 s. This uses the repository's normal E2E timeout; the five media cases passed in the full gate without a timeout override.
- Approved-file scope, all 35 source fingerprints against the verification snapshot, SDK import separation and diff whitespace checks passed. All 16 fingerprinted pre-existing owner files remain unchanged. Additional browser verification is complete:
- At **1280×720 and 390×844**, real browser Clipboard API + keyboard paste produced the removable preview; Remove made no upload; image-only/captioned sends worked; preview and Send stayed in bounds with no horizontal page overflow. Eight history messages forced overflow, and sending an image kept the chat within 48 px of the bottom. GIFs visibly animated in chat, feed and the read-only archive after a synthetic Close. Screenshots were inspected. Both final spot cases passed with retries disabled, using the fake provider/CDN only.
- Two earlier spot-harness attempts produced false-negative animation assertions using repeated locator screenshots. Primary independently decoded the synthetic GIF on a secure loopback origin: exactly two frames, red and blue, 500,000 µs each, infinite repetition. A plain canvas draw reads the default GIF frame and is not an animation test. The final harness foregrounded the viewer, waited for lazy-load completion, and sampled fixed screen clips at irregular intervals to avoid repeated auto-scroll and loop aliasing. No application/source test change was made for these harness issues.
- Real-browser **ship-dark check passed 1/1** at 390×844 with all Cloudinary variables absent: capability `{ enabled: false, sandbox: false }`, no attach/file control, upload POST 503 `MEDIA_DISABLED`, text send accepted and displayed, no attachment field, zero real Cloudinary requests.
- Existing clean-admission lifecycle-listener permission errors and a late typing-delete rejection at synthetic Close were observed in unchanged auth/typing code. The lifecycle subscription recovered (Close automatically opened Archives), and the denied delete failed closed under the existing rules. These console observations are documented, not claimed absent or fixed within this media scope.
- All primary-started emulator, dev-server, fake-provider and auxiliary listeners have stopped; ports 8080/9099/4000/3000/8791/4400/4500/9150 are clear. Temporary browser probes/config live only in the disposable copy, never the repository. Owner files and approved-scope source fingerprints were rechecked.
- **Not run:** real Cloudinary upload/CDN delivery, account/billing setup or inspection, deployment, native cross-application OS-screenshot clipboard transfer, and real iOS/Android/photo-picker checks. Browser Clipboard API + keyboard paste and mobile-sized Chromium layout are verified, not real devices. No commit/push/PR was requested or performed.
