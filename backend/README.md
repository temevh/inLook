# backend

Inlook backend: Python FastAPI. Owned by others; a skeleton with stubbed endpoints.
Spec: `.plans/overlay-architecture-spec.md`, "Inlook backend". Wire contract: `shared/CONTRACT.md`.

## Run

```sh
uv sync                     # or: python3 -m venv .venv && .venv/bin/pip install -e .
cp .env.example .env        # fill keys
uv run uvicorn app.main:app --env-file .env --reload
uv run python -m unittest   # tests
```

## Endpoints

| Endpoint | State |
|---|---|
| `WS /audio/stream` | accepts a PCM session and discards the frames; ElevenLabs relay TODO |
| `POST /check` | validates text or image JSON, returns 202; pipeline TODO |
| `POST /reviews/{id}` | 501, needs fact storage |
| `GET /stream` | working SSE over an in-memory event log: `<bootId>:<seq>` ids, Last-Event-ID replay, keep-alives |
| `POST /dev/events` | only with `INLOOK_DEV=1`: inject an event to drive the overlay; 422 if it breaks the contract |
| `GET /health` | ok |

## Layout

```
app/main.py             endpoints
app/config.py           env settings (see .env.example)
app/contract.py         GENERATED from shared/*.schema.json (npm run gen:contract:py in overlay/); do not edit
app/events.py           event log + SSE; validates every event against the contract
app/services/gemini.py  Gemini calls (stubs); card schema from shared/
tests/                  python -m unittest
```

Data model and `check_claim`: the spec, "Data model". Not decided: Context.dev source re-checks and page watching.
