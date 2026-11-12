# PLAN.md: Full-height recipient reveal on mobile

## Status

**Status: APPROVED — user-requested presentation-only follow-up, 2026-11-11 MST. Primary adversarial review COMPLETE for this bounded application change.** The owner requested full height for the mobile reveal and explicitly directed Opus 5.5 without Fable for this small change. This overrides the usual Fable drafting step for this follow-up; no separate planner is being launched. The approved scope is only mobile reveal presentation and its markup regression tests. The owner subsequently clarified: “Okay but it should be vertically centered too”; that centering requirement is approved as part of this same Opus-only follow-up. Prior annual-feature evidence is preserved in commit 5f8b797 / draft PR #66.

## Primary execution evidence — initial full-height pass before centering (2026-11-11 MST)

- User-directed Opus-only workflow honored; no Fable launch. Fresh visible Herdr tab w5:t9 (`Opus · full-height mobile reveal`), explicit full model claude-opus-5-5 and xhigh. CLI init confirmed tools exactly Edit/Glob/Grep/Read/Write, no MCP and dontAsk mode. Opus edited only the three approved files and ran no checks/commands.
- Primary reviewed the exact diff: two classes, the specified scoped CSS block and four appended markup cases; no handler, state, DOM hierarchy, copy, backend or shared-layout change.
- Node 22.15.0, credential-free disposable copy: focused RecipientReveal **24 tests passed**; full unit/API suite **968 tests / 62 suites passed**; lint and production build passed.
- Fresh primary-owned emulator/browser capture with synthetic data passed: mobile card/main exactly match viewport at 375x667, 390x844, 799x900 and 390x390, with no horizontal/body overflow. Short-viewport scrolling kept Sign out reachable within the card. Continue/archive/sign-out stayed visible at normal phone sizes.
- At 800x900 and 1440x900 the desktop card remains 480x432 with 40px horizontal padding and 16px radius. The 1440x900 desktop screenshot is byte-identical (SHA-256 equal) to the previous synthetic desktop capture.
- Continue still opened chats, dismissed the second browser's reveal and stayed dismissed after reload. Updated desktop/mobile screenshots were captured. Browser/emulator/dev processes shut down cleanly.
- Full integration/rules and full E2E suites were not rerun for this presentation-only follow-up; the scoped real-browser geometry/persistence checks above were executed instead. No real-device verification, production operation, dependency install or deployment.
- Source matches the passing verification snapshot; original owner settings/generated workers remain preserved. This follow-up is not committed or pushed.

## Primary execution evidence — centered follow-up (2026-11-11 MST)

- User clarification honored with a fresh Opus-only launch in visible tab w5:tA (`Opus · center full-height mobile reveal`). Explicit claude-opus-5-5/xhigh; CLI init confirmed Edit/Glob/Grep/Read/Write only, no MCP, dontAsk. Opus changed only the scoped CSS additions and ran no commands/checks.
- Primary reviewed the one-file addition: mobile flex column, two equal empty flex spacers and non-shrinking real children. Desktop and all behavior remain untouched. Flex layout can add adjoining paragraph margins rather than collapse them; the rendered spacing was inspected in the refreshed screenshot and is acceptable for this centering adjustment.
- Re-ran Node 22.15.0 full unit/API suite: **968 tests / 62 suites passed**; lint and production build passed. Prior focused 24-test component result still applies; markup did not change in the centering pass.
- Real-browser centering verified by equal free gaps: 375x667 = 114px/114px; 799x900 = 239px/239px; 390x844 = 202.5px/202.5px. Card/main still exactly fill the mobile viewport with no body/horizontal overflow.
- At 390x390 and 390x280, overflowing content remained reachable from the top; card scrolling reached Sign out while page scroll stayed zero. Desktop at 800px/1440px stayed naturally sized, and the 1440x900 screenshot remains byte-identical to the original desktop capture.
- Continue, second-context acknowledgment synchronization and no-repeat after reload passed again. Refreshed centered mobile screenshot captured; all primary-started processes stopped.
- Full integration/rules and full E2E suites were not rerun for this CSS-only follow-up. No production operation or deployment occurred.
- **Publication authorization (2026-11-11 MST):** the owner requested “Push and create a PR.” Primary fetched origin and confirmed draft PR #66 is still open for feat/annual-recipient-reveal against main. This follow-up will be committed and normally pushed to that same branch, updating the existing draft PR rather than creating a duplicate. Commit scope is exactly the three implementation/test files below plus PLAN.md and RESEARCH.md; local settings and existing public workers remain excluded. Verified source is unchanged since the passing checks.

## Goal

Make the mobile recipient reveal fill the screen with its content group vertically centered when it fits, and safely scrollable from the top when it does not, while desktop and all behavior remain unchanged.

## Proposed changes — exactly 3 implementation files

### 1. src/components/RecipientReveal.js (client component; no Firebase SDK changes)

- Append `recipient-reveal-screen` to the main element's existing `container` class.
- Append `recipient-reveal-card` to the div's existing `card login-card` classes.
- Keep test ids, inline styles, DOM hierarchy/content order, copy, all controls, handlers and state logic byte-for-byte unchanged. No wrapper, new prop, hook or behavior.

### 2. src/app/globals.css (CSS only; no SDK)

Append this scoped block after the existing rules. It applies strictly below the existing 800px desktop breakpoint:

```css
/* Mobile recipient reveal fills the viewport; other login cards and desktop stay unchanged. */
@media (width < 800px) {
  .recipient-reveal-screen {
    max-width: none;
    padding: 0;
  }

  .recipient-reveal-screen .recipient-reveal-card {
    width: 100%;
    max-width: none;
    height: 100%;
    min-height: 0;
    margin-bottom: 0;
    border: 0;
    border-radius: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: calc(40px + env(safe-area-inset-top, 0px))
      calc(32px + env(safe-area-inset-right, 0px))
      calc(40px + env(safe-area-inset-bottom, 0px))
      calc(32px + env(safe-area-inset-left, 0px));
  }

  .recipient-reveal-screen .recipient-reveal-card::before,
  .recipient-reveal-screen .recipient-reveal-card::after {
    content: "";
    flex: 1 0 0;
  }

  .recipient-reveal-screen .recipient-reveal-card > * {
    flex-shrink: 0;
  }
}
```

- Inherit the existing mobile container height (100dvh, with the base 100vh fallback if unsupported); do not alter shared container/card/login-card rules.
- Empty before/after flex spacers share positive free space equally, vertically centering the whole content group. When content is taller than the viewport, the zero-basis/non-shrinking spacers collapse to zero and non-shrinking real children remain scrollable from the top. Keep content order, copy and inline spacing; do not add a DOM wrapper or use unsafe overflow centering. Safe-area padding protects controls. Only the card scrolls vertically; no controls may be clipped or horizontal scrolling introduced.
- At 800px and above this new rule does not apply. The desktop card remains naturally sized, rounded and centered with the current desktop padding.

### 3. __tests__/unit/RecipientReveal.test.js (JSDOM; existing mocks; no SDK)

Add a parameterized markup-only test for ready, loading, error and invalid states. Render each using existing renderReveal helpers (ready gets Bravo; others null). Assert the reveal card retains `card login-card` and gains `recipient-reveal-card`, and its nearest main retains `container` and gains `recipient-reveal-screen`. Keep all existing test bodies unchanged. Do not assert pixel geometry in JSDOM.

## Primary-executed steps

- Launch Opus full model claude-opus-5-5 with xhigh effort in a fresh visible multiplexer tab. Read/search/edit/write only; no shell, checks, Git, web, browser, DB, MCP, skills or delegates. Confirm model/tool scope from CLI init.
- Create a credential-free disposable verification copy, preserving the owner's local settings/generated workers. Only primary runs checks and browser capture.
- Reuse the synthetic screenshot harness approach in a fresh isolated copy; replace only its fixture registry/admin data, not the real repository's. Start only primary-owned emulators/dev server after checking 8080/9099/4000/3000. Stop all newly started processes afterward.
- No dependency install, generated repository output, production access or deployment. The owner separately directed “Push and create a PR” on 2026-11-11 MST; publication of this follow-up is now authorized.

## Verification (primary)

1. Review exact diff: two class additions, one scoped CSS block and new markup tests only; no behavior/SDK/listener/rule changes. git diff --check; owner-file hash preservation.
2. Node 22.15.0: focused RecipientReveal unit file, full npm test, npm run lint and npm run build in the disposable copy. Zero failures; report actual counts.
3. Real Chromium with synthetic data: at 390x844 and 375x667, main/card bounds are x=0,y=0,width=viewport width,height=viewport height (1px tolerance); no horizontal overflow; Continue, archive and sign-out remain available. Measure free gaps between card padding and the first heading/last sign-out control: positive gaps must match within 2px, proving vertical centering.
4. Short viewports 390x390 and 390x280: card height matches viewport; when content overflows, the heading must remain reachable at scrollTop 0 and sign-out reachable after card scrolling. No body-height growth beyond viewport, no clipped negative-start content and no shrinking controls.
5. At 800px and 1440px widths, no full-height rule applies: the reveal remains a naturally sized centered card with the established max-width/padding/radius. Compare the 1440x900 screenshot with the previous synthetic desktop capture if practical.
6. Capture the updated mobile and desktop reveal. Confirm Continue still reaches chats, synchronizes a second context and stays dismissed on reload using the existing runtime harness. Show updated mobile screenshot to the owner.
7. Full integration/rules suite is not required: no backend, data or security changes. Full E2E suite is not required for this scoped layout change; run the real geometry/persistence checks above and clearly distinguish them from the full suite previously passed for the feature.

## Open decisions

None. Scope is the requested full-screen mobile presentation only; desktop, content order, acknowledgment and existing-year behavior remain unchanged.
