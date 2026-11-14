# backend

Inlook backend: Python FastAPI. Owned by others.
Spec: `.plans/overlay-architecture-spec.md`, "Inlook backend". Wire contract: `shared/CONTRACT.md`.

## Run

```sh
uv sync                     # or: python3 -m venv .venv && .venv/bin/pip install -e .   (Python >= 3.12)
cp .env.example .env        # fill keys; MONGODB_URI is needed for /check and /reviews
uv run python -m app.seed   # reset the demo data in MongoDB (before each demo take)
uv run uvicorn app.main:app --env-file .env --reload
uv run python -m unittest   # tests
```

Without `MONGODB_URI` the server still runs on the in-memory event log (`/dev/events` and `/stream` work);
`/check` and `/reviews` answer 503 because they need the stored facts. `INLOOK_EVENTS=memory` forces the
in-memory log even with a database.

## Endpoints

| Endpoint | State |
|---|---|
| `WS /audio/stream` | accepts a PCM session and discards the frames; ElevenLabs relay TODO |
| `POST /check` | working: 202 at once, the flow runs in the background (`app/check.py`): claim → match → source page → verdict → tier routing. Needs `GEMINI_API_KEY`; without it every claim ends in `claim.unverified` |
| `POST /reviews/{id}` | working: accept or reject, publishes `review.closed` (+ `fact.updated` on accept, `strategy.healthy`). 404 unknown, 409 already closed |
| `GET /stream` | working SSE: `<bootId>:<seq>` ids, Last-Event-ID replay, keep-alives. With MongoDB the log is the `events` collection, woken by a change stream, and survives restarts |
| `POST /dev/events` | only with `INLOOK_DEV=1`: inject an event to drive the overlay; 422 if it breaks the contract. With a database, `review.created` and `strategy.flagged` also change the seeded data, so Accept / Reject on mock cards works |
| `GET /health` | ok |

## Layout

```
app/main.py              endpoints
app/config.py            env settings (see .env.example); also loads .env for the seed script and tests
app/contract.py          GENERATED from shared/*.schema.json (npm run gen:contract:py in overlay/); do not edit
app/events.py            event log + SSE; validates every event against the contract. EventLog (memory), MongoEventLog
app/check.py             the fact-check flow behind POST /check, tier routing included
app/seed.py              clears and refills the demo data (people, facts, strategies)
app/services/db.py       MongoDB Atlas: client, indexes, fact / review / strategy helpers, event storage
app/services/gemini.py   Gemini calls: spot, match, verdict + card, vision (card schema from shared/)
app/services/source.py   fetches a fact's source page (plain GET, a stand-in until Context.dev is decided)
tests/                   python -m unittest; check-flow tests run on a separate `inlook_test` database
```

## Data (MongoDB Atlas)

Collections: `facts`, `strategies`, `people`, `reviews`, `messages`, `events`, plus `counters` (one document,
the last event `seq`). Fields follow the spec's "Data model"; they are still a proposal. Ids match
`overlay/mock/*.json`. Indexes are created at startup (`db.ensure_indexes`).

- Tier rule: the stored tier is used, except that a `low` fact any strategy relies on counts as `medium`.
- `events.seq` comes from the counter document. The seed reset clears `events` but not the counter, so seq
  stays monotonic and a running overlay keeps accepting events. Publishing is serialised by a lock (one backend process).
- Rejecting a review also clears its strategies' flags once nothing is pending (the spec only says so for accept).
- A `current` verdict reuses the card title "Fact updated" (the contract has no "still current" title).
- The seed's `sourceUrl`s are `.example` placeholders: point a fact at a real, changeable page for the demo.

Not built and not decided (see the spec): Context.dev source re-checks and page watching, ElevenLabs relay.
