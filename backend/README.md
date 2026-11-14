# backend

Inlook backend: Python FastAPI. Owned by others; this is a skeleton with stubbed endpoints.
Spec: `.plans/overlay-architecture-spec.md`, "Inlook backend". Wire contract: `shared/CONTRACT.md`.

## Run

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -e .            # add .[mongo] once MongoDB is confirmed
cp .env.example .env        # fill keys; env is read from the process (no dotenv loader yet)
INLOOK_DEV=1 uvicorn app.main:app --reload
```

## Endpoints

| Endpoint | State |
|---|---|
| `POST /audio` | accepts multipart chunk, returns 202; pipeline TODO |
| `POST /check` | accepts text or image JSON, returns 202; pipeline TODO |
| `POST /reviews/{id}` | 501, needs db (UNCONFIRMED) |
| `POST /webhooks/context` | 501, UNCONFIRMED |
| `GET /stream` | working SSE over an in-memory event log: seq ids, Last-Event-ID replay, keep-alives |
| `POST /dev/events` | only with `INLOOK_DEV=1`: inject an event to drive the overlay |
| `GET /health` | ok |

## Layout

```
app/main.py               endpoints
app/config.py             env settings (see .env.example)
app/contract.py           pydantic mirror of shared/CONTRACT.md
app/events.py             event log + SSE (in-memory stand-in for the Mongo change stream)
app/tiers.py              tier floor and routing outcome (decided rules)
app/services/gemini.py    gemini-3.8-flash spot/match/verdict+card/vision, gemini-embedding-2; card schema from shared/
app/services/stt.py       ElevenLabs STT with speaker labels
app/services/context_dev.py  UNCONFIRMED
app/services/db.py        UNCONFIRMED (MongoDB Atlas)
```

## UNCONFIRMED

- MongoDB (Atlas): hosting, collections and fields, the change stream feeding SSE.
- Embedding-first claim noticing vs Gemini spotting claims first.
- All of Context.dev: API, re-fetch vs search, page watching with `POST /webhooks/context`, the polling fallback.
