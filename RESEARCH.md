# Research: full-height recipient reveal on mobile

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
