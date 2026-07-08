# Plan 3: Run the Integration Suite in CI (Backlog §3, audit item 5)

## Goal

The integration suite — including all three Firestore rules test files — currently never runs in CI. Add a CI job that runs it under the Firebase emulators.

## Ground Truth

- `.github/workflows/ci.yml` has three jobs: `lint`, `unit-test` (`npm test`), `e2e-test`. The e2e job already proves the emulator pattern works in CI: `actions/setup-java@v4` (temurin 17) + `npx firebase emulators:exec --project=demo-secret-santa "npm run test:e2e"`.
- Integration tests live in `__tests__/integration/` (7 files incl. `firestore-rules-lastRead/reactions/typing.test.js`), run via `npm run test:integration` → `jest --config jest.integration.config.js --runInBand`.
- `firebase-tools` is currently v14 (works with Java 17). The deferred v15 major drops Java < 21 — see Plan 6.

## Proposed Changes

**`.github/workflows/ci.yml`** — add one job, modeled directly on `e2e-test`:

```yaml
  integration-test:
    name: Integration Tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      - run: npm ci
      - name: Java Setup
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - name: Run Integration Tests
        run: npx firebase emulators:exec --project=demo-secret-santa "npm run test:integration"
```

No Playwright install needed (that's e2e-only). Keep the job parallel to the others — no `needs:` chain, so lint/unit failures don't hide integration results.

## Verification

- Local dry run of the exact CI command: `npx firebase emulators:exec --project=demo-secret-santa "npm run test:integration"` (should pass from a clean checkout with emulator ports free).
- Push branch, open PR, confirm the new job appears and goes green.
- Sanity-check `__tests__/integration/setup.js` / `helpers` for hardcoded ports matching `firebase.json` (8080/9099) — `emulators:exec` uses `firebase.json` config, same as local.

## Risks / Notes

- `--project=demo-secret-santa` differs from the dev project id `xmasteak-app` used by `firebase-client.js`; integration tests use the Admin SDK / rules-unit-testing with their own project id — confirm `__tests__/integration/setup.js` doesn't pin `xmasteak-app`. If it does, align on one demo project id.
- First run may be slow while `firebase-tools` downloads emulator JARs; the e2e job already absorbs this, so ~2–4 min is the expected added CI time.
- When Plan 6's `firebase-tools` v15 upgrade lands, bump `java-version` to 21 in **both** this job and `e2e-test`.
