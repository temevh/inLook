# shared: overlay ↔ backend contract

The single source for the wire contract. The overlay (`overlay/src/shared/contract.ts`) and the backend (`backend/app/contract.py`) mirror this file by hand; change it here first, then both mirrors.

- `CONTRACT.md`: endpoints, event envelope, event types, HUD card.
- `card.schema.json`: the HUD card template. The backend sends it to Gemini as `responseSchema` in the verdict + card call.
- `event.schema.json`: the SSE event envelope and payloads.

Source: `.plans/overlay-architecture-spec.md`.
