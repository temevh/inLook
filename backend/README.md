# backend

Inlook backend: Python FastAPI. Owned by others.
Spec: `.plans/overlay-architecture-spec.md`, "Inlook backend". Wire contract: `shared/CONTRACT.md`.

## Run

```sh
uv sync                     # or: python3 -m venv .venv && .venv/bin/pip install -e .   (Python >= 3.12)
cp .env.example .env        # fill keys; MONGODB_URI is needed for /check, /reviews, /recheck
uv run python -m app.seed   # reset MongoDB from seed.json (before each demo take)
uv run uvicorn app.main:app --env-file .env --reload
uv run python -m unittest   # tests
```

Context.dev (every source page is read through it; there is no other fetcher):

```sh
uv run python -m app.monitors peek     # scrape each fact's page now, print the lines about the fact
cloudflared tunnel --url http://localhost:8000   # public URL -> PUBLIC_BASE_URL in .env, restart the backend
uv run python -m app.monitors sync     # one Context.dev page monitor per sourceUrl, webhook -> /webhooks/context
uv run python -m app.monitors status   # state, last run, last change, last error
```

Timeouts (all in `.env`): Gemini `GEMINI_TIMEOUT_S` (20) per attempt x `GEMINI_ATTEMPTS` (2); a claim gets
`CHECK_TIMEOUT_S` (45) to reach a verdict, then its HUD card closes as "unverifiable". Context.dev reads and
event publishing retry transient failures once or twice (`DECISIONS.md` has the details).

If Atlas does not answer at startup (bad network, IP not on the Atlas access list), the server starts anyway
on the in-memory event log and logs a warning: `/stream`, `/dev/events` and `/health` work, `/check`, `/reviews`
and `/recheck` answer 503 "database unreachable". Restart it once Atlas is reachable. `GET /health` shows
`{"database": "connected" | "unreachable" | "off", "events": "mongo" | "memory"}`. MongoDB calls time out after
`MONGODB_TIMEOUT_MS` (default 15000); the startup check waits `MONGODB_STARTUP_TIMEOUT_S` (default 10).

Without `MONGODB_URI` the server still runs on the in-memory event log (`/dev/events` and `/stream` work);
`/check` and `/reviews` answer 503 because they need the stored facts. `INLOOK_EVENTS=memory` forces the
in-memory log even with a database.

## Logs

Every request is logged with its JSON body and response, and every step of the check flow with its claim or
review id (Gemini spot / match / verdict, Context.dev scrape or search, tier routing, MongoDB writes, SSE
publishes), to stdout, so Render's Logs tab shows the whole flow (`app/flowlog.py`). `GET /health` is not
logged (Render polls it). `INLOOK_LOG_LEVEL` (default `INFO`) sets the level; `WARNING` keeps only problems.
uvicorn's own access log repeats each request in one line; start with `--no-access-log` to drop it.
`POST /reviews/{id}` records the decider from the dashboard's `x-inlook-user` header when it names a stored
person (there is no login yet), else `reviewer`.

## Endpoints

| Endpoint | State |
|---|---|
| `WS /audio/stream` | working: mic PCM → ElevenLabs realtime STT (`scribe_v3_live`, speaker labels) → `transcript.line` → Gemini spot (prefiltered, batched) → the check flow with source `audio` (`app/listen.py`). Needs `ELEVENLABS_API_KEY`; without it the audio is discarded. Rehearse with `uv run python -m app.replay fixtures/mic-demo.wav` |
| `POST /check` | working (publishes `claim.progress` steps between `claim.spotted` and the verdict): 202 at once, the flow runs in the background (`app/check.py`): claim → match → Context.dev scrape of the fact's page (or Context.dev search when it has none) → verdict → tier routing. Needs `GEMINI_API_KEY` and `CONTEXT_DEV_API_KEY`; without them every claim ends in `claim.unverified` |
| `POST /recheck` | `{factId}` or `{url}`: re-check now without a spoken claim (Context.dev scrape → verdict → tier routing). Events start with `claim.spotted` source `page`. 202, 404 unknown fact / url |
| `POST /webhooks/context` | Context.dev monitor deliveries: verifies `X-Context-Signature` against the stored monitor secrets (401), dedupes on event id, re-checks every fact on `data.change.url` in the background, 204 |
| `POST /reviews/{id}` | working: accept or reject, publishes `review.closed` (+ `fact.updated` on accept, `strategy.healthy`). 404 unknown, 409 already closed |
| `GET /stream` | working SSE: `<bootId>:<seq>` ids, Last-Event-ID replay, keep-alives. With MongoDB the log is the `events` collection, woken by a change stream, and survives restarts |
| `POST /dev/events` | only with `INLOOK_DEV=1`: inject an event to drive the overlay; 422 if it breaks the contract. With a database, `review.created` and `strategy.flagged` also change the seeded data, so Accept / Reject on mock cards works |
| `GET /health` | `{ok, database, events}`: whether Atlas answers, and where this run's event log lives |

## Layout

```
app/main.py              endpoints
app/config.py            env settings (see .env.example); also loads .env for the seed script and tests
app/contract.py          GENERATED from shared/*.schema.json (npm run gen:contract:py in overlay/); do not edit
app/events.py            event log + SSE; validates every event against the contract. EventLog (memory), MongoEventLog
app/check.py             the fact-check flow behind POST /check and the page re-checks, tier routing included
app/listen.py            the mic path behind WS /audio/stream: relay to ElevenLabs, transcript lines, speakers, spotting
app/replay.py            plays a 16 kHz mono recording into WS /audio/stream like the mic (rehearsals)
app/monitors.py          Context.dev monitor CLI: sync / status / run / peek
app/seed.py              loads seed.json into MongoDB (clears first, applies the tier floor)
seed.json                the demo records (people with roles, facts, strategies), spec "Data model"
app/services/db.py       MongoDB Atlas: client, indexes, fact / review / strategy helpers, event storage
app/services/gemini.py   Gemini calls: spot, match, verdict + card, vision (card schema from shared/)
app/services/context_dev.py  Context.dev API: scrape, search, monitors, webhook signature check
app/services/stt.py      ElevenLabs realtime speech-to-text session
fixtures/mic-demo.wav    two speakers: a question, then the Notion $8 claim (for app.replay)
tests/                   python -m unittest; check-flow tests run on a separate `inlook_test` database
```

## Data (MongoDB Atlas)

Records follow the spec's "Data model" and come from `seed.json` (`id` becomes `_id`). Reviews and messages
store person ids; events carry people as `{ id, name, role }` (`db.people`). `check.check_claim(text, quote,
source, speaker?, lineId?)` is the agreed entry point for a claim (fire and forget); a fact checked in the last
5 minutes answers a new claim from its last verdict instead of re-checking.

Collections: `facts`, `strategies`, `people`, `reviews`, `messages`, `events`, plus `counters` (one document,
the last event `seq`), `monitors` (Context.dev monitor id, url and webhook signing secret) and `webhook_events`
(delivered event ids, for dedup). A reseed clears neither `counters`, `monitors` nor `webhook_events`. Fields follow the spec's "Data model"; they are still a proposal. Ids match
`overlay/mock/*.json`. Indexes are created at startup (`db.ensure_indexes`).

- Tier rule: the floor (a fact any strategy uses is at least `medium`) is applied when the seed loads, and checked again at runtime.
- `events.seq` comes from the counter document. The seed reset clears `events` but not the counter, so seq
  stays monotonic and a running overlay keeps accepting events. Publishing is serialised by a lock (one backend process).
- Rejecting a review also clears its strategies' flags once nothing is pending (the spec only says so for accept).
- A `current` verdict reuses the card title "Fact updated" (the contract has no "still current" title).
- Seeded facts point at real public pages (Notion pricing, Apple return policy) with an older value, so the first
  re-check finds them outdated. The wifi fact has no page and goes through Context.dev search.
- Monitors run every 10 minutes at best, so the demo triggers `POST /recheck`; the monitor is the unattended path.

Not built: ElevenLabs relay.
