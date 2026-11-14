# inLook TODO

## Backend not built
- ElevenLabs relay in `WS /audio/stream`
- `POST /webhooks/context` and page watching (or a polling fallback)
- Live check of the Gemini calls: `spot`, `match`, `verdict_card`, `vision` are written but were only run against fakes (no `GEMINI_API_KEY` yet; the model name `gemini-3.8-flash` is unverified)

## Built, on MongoDB Atlas
- `/check` pipeline and tier routing (`backend/app/check.py`)
- `POST /reviews/{id}`
- Event log in MongoDB with a change stream (`backend/app/events.py`)
- Seed script and tests (`python -m app.seed`, `python -m unittest`)

## Undecided
- Storage: MongoDB Atlas is what the code uses now; confirm it, and the field names
- Context.dev re-checks and page watching (`backend/app/services/source.py` is a plain-GET stand-in)
- Demo source page
- A card title for "claim is still current" (now reuses "Fact updated")
- Payloads marked "proposed" in `shared/CONTRACT.md`
