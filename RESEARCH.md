# Research: messaging images and GIFs — feasibility

## Request and scope

The owner asked how easy pasted images with composer/conversation previews and GIFs would be, with a strict no-spend constraint for six participants. This started as feasibility research. The later sections record planning, explicit owner approval and implementation; the reviewed PLAN.md is now APPROVED. Historical findings and prior research are preserved below.

**Current status (2026-11-12 MST):** Opus implemented the approved media scope; primary adversarial review and local verification are complete. Final results: 1286 unit/API tests, 162 integration tests, 53 E2E tests (no retries), lint and production build passed. Desktop/mobile-sized clipboard/layout/scroll/GIF/archive checks and the unconfigured-media/text-delivery browser check passed. No real provider, billing setup, deployment or Git publication occurred.

## Baseline repository findings (before implementation)

- src/components/Chat.js has a text input with no paste/file attachment handling. Sending rejects empty text. Delivered messages use ReactMarkdown/remarkGfm; pending messages render plain text. Markdown image syntax may already render external images, but it is not an attachment workflow or preview.
- src/app/api/messages/send/route.js requires 1–4000 characters of text and writes no attachment fields. Media-only messages require contract changes, authorization/validation and idempotency updates.
- src/lib/message-outbox.js persists text payloads in localStorage. Do not put image/base64 bytes there. Full offline media retry needs blob-capable persistence; an online-upload-first MVP is smaller but must state that limitation.
- src/components/PublicFeed.js and src/components/ArchiveViewer.js render message content as text. Media rendering needs consistency across chat, pending states, feed and closed-year archives.
- firebase.json configures Firestore/Auth emulators, not Storage. No existing media storage/upload implementation was found in the inspected paths.
- Keep conversation routing, current listener sharing and annual write fencing unchanged. Validate authenticated upload ownership, file size/type and attachment references; consider metadata/filenames that identify Santa, provider-visible data and public URL exposure. Preserve animation rather than flattening GIFs during compression.

## Current primary-source findings

- Firebase Storage requires Blaze/billing, including existing default buckets; no-cost allowances are not a hard zero-billing guarantee. https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- Cloudinary Image/Video API Free is $0, no credit card, with 25 shared monthly credits. One credit represents 1 GB storage OR 1 GB image bandwidth OR 1,000 transformations; these draw from one pool, not independent allowances. Its three dashboard users are not the app's participant count. A promising no-card option for small compressed attachments; delivery privacy/access controls still require design verification before implementation. https://cloudinary.com/pricing
- R2 Standard has 10 GB-month storage, 1 million Class A and 10 million Class B operations free monthly, with free direct egress; overages are billable, so do not present it as an unconditional zero-spend solution. https://developers.cloudflare.com/r2/pricing/
- Supabase Free includes 1 GB storage and egress allowances, but pauses projects after a week of inactivity, unattractive for a seasonal app. https://supabase.com/pricing
- GIPHY API documentation starts keys at 100 calls/hour and says a rate-limited beta key is sufficient for most applications; production upgrades involve discussing pricing. It requires attribution and prohibits proxying and caching media/assets/URLs. Before planning durable chat integration, verify identifier persistence and retrieval against applicable terms. Do not promise free production access or recommend storing returned URLs without review. https://developers.giphy.com/docs/api/
- Google's official Tenor documentation displays a service-discontinuation notice; avoid recommending it for a new picker. https://developers.google.com/tenor/guides/quickstart

## Recommendation and remaining decisions

Start with pasted/file-selected images plus uploaded animated GIFs using a no-card free media host, strict upload caps, bounded image dimensions and compression. Add a searchable GIF picker only after confirming provider terms/free-key suitability. Six light users are likely to fit the free allowance, not guaranteed unlimited use. Decide whether public-by-link attachments are acceptable or participant-only delivery is needed, and whether media must retry after refresh/offline. No runtime tests, production reads, billing/account changes or implementation occurred.

## Planning request and further investigation

The owner accepted the recommendation and requested Fable 5.2 at xhigh, following https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2, then Opus implementation with primary adversarial review. The guide was fetched and read in full. The planning prompt will specify bounded ownership (owner's repository, no unrelated refactors), one complete self-contained plan, explicit planner-only permissions and genuine blockers, no delegation, clear handoff, and xhigh explicitly. User approval of the resulting reviewed PLAN.md is still required before implementation under AGENTS.md.

Additional inspected code:
- src/lib/message-utils.js: matchesStoredMessage currently compares only text/idempotency/sender/recipient/conversation. Include attachment identity in idempotency matching without altering routing precedence or assignment authorization.
- src/components/ChatTabs.js: Chat is keyed by tab plus conversation. Existing draft-isolation tests matter for pending media and asynchronous uploads after navigation/account changes.
- src/components/ArchiveViewer.js: message content is plain text and previewOf only uses content. PublicFeed similarly uses raw content for preview and message rendering; no need to change existing text formatting behavior there just to render attachments.
- src/lib/year-paths.js allowlists five year collections; do not invent an attachments collection without planning the exact path and access policy. runFencedTransaction provides server-side admission and the current open-year fence; preserve transaction read-before-write rules and keep provider HTTP work outside retried transactions.
- .github/workflows/ci.yml gates lint, default unit/API suite, integration and E2E on Node 22. package.json supports >=22.13 <23; .nvmrc 22.15.0. No app checks have been run for this research-only stage.

Cloudinary official documentation inspected (no account/API access):
- https://cloudinary.com/documentation/upload_images: server uploads support actual file bytes via multipart REST, with API key/secret Basic Auth or signed parameters. API secret must stay server-only. Direct-client signed upload signatures last one hour; unsigned presets are usable by anyone who knows the name. Do not use an unrestricted unsigned preset. Server upload with conservative multipart limits may be simpler than client-upload reservations/attestation, but hosting body limits must be confirmed before choosing.
- https://cloudinary.com/documentation/image_upload_api_reference: force resource_type image, explicit random public_id, overwrite=false, allowed_formats, generic filename metadata and only bounded incoming transformations. GIFs must not be flattened. New provider fields must not break response parsing. Validate provider response shape; never trust client-supplied URLs/metadata as proof of upload ownership.
- https://cloudinary.com/documentation/control_access_to_media: default upload delivery is public via CDN. Random IDs prevent easy guessing but are not access control; even signed delivery URLs can be shared. Token/cookie-based access is premium. Participant-only delivery requires a distinct design and must not be implied by authenticated uploads. A reviewed plan should clearly expose public-by-link privacy as an owner decision.

Planning constraints: no searchable GIF provider in this phase, no paid add-ons or plan upgrades, no new credentials in prompts/files, no real Firebase/provider requests or deployment. Feature should fail closed for media when unconfigured while text still works; local verification must not contact Cloudinary. Prefer no paid infra or unnecessary dependencies. Account creation and server secret configuration are owner steps; no actual secrets belong in PLAN.md. Pre-existing owner settings, docs/ui-concepts and generated public workers remain untouched.

Further primary-source details for adversarial review:
- https://cloudinary.com/documentation/animated_images states on-the-fly GIF transformations truncate animations above 100 frames; 100–500 frames need async transformation. Avoid unconditional Cloudinary transformations or client canvas on animated GIFs. Need preserve GIF comment/metadata privacy or state limitations, rather than promising metadata stripping without a verified implementation.
- https://vercel.com/docs/functions/limitations documents a 4.5 MB request-body limit. Repository hosting was not verified (only .vercel in .gitignore); this is a conservative compatibility target, not evidence of the deployed provider.
- src/lib/year-client.js exposes getWritableScope(), a stable object identity per session/year key. Capture and re-check that identity for async media work so Close/Start/sign-out cannot enqueue a late upload to another scope.
- Planner launch: explicit claude-fable-5-2 / xhigh, restricted + dontAsk mode, --tools Read,Glob,Grep, empty MCP, hooks/skills disabled. CLI session init confirmed model claude-fable-5-2 and tools exactly Glob/Grep/Read with no MCP servers or skills. No bypass-permissions mode. Session 6c345e4e-36ab-4aa6-b254-9f14afb3197e.
- Owner's subsequent workflow preference: NEXT TIME use an agent on “6.1 sol” at medium for code investigation and feed its context to Fable. This does not request restarting this already-investigated planning session. Confirm the exact available full model ID/tool limits on that future launch; primary still owns review and executed checks.

## Primary adversarial review — round 1

Fable returned a complete draft using server-mediated bounded raw-body upload, a server-only mediaUploads record, browser compression for stills, untouched GIF bytes, and a separate outbox item prefix to protect media from older tabs. It explicitly left public-by-link delivery and other material choices for owner approval. Primary saved the draft as PLAN.md; no implementation is authorized.

Blocking findings sent back to Fable: missing writable-scope/ABA guards around async client work; unfenced upload finalization; pre-decode size claim contradicted by the Image.onload implementation; upload replays not bound to bytes; incomplete fake-provider startup/cleanup and GIF rendering fixtures; no stalled-body deadline; potentially sensitive provider error logging; and ambiguous metadata validation. Additional corrections cover exact file/documentation lists, read/write accounting and formatting. Primary approved the separate media-item key prefix and keeping provider HTTP outside transactions as sound directions, not approval of the whole plan.

Additional verified source https://cloudinary.com/pricing/compare-plans: Free supports 10 MB per image, 25 MP still images and 50 MP multi-frame images. ORIGINAL uploads count toward monthly transformations, so the draft's claim of zero transformation credits is incorrect. Plan limits are soft; the page says Cloudinary asks for an upgrade after exceeding them. Do not promise an automatic hard cutoff. A no-card Free account and no voluntary upgrade/add-ons are the no-spend boundary; upload guards are not a guarantee of staying inside free allowances. No provider account was accessed.

Round 1 checks: git diff --check initially found three whitespace-only lines in the planner's Markdown; primary removed only that trailing whitespace and annotated DRAFT/revision requested status, without changing the plan's design. No app tests/lint/build/emulators/browser checks have run in this planning stage. Fable revision launched on the same session with explicit claude-fable-5-2/xhigh and the same filtered tools.

## Primary adversarial review — round 2

Fable's complete revision addresses writable-scope identity/ABA guards, fenced finalization and failure marking, JPEG/PNG/GIF preflight before browser decode, SHA-256 upload-payload identity, a bounded read deadline, fixed-code-only provider error logs, a precise loopback provider lifecycle and native synthetic still/GIF fixtures. It corrects free-tier accounting and clearly exposes soft limits, deferred orphan deletion and owner choices. Primary accepted these directions and saved revision 2 to PLAN.md, still DRAFT.

Four remaining corrections returned to Fable: the failure-mark callback must compare reservation/current year and epoch (otherwise Close+Start can mark an old record failed under the new fence); internal client timeout must differ from user cancellation, settle stalled token/fetch/body waits and re-enable the composer without late requests; the browser's fake-CDN byte-read test needs explicit CORS headers; and no-card Cloudinary must not be described as a guarantee of no charges from unknown existing hosting/Firebase accounts. The existing standard re-admission behavior of runFencedTransaction is accepted without broadening scope to auth refactoring. The plan must retain dedicated tests for the corrected races/timeouts.

Revision 3 launch uses the same explicit model/effort/tool restrictions. CLI init again confirmed claude-fable-5-2 with tools exactly Glob/Grep/Read, dontAsk and no MCP. No app implementation/checks, production operations or provider calls occurred. Only planning/research documents have changed in the repository.

## Primary final review — 2026-11-12 MST

Fable's third complete draft resolves the remaining failure-mark year/epoch race, defines one total upload deadline including token waits with distinct cancellation and timeout errors plus cleanup, fixes the fake-CDN CORS contract, and narrows no-spend claims to the actual no-card provider boundary. Primary reviewed the entire second draft and the full third-draft diff. The own-draft stale-session clearing rule and token-before-abort order are accepted; they keep the composer recoverable and prevent cancellation races. No blocking plan objection remains.

Primary saved the final self-contained planner text as PLAN.md, excluded its handoff, normalized trailing whitespace only, and recorded adversarial review COMPLETE with Status DRAFT awaiting the owner's approval. Public-by-link delivery, JPEG/PNG/GIF caps (one per message, stills ≤1600 px/1 MiB, GIF ≤3 MiB, 20 daily reservations/person), online-first upload, ship-dark configuration, deferred orphan deletion and unenforced free allowances remain explicit owner choices. Opus has NOT been launched and no implementation is authorized yet.

Verification at this stage is planning-document diff/whitespace and file-reference checks only. No unit/API/integration/E2E suite, lint, build, emulator, browser, real provider smoke test, deployment or production/billing-account inspection ran. Owner-owned settings, UI-concept files and generated public workers remain untouched. Future investigation-agent preference remains 6.1 sol at medium, feeding context to Fable.

## Approval and implementation launch — 2026-11-12 MST

The owner replied “Yes” to the explicit request to approve the reviewed PLAN.md and listed defaults. Primary recorded Status: APPROVED for the exact plan and decisions O1–O6. No real provider/Firebase access, billing setup, deploy or Git publication is authorized.

Primary launched claude-opus-5-5 with explicit xhigh effort, restricted/dontAsk permissions, tools Read/Glob/Grep/Edit/Write only, no MCP, hooks or skills. CLI init confirmed that exact model and tool set; session 816aff2a-3cb3-4fa8-adb3-23247415d74c. The launch prompt confirms owner approval, limits edits to planned files and leaves commands/checks to primary. Owner settings, UI concepts and generated public workers were fingerprinted before implementation. Ports 8080, 9099, 4000, 3000 and 8791 had no listeners at launch. Supported Node 22.15.0 is available in the cached executable used by prior checks; verification used a fresh credential-free copy and synthetic identities.

## Publication requested — 2026-11-12 MST

The owner reported finishing the Cloudinary environment setup and explicitly requested “Ok done push a PR and I will merge after”. This authorizes a scoped commit, normal feature-branch push and PR creation; the owner retains the merge. It does not authorize manual deployment, real provider/Firebase access, billing inspection or changes to owner settings. Configuration remains owner-reported and the real-provider smoke test remains unrun.

Primary fetched origin, confirmed PR #66 is merged and the previous feature branch's committed tree matches origin/main. A new feat/chat-media-attachments branch will carry only the 35 approved implementation files plus PLAN.md/RESEARCH.md. Before publication primary rechecks source and owner fingerprints, exact staged scope, diff whitespace/references and the recorded passing results. No application behavior has changed since the passing tests; full suites are not rerun merely for these publication annotations. GitHub CI is a separate gate and is not claimed passed before it runs.

## Implementation handoffs and primary verification — COMPLETE

- Opus implemented exactly 35 planned files: 17 new and 18 modified. No dependencies, rules, routing functions (apart from the idempotency comparison), listener architecture, auth/lifecycle implementation, owner settings or generated workers changed. Its handoff said it ran no checks; CLI tool audits confirm file tools only.
- Primary reviewed every new application module and the application diff, test contracts, SDK boundaries, routing/annual fences, outbox compatibility and free-tier behavior. A primary-owned held-upload probe found the emoji picker could mutate a caption after it was captured. Opus corrected only the already-approved Chat.js and Chat_media.test.js, adding six regression cases. Primary's independent probe went from 1 failing case to 1 passing case. No scope/API-contract expansion occurred.
- Checks ran on Node 22.15.0 in `/tmp/secret-santa-media-verify._gx5e674`, with synthetic application and test identities, clean HOME/environment, explicit loopback Firebase emulators, disabled push/telemetry and an external-fetch guard. Real Cloudinary traffic was mocked/stubbed; browser CDN routes served the exact synthetic uploads.
- Final checks: `npm test -- --runInBand` **1286 tests / 69 suites passed**; `npm run lint` passed; `npm run build` passed; planted secret marker and `CLOUDINARY_API_SECRET` absent from client static output. Fresh primary-owned emulator combined run: **162 integration tests / 12 suites passed**, then **all 53 E2E tests passed with retries disabled** (normal repository timeout). Full command exited 0 in 215.04 s.
- Earlier checks are not hidden: the initial fixture transform missed names inside ids (two temporary unit failures, fixed only in the copy); the first integration run had one synthetic admin-email collision plus one unchanged admission concurrency test's emulator `INVALID_ARGUMENT` error (corrected fixture / clean rerun passed all); the first focused browser media run hit a 30 s cold multi-user timeout (traced 90 s diagnostic passed all five, then the final full suite passed all five with the normal timeout). No unrelated production/auth code or existing tests were changed to obtain these results.
- Extra browser checks passed at 1280×720 and 390×844: actual browser Clipboard API + keyboard paste, remove without upload, thumbnail/Send in bounds, no horizontal overflow, real chat overflow plus sticky-bottom image send, and visible GIF animation in chat/feed/archive after synthetic Close. Initial animation-sampling probes failed; an independent secure-origin ImageDecoder confirmed two valid red/blue frames, 500,000 µs each and infinite repetition. Foreground + fully loaded images + fixed-clip irregular screenshot sampling made both final cases pass without application changes. A separate browser check with all media variables absent passed: no attach/file control, media POST 503, and normal text delivery.
- Existing bootstrap lifecycle-listener permission errors and a late typing-delete permission rejection at Close were observed in unchanged code. The listener recovered (automatic Archive transition worked); the denied delete failed closed. They are not claimed fixed or absent.
- Final scope/fingerprint audits passed for all 35 implementation files and all 16 fingerprinted pre-existing owner files. Every primary-owned emulator/dev/fake-provider/auxiliary listener stopped. Temporary probes/config and screenshots remain outside the repository; the temporary identity mapping is removed after verification.
- Not run: real Cloudinary/provider CDN smoke test, account creation/billing/deployment/production inspection, native cross-application OS clipboard, and real iOS/Android/photo-picker checks. No Git commit/push/PR was requested or performed. Server Cloudinary configuration remains an owner action; the feature stays dark without it.

---

# Previous research: full-height recipient reveal on mobile

## Request and workflow override

The owner requested full height for the mobile recipient reveal shown in the screenshots, then explicitly directed using Opus 5.5 without Fable because this is a small change. Primary will use Opus only, in a fresh visible Herdr tab, for the bounded presentation-only adjustment in PLAN.md. The owner's request authorizes this mobile-height follow-up; no new drawing, acknowledgment, routing or desktop behavior is requested. Previous feature implementation, approval and verification evidence is preserved in commit 5f8b797 (draft PR #66).

## Current code

- src/components/RecipientReveal.js shares the container/card/login-card classes with other screens. Its main element centers the naturally sized card using inline justifyContent/alignItems. All four display states use the same card shell. Continue, retry, archive, admin controls, year line and sign-out are already implemented and must remain unchanged.
- src/app/globals.css defines container height 100vh, then 100dvh and 10px padding on mobile. It clips container overflow. Card has a 16px radius, 16px bottom margin and padding. Login-card overrides padding to 40px 32px, width 100% and max-width 420px; desktop at min-width 800px uses max-width 480px and padding 48px 40px.
- The screenshot at 390x844 shows the naturally sized card vertically centered with large empty areas above/below. Dedicated reveal-only classes can remove mobile outer padding, fill the available viewport, remove the floating-card border/radius/margin and keep internal scrolling, without touching auth/legacy selector/chat layouts.
- Desktop begins at 800px. The existing max-width 800px mobile rule overlaps desktop at exactly 800px. A new strictly-below-800 rule avoids changing the established desktop boundary.
- src/app/layout.js has device-width and initialScale 1 and does not request viewport-fit cover. No layout metadata change is needed. Safe-area-aware card padding is a local defensive measure for installed/mobile contexts.
- __tests__/unit/RecipientReveal.test.js already covers ready/loading/error/invalid, Continue/failed retry, controls and unmount. JSDOM cannot prove CSS geometry; browser measurement and screenshots are required.
- e2e/mobile-layout.spec.ts covers the existing chat layout, not the reveal. Existing year-rollover E2E covers reveal behavior and persistence. No permanent E2E file needs changing for this presentational follow-up; primary can measure the real screen with the already-created synthetic screenshot harness.

## Bounded approach

Add reveal-only main/card classes, and one mobile-only CSS rule below 800px. Make the card edge-to-edge and full-height within the viewport, retain existing content order and inline spacing, allow vertical card scrolling on short screens, and keep desktop's centered card unchanged. The owner then explicitly clarified that the content must also be vertically centered. Use a mobile-only flex column with equal empty before/after flex spacers and non-shrinking real children: spare height is split equally; overflowing content starts at the top and stays scrollable. No DOM wrapper or unsafe negative-overflow centering is needed. Do not redesign controls.

## Verification/runtime resources

- Supported Node 22.15.0 is cached locally and was used for prior checks.
- Primary-owned screenshot harness: /tmp/secret-santa-recipient-preview.al5rE0. It uses an isolated copy, synthetic Alex/Jamie/Casey registry/admin fixtures, clean HOME/environment, explicit local emulator hosts, disabled push and existing Playwright. Its emulator/dev servers were stopped; ports 8080/9099/4000/3000 were rechecked free at task start.
- Previous mobile/desktop screenshots are preserved under that harness's screenshots directory. Primary will create a fresh isolated copy for the updated capture and leave the real registry/config untouched.
- Only primary runs commands, emulators, browser checks and screenshot capture. Opus may not read runtime procedures, secrets, settings.local.json, outside-repository files or invoke commands/skills/delegates/MCP.
- Pre-existing owner changes remain .claude/settings.local.json and untracked public/sw.js, public/workbox-f1770938.js, public/worker-2a484529a5551160.js; preserve and exclude them. No production operation is requested. No new commit/push was required merely to capture the adjusted layout; the owner subsequently explicitly requested publication as recorded below.

## Risk flags

No message routing, Firebase SDK imports, listeners/reads, security rules, anonymity, assignment or acknowledgment changes. Only mobile geometry can regress: scope selectors exclusively to RecipientReveal, preserve 800px+ styling, permit short-viewport scrolling and ensure controls remain reachable. No external documentation/API research is needed.

## Opus handoffs and actual verification (2026-11-11 MST)

- Initial full-height pass: fresh Herdr tab w5:t9, claude-opus-5-5/xhigh, read/search/edit/write tools only. Opus made exactly the two class additions, mobile CSS and four markup test cases. Primary reviewed the diff and ran focused component tests (24 passed), full unit/API tests (968 passed), lint and build in a credential-free copy using Node 22.15.0.
- After the owner clarified vertical centering, a second fresh tab w5:tA launched claude-opus-5-5/xhigh with the same restricted tools. Opus edited only globals.css to add the approved flex-column/spacer/non-shrink rules. No Fable was used, no delegate command/check was executed and no behavior changed.
- Primary reran the full 968-test unit/API suite, lint and build after centering; all passed. Real Chromium with synthetic fixtures proved full-height mobile bounds at 375x667, 799x900, 390x390, 390x280 and 390x844. For fitting content, top/bottom free gaps were exactly equal: 114/114px, 239/239px and 202.5/202.5px at the three larger mobile sizes. Short screens scrolled only inside the card (scrollTop 9px and 159px; page scroll zero), with heading and sign-out reachable.
- Desktop at 800px and 1440px retained its 480x432 centered card, padding and radius. The new 1440x900 screenshot is byte-identical to the previous desktop screenshot. The centered mobile screenshot was inspected; paragraph-margin effects of flex layout do not introduce clipping or an unacceptable visual gap.
- The real local Continue route still opened chats, synchronized the second browser and stayed dismissed after reload. All screenshot emulator/dev/browser processes stopped afterward. No real roster/config data was used in screenshots, and only the disposable fixture copy's registry/admin values were replaced.
- Full integration/rules and full E2E were not rerun for this presentation-only change; no new backend/security/listener behavior exists. Real-device safe-area rendering remains unverified. At verification completion, no production operations, deployment, new dependency or Git publication had occurred; owner files are preserved.

## Publication authorized (2026-11-11 MST)

- The owner directed “Push and create a PR.” Primary fetched origin and confirmed draft PR #66 remains open for feat/annual-recipient-reveal against main. The follow-up is being committed and normally pushed to that existing feature branch, updating the existing draft PR without duplicate PR creation or history rewriting.
- Publication scope is the three approved mobile presentation/test files plus PLAN.md and RESEARCH.md. Source matches the passing verification copy. Owner-owned local settings and the three generated public workers remain excluded and hash-checked. No deployment, production access, force push or direct-main push is authorized.
