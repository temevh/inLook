# Phase 1: mock backend

## What was done

- `overlay/mock/demo.json`: 7 events for pitch scenes 06–09. Two transcript lines (fictional speakers Mira Mockwell, Sam Sample), `claim.spotted`, `claim.verdict` (outdated, high: "Competitor X: €59 → €39 per seat"), `review.created` (high), `strategy.flagged` ("Mock Pricing Plan"), `message.created`.
- `overlay/mock/tiers.json`: 10 events. Low tier (verdict + `fact.updated`), medium (verdict + `review.created`), `claim.unverified`, `review.closed` (accepted) + `strategy.healthy`.
- `overlay/scripts/mock.mjs` and `npm run mock [scenario]` (default `demo`):
  - validates every item against `shared/event.schema.json` with ajv (2020-12 + ajv-formats) before sending anything, and exits 1 on the first invalid item;
  - POSTs `{type, payload}` to `${INLOOK_BACKEND_URL:-http://127.0.0.1:8000}/dev/events`, waiting each item's `delayMs`;
  - `seq` and `at` come from the backend.

## Why

The backend pipeline is not built yet, but the backend skeleton's SSE works. The overlay is driven by the real stream with scripted events, not a separate mock server (Prism and MSW do not fit SSE well).

## Run

```sh
cd backend && INLOOK_DEV=1 uvicorn app.main:app
cd overlay && npm start
cd overlay && npm run mock          # or: npm run mock tiers
```

## Checks done

- Demo and tiers ran against the skeleton. `/stream` showed seq 1–17 with full envelopes.
- An invalid fixture copy exited 1 with nothing sent.
- The backend accepted all fixtures.

## Open

Fixture ids (`f-compx-price`, `s-pricing`, `p-ada`) are not tied to any seed data. If the backend seed fixes ids, the fixtures need updating.
