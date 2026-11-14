# Phase 5: minimal tests

## What was done

- `overlay/test/fixtures.test.ts`: every item in `overlay/mock/*.json` validates against `shared/event.schema.json` (same ajv setup as `mock.mjs`). A bad criticality and a missing payload field are rejected.
- `overlay/test/sse.test.ts`: runs the compiled `subscribe` (`dist/main`) against a local SSE server on a random port. Events arrive in order, a replayed duplicate `seq` is delivered once, an invalid event is dropped, and after the server drops the connection the client reconnects sending `Last-Event-ID`.
- `overlay/package.json`: `"pretest": "npm run build"`. `validate.ts` loads schemas from `dist/schemas` (copied at build), so the tests run against built code.
- No production code changed, no new dependencies.

## Result

`npm test` → 2 files, 6 tests passed (~350 ms after the build).

## Not done (hackathon scope, decided by manager)

- DOM tests of the HUD: covered by the phase 4 harness screenshots.
- Playwright `_electron` smoke test: no xvfb on the dev machine; a manual demo run is used instead.
