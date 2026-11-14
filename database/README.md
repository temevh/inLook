# database

**UNCONFIRMED: everything in this folder.** MongoDB (Atlas) is the spec's plan, but hosting, collections, fields and the change stream feeding SSE are not decided. Owned by others.

- Proposed collections: `.plans/overlay-architecture-spec.md`, "Data model".
- Tier rules and routing (decided): same spec, "Fact-check flow".
- Event types and payloads: `shared/CONTRACT.md`.
- Strategies and people are mock data.

## Open (UNCONFIRMED)

- Indexes: likely unique `events.seq`, `facts.key`, `facts.sourceUrl`.
- How `events.seq` is allocated (counter document or other).
- Change stream on `events` replacing the backend's in-memory log (`backend/app/events.py`).
- Vector index for `gemini-embedding-2`, only if embedding-first claim noticing is chosen.

## Seed

`seed/`: location for the mock-data seed script. Empty on purpose. See `seed/README.md`.
