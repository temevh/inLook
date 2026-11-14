# inLook TODO

Settled things are in `DECISIONS.md`. P0 = demo cannot work without it. P1 = demo is risky without it. P2 = later.

## P0
- [ ] Build the mic path: relay `WS /audio/stream` to ElevenLabs, publish `transcript.line`, spot claims, run `check.process_claim` (`backend/app/main.py`). Or drop it and demo scene 06 with hotkey + selection.
- [ ] Pick a real demo page you can edit on camera, and point the seeded facts at it (`backend/app/seed.py`).
- [ ] Add `GEMINI_API_KEY`, confirm the model name, and run `spot`, `match`, `verdict_card`, `vision` for real. Tune the prompts.
- [ ] Set up the demo laptop: `backend/.env` keys, laptop IP on the Atlas access list, `uv run python -m app.seed` before every take.

## P1
- [ ] Stop the HUD replaying old events after a backend restart (`backend/app/events.py`, `overlay/src/main/sse.ts`).
- [ ] Fix the "still current" card: it shows "Fact updated" and never goes away. Choose a new title or no card (`backend/app/check.py`, `overlay/src/renderer/hud/hud.ts`).
- [ ] Add timeouts to Gemini calls and to each claim, so "Checking…" never hangs (`backend/app/services/gemini.py`, `backend/app/check.py`).
- [ ] Make backend startup survive Atlas being unreachable: short timeout, or fall back to the in-memory log (`backend/app/events.py`).
- [ ] Detect page changes for scene 05: Context.dev, a polling loop, or a manual re-check. Nothing calls `db.facts_by_source` yet.
- [ ] Show version history for scene 07 (`overlay/src/renderer/hud/hud.ts`).
- [ ] Show who a message is for in the HUD, and let message cards dismiss (scenes 08-09).
- [ ] Write tests: `/check` and `/reviews` over HTTP, the Mongo event log, overlay-to-backend.
- [ ] Tell the team the code uses MongoDB Atlas, and get a yes on the unconfirmed choices in `DECISIONS.md`.

## P2
- [ ] Make `POST /reviews` take `check._route_lock`.
- [ ] Stop Accept showing two cards for one fact.
- [ ] Add a HUD test for a "still current" verdict.
- [ ] Confirm the "proposed" payloads in `shared/CONTRACT.md`.
- [ ] Confirm `scripts/sync-to.sh` should copy `backend/.env` to the demo laptop.
- [ ] Remove `GEMINI_EMBEDDING_MODEL` and `CONTEXT_DEV_API_KEY` from your local `backend/.env`.

## Docs to fix
- [ ] Spec (`.plans/overlay-architecture-spec.md`): scenes 06-09 are not all built; MongoDB is no longer unconfirmed; the event log is no longer in memory.
- [ ] `README.md`: stop calling the backend a skeleton.
- [ ] `shared/CONTRACT.md` and `overlay/src/main/sse.ts`: seq does not restart at 1 with MongoDB.
