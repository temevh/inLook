# Decisions made

What is settled, and where it came from. Open questions live in `TODO.md`, not here.
Sources: the spec (`.plans/overlay-architecture-spec.md`), the contract (`shared/CONTRACT.md`, items marked "decided"), and this working session.

## Product and scope (spec)
- Hackathon build: about 24 h, 2-3 people, a 2-minute pitch video, one user on one machine.
- inLook catches outdated facts in meetings, flags the strategies that depend on them, and notifies only their owners.
- Strategies, people and facts are **mock data**, seeded by a script. They must not be presented as real.
- Dashboards, fact browsing and the company-wide flow are pre-made visuals in `visualizations/visuals/`, not built.
- Future work, claimed in the pitch only: live/record/replay adapters, saving new facts from meetings, Slack and other integrations, multiple users, a real dashboard and strategy editor, passive screen capture, ElevenLabs voice.

## Platform and architecture (spec)
- Overlay: Electron + TypeScript on Debian, **X11** session (not Wayland), no browser extension.
- Two windows: a click-through HUD side strip, and a small interactive widget. "Toggle HUD interactive" switches the HUD to accept clicks for accept/reject.
- Overlay to backend over HTTP; results come back over SSE (`GET /stream`) with a `seq` on every event.
- Backend: Python + FastAPI. Gemini through `google-genai` with structured JSON output on every call.
- Speech to text: ElevenLabs STT with speaker labels, mapped to names by a fixed list for the demo.
- The JSON schemas in `shared/` are the contract source; the TypeScript and pydantic types are generated from them.

## Fact-check behaviour (spec, contract)
- Flow: claim spotted, matched to a stored fact, source re-checked, verdict, then routed by tier. No match: the claim is shown as unverified and dropped.
- Verdicts: `current`, `outdated`, `unverifiable`.
- Tiers: **low** saves a new version at once; **medium** opens a review for the person who stated the fact; **high** opens a review for the owners of the dependent strategies, flags those strategies, and messages those owners.
- Floor: a fact any strategy relies on is at least medium. Only facts no strategy uses can be low.
- A strategy is flagged when one of its facts is outdated or in review at high tier. One message goes to that strategy's owners only.
- Review outcome: accept appends a version and returns the fact to `current`; reject keeps the old value and closes the review. In the single-user demo the current user stands in for the reviewer.
- HUD card: title is "Fact outdated", "Fact updated" or "Needs review"; criticality is copied from the fact's tier and the backend checks it before sending; one fact line, e.g. "Competitor X: €59 → €39 per seat".
- Inputs: mic stream, selected text (X11 PRIMARY selection), screenshot on demand, and a global hotkey for "check now".

## Made in this session
- **MongoDB Atlas** (free tier) is the storage, and the backend uses it now: facts, strategies, people, reviews, messages and events, plus a `counters` document. Decided by you; the team's other docs still list storage as undecided.
- **Events live in MongoDB** with a change stream waking the SSE clients. The in-memory log stays as a fallback (`INLOOK_EVENTS=memory`, or no `MONGODB_URI`).
- **A claim that is still correct reuses the card title "Fact updated"** for now, without changing the contract. You chose this over adding a "Fact current" title.
- **Tests use a separate `inlook_test` database** and refuse to run against the demo database.
- **The seed reset never rewinds the event counter**, so a running overlay keeps accepting events after a reseed.
- **Context.dev reads every source page, with no fallback** (`backend/app/services/context_dev.py`): a fresh scrape (`maxAgeMs: 0`) of the fact's `sourceUrl`, or a Context.dev search when the fact has none. A Context.dev failure ends the claim as "unverifiable".
- **Re-checks without a spoken claim** go through the same verdict and tier routing: a Context.dev page monitor calls `POST /webhooks/context` when a page changes, and `POST /recheck` re-checks on demand (monitors run every 10 min at best, so the demo uses it). The HUD sees `claim.spotted` with the new contract source `page`.
- **Demo facts point at real public pages** (Notion pricing, Apple return policy), seeded with an older value so the first re-check finds them outdated. No self-made demo page. People and strategies stay mock data.
- **Monitor signing secrets live in MongoDB** (`monitors` collection), one per monitor; webhook event ids are kept in `webhook_events` so retries do nothing twice.
- **MongoDB stays, shaped by the agreed data model** (merged from `main`, 6957944): records come from `backend/seed.json` and are loaded into MongoDB by `app.seed`; people have a `role`; events carry people as `{ id, name, role }`; `check_claim(text, quote, source, speaker?, lineId?)` is the claim entry point; a fact checked in the last 5 minutes is not re-checked for a new claim. **Open with the team:** the spec now says "seed.json in memory, no database for the demo"; this branch keeps MongoDB (the Atlas challenge, the event log, and Context.dev monitor secrets).
- **The backend starts without Atlas.** MongoDB calls time out after 15 s (`MONGODB_TIMEOUT_MS`; 5 s proved too short on a hotspot). If Atlas does not answer within 10 s at startup (`MONGODB_STARTUP_TIMEOUT_S`), that run uses the in-memory event log: `/stream`, `/dev/events` and `/health` work, while `/check`, `/reviews` and `/recheck` answer 503 "database unreachable". Restart the backend once Atlas is back. `/health` reports `database` and `events`.
- **Timeouts and retries so a card never hangs on "Checking…".** Each Gemini call: 20 s per attempt, 2 attempts (`GEMINI_TIMEOUT_S`, `GEMINI_ATTEMPTS`); a timeout, 429, 5xx or unreadable JSON is retried, a bad request or missing key is not. A claim has 45 s to reach a verdict (`CHECK_TIMEOUT_S`), then closes as "unverifiable"; publishing the verdict and tier routing are never cut off half-way. Context.dev scrape/search/list get one retry on a network error, 408, 429 or 5xx; creating a monitor is never retried. Publishing an event retries an Atlas blip twice. A failing background task is logged.
- **Gemini runs on the free tier with `gemini-3.5-flash-lite`** (key from Google AI Studio, in `backend/.env`). It answers in about 1.5 s and got both demo verdicts right (Notion $8 → $10, Apple 30 → 14 days). `gemini-3.8-flash` was overloaded on the free tier (503 after ~40 s), `gemini-2.5-flash` is closed to new users. Free-tier data may be used by Google: mock data only.
- **Gemini stays unfaked outside tests** until the key arrives; no rule-based stand-in.
- **Work goes on a branch** (`backend-mongodb-check-flow`), not directly on `main`.

## Implementation choices not yet confirmed by anyone
These were my choices while building. They are written into the code and need a yes or a change from the team.
- Rejecting a review also clears the strategy flag once nothing is pending (the spec only says this for accept).
- With a high-tier fact that no strategy uses, the review goes to the person who stated it.
- At most 5 claims are checked per request; a selection of 200 characters or fewer is treated as one claim without a Gemini spot call.
- Mic path (`backend/app/listen.py`): ElevenLabs `scribe_v3_live` (the only realtime model with speaker labels), lines committed by voice-activity detection after a 0.8 s pause. Speaker labels map to `INLOOK_SPEAKERS` in the order people first speak; a line whose labels do not arrive within 0.6 s shows as "Speaker".
- Mic path, Gemini quota: only lines with a number, a currency or a word from a stored fact's label/key go to `spot` (`SPOT_PREFILTER`); lines are spotted in one call 1.5 s after the first (`SPOT_DEBOUNCE_S`), with the 2 lines before as context; a claim already checked in the session is not checked again. A spot failure is logged and shows no card (no claim was announced yet).
- Mic path, failures: ElevenLabs is reconnected up to 2 times per session; a missing or rejected key, no credits or bad settings stop at once. Either way the WebSocket stays open and the rest of the audio is discarded, so the overlay does not loop on reconnects.
