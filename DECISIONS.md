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
- **Source pages are fetched with a plain GET** until Context.dev is decided (`backend/app/services/source.py`).
- **Work goes on a branch** (`backend-mongodb-check-flow`), not directly on `main`.

## Implementation choices not yet confirmed by anyone
These were my choices while building. They are written into the code and need a yes or a change from the team.
- Rejecting a review also clears the strategy flag once nothing is pending (the spec only says this for accept).
- With a high-tier fact that no strategy uses, the review goes to the person who stated it.
- At most 5 claims are checked per request; a selection of 200 characters or fewer is treated as one claim without a Gemini spot call.
