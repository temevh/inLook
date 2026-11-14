# inLook TODO

Settled things are in `DECISIONS.md`. P0 = demo cannot work without it. P1 = demo is risky without it. P2 = later.

## P0
- [x] Build the mic path: relay `WS /audio/stream` to ElevenLabs, publish `transcript.line`, spot claims, call `check.check_claim` (`backend/app/listen.py`).
- [ ] Rehearse the mic path with the real mic on the demo laptop: two voices, a pause between speakers; check the speaker names (`INLOOK_SPEAKERS`).
- [ ] Demo trigger for a page re-check: an overlay hotkey or widget button that calls `POST /recheck` (`overlay/src/main/`).
- [ ] Run Gemini `vision` (screenshots) for real; `spot` (mic path), `match` and `verdict_card` work on the free tier. Each spoken claim costs 3 calls (spot, match, verdict). Free tier: about 20 requests a day per model, so plan the demo takes, or get a paid key.
- [ ] Set up the demo laptop: `backend/.env` keys, laptop IP on the Atlas access list, `uv run python -m app.seed` before every take, a tunnel + `PUBLIC_BASE_URL` + `python -m app.monitors sync` for the webhook.

## P1
- [ ] Stop the HUD replaying old events after a backend restart (`backend/app/events.py`, `overlay/src/main/sse.ts`).
- [x] Fix the "still current" card: the HUD shows it as "Up to date" with the stored value and its source, and it fades after 4 s (`overlay/src/renderer/hud/hud.ts`). The backend still titles it "Fact updated" (`backend/app/check.py`); the HUD no longer uses that title.
- [ ] Prove a real Context.dev monitor webhook reaches the backend through the tunnel (`monitors run`, then check the log and `monitors status`).
- [ ] Show version history for scene 07 (`overlay/src/renderer/hud/hud.ts`).
- [x] Show who a message is for in the HUD (scenes 08-09): the people notified and the strategies affected are lines on the fact's own card ("Affects", "Review by … notified"), which fades with its outcome. A message or flag for a fact with no card still gets a card of its own, which does not dismiss.
- [ ] Write tests: `/check` and `/reviews` over HTTP, the Mongo event log, overlay-to-backend.
- [ ] Agree with the team: the spec says "seed.json in memory, no database", this branch loads seed.json into MongoDB Atlas. Also get a yes on the unconfirmed choices in `DECISIONS.md`.
- [ ] What a repeated claim should show: it now gets the fact's last verdict (5-minute window, `backend/app/check.py`); the spec only says "skipped".

## P2
- [ ] Make `POST /reviews` take `check._route_lock`.
- [x] Stop Accept showing two cards for one fact: the review card turns into the update (or "Kept") and fades (`overlay/src/renderer/hud/hud.ts`).
- [ ] Add a HUD test for a "still current" verdict.
- [ ] Confirm the "proposed" payloads in `shared/CONTRACT.md`.
- [ ] Confirm `scripts/sync-to.sh` should copy `backend/.env` to the demo laptop.
- [ ] Remove `GEMINI_EMBEDDING_MODEL` from your local `backend/.env`.
- [x] Overlay HUD: `claim.spotted` cards with source `page` read "Source page re-check" (`overlay/src/renderer/hud/hud.ts`).

## Docs to fix
- [ ] Spec (`.plans/overlay-architecture-spec.md`): scenes 06-09 are not all built; MongoDB is no longer unconfirmed; the event log is no longer in memory.
- [ ] `README.md`: stop calling the backend a skeleton.
- [ ] `shared/CONTRACT.md` and `overlay/src/main/sse.ts`: seq does not restart at 1 with MongoDB.
