# shared: overlay ↔ backend contract

The single source for the wire contract. The JSON schemas here are the source; the overlay's TypeScript types and the Python models are generated from them. Change a schema here, then regenerate (see below). Do not edit generated files.

- `CONTRACT.md`: endpoints, event envelope, event types, HUD card (prose).
- `event.schema.json`: the SSE event envelope and payloads, discriminated by `type`.
- `card.schema.json`: the HUD card template. The backend sends it to Gemini as `responseSchema` in the verdict + card call.
- `api.schema.json`: `/check` body, `/reviews/{id}` body and response, 202 accepted response.
Generated, checked in, do not edit: `overlay/src/shared/contract.gen.ts` (TypeScript) and `backend/app/contract.py` (pydantic v2; the backend validates every event with it before sending).

## Regenerate

From `overlay/`:

```sh
npm run gen:contract      # → overlay/src/shared/contract.gen.ts
npm run gen:contract:py   # → backend/app/contract.py
```

Both outputs are checked in. `gen:contract:py` needs `datamodel-codegen` on PATH, or `uvx`, or `nix`.

Source: `.plans/overlay-architecture-spec.md`.
