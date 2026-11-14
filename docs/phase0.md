# Phase 0: lock the contract

## What was done

- `shared/event.schema.json` is the single source for SSE events: envelope `{seq, type, payload, at}` as a `oneOf` discriminated by `type`, payloads as in `CONTRACT.md`, `card` as `$ref` to `card.schema.json`.
- `shared/card.schema.json`: `$comment` replaced by `title`/`description` (Gemini's `responseSchema` rejects `$comment`). Fields unchanged.
- New `shared/api.schema.json`: `/check` body, `/reviews/{id}` body and response, 202 accepted response.
- TypeScript types and Python models are generated from the schemas.
- `overlay/src/shared/contract.ts` is now a thin re-export plus `EVENT_TYPES`, derived helper types and the `AudioChunk` IPC type.
- Review fix: optional fields (`claim.spotted.lineId`, `claim.verdict.newValue`, `claim.verdict.sourceUrl`, `checkId` in the 202 response) accept `null` as well as being omitted, because pydantic's default `model_dump()` writes unset optional fields as `null` and the overlay validator would otherwise drop those events.
- Installed for later phases: `eventsource`, `ajv`, `ajv-formats`, `@fontsource-variable/rethink-sans`, `@fontsource/doto`, dev `json-schema-to-typescript`, `vitest`. Added `npm test`.

## Why

`CONTRACT.md`, `contract.ts` and `contract.py` were three hand-kept copies that drift. One schema now feeds the generated types, runtime validation (ajv, next phase) and mock fixtures.

## Files

- `shared/event.schema.json`, `shared/card.schema.json`, `shared/api.schema.json`
- `overlay/scripts/gen-contract.mjs`
- `overlay/src/shared/contract.gen.ts` (generated), `overlay/src/shared/contract.ts`
- `shared/generated/contract_models.py` (generated)
- `backend/app/contract.py`: untouched.

## Regenerate

From `overlay/`:

```sh
npm run gen:contract      # → src/shared/contract.gen.ts
npm run gen:contract:py   # → ../shared/generated/contract_models.py
```

The Python step uses `datamodel-codegen` from PATH, else `uvx`, else `nix run`. Both outputs are checked in.

## Open

- Payload shapes marked "proposed" in `CONTRACT.md` are not agreed with the backend owners.
- The backend still uses its hand-written `backend/app/contract.py`; the generated models are not adopted yet.
