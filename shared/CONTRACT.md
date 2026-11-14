# Overlay ↔ backend contract

Source: `.plans/overlay-architecture-spec.md`. Schemas: `event.schema.json`, `card.schema.json`, `api.schema.json` (source). Generated from them: `overlay/src/shared/contract.gen.ts`, `backend/app/contract.py`. This file describes them; if they differ, the schemas win.

Status key:
- **decided**: stated in the spec or the task brief.
- **proposed**: shape filled in for the skeleton; agree with the backend owners before relying on it.
- **UNCONFIRMED**: depends on an unconfirmed component (MongoDB, Context.dev, embedding-first noticing).

## Transport (decided)

- Overlay → backend: HTTP POST; mic audio over a WebSocket (`WS /audio/stream`, proposed, see Endpoints).
- Backend → overlay: SSE on `GET /stream`. Every event has a `seq`; the SSE `id:` is `<bootId>:<seq>` (**proposed**; `bootId` is a random id per backend process). On reconnect the client sends `Last-Event-ID`. If it is `<currentBootId>:<n>` the backend replays seq > n, then follows; anything else (missing, another boot id, a bare number) replays the whole current log. So the stream survives a backend restart. The overlay scopes its seq de-dupe to the boot id. Keep-alive comments every ~15 s, no-buffering headers.
- Base URL: overlay reads `INLOOK_BACKEND_URL` (default `http://127.0.0.1:8000`).

## Endpoints

| Endpoint | Status | Request | Response |
|---|---|---|---|
| `WS /audio/stream` | proposed | WebSocket on the backend URL (http→ws, https→wss). One connection = one transcribing session: opened when transcribing starts, closed (code 1000) when it stops. Only binary frames, overlay → backend: raw PCM, signed 16-bit little-endian, mono, 16 kHz, 1600 samples (3200 B, 100 ms) each; no header, JSON or sequence number. If the socket drops mid-session the overlay reconnects after 1 s (a new connection = a new session); frames are dropped while the socket is not open or when > 320 KB is buffered. | Nothing server → client. Transcript lines and claims arrive as events. |
| `POST /check` | decided (body proposed) | JSON, one of: `{ "kind": "text", "text": "...", "source": "selection" \| "claim" }` or `{ "kind": "image", "mime": "image/png", "dataBase64": "...", "source": "screenshot" }` | `202 { "accepted": true, "checkId": "..." }`. Results arrive as events. |
| `POST /reviews/{id}` | decided (body proposed) | JSON `{ "decision": "accept" \| "reject" }` | `200 { "id": "...", "status": "accepted" \| "rejected" }` |
| `GET /stream` | decided | header `Last-Event-ID` (optional) | `text/event-stream` of events below |

## Event envelope (decided)

```json
{ "seq": 42, "type": "claim.verdict", "payload": { }, "at": "2026-11-14T10:00:00Z" }
```

SSE framing: `id: <bootId>:<seq>` (proposed) and `data: <envelope JSON>`. No `event:` line: the type is in the envelope, so a client reads every event from one `message` handler and a new event type needs no client change.

## Event types

| Type | Status | Payload | HUD shows |
|---|---|---|---|
| `transcript.line` | proposed | `{ lineId, speaker, text }` (speaker from ElevenLabs label, mapped to a name by a fixed list) | live transcript |
| `claim.spotted` | decided | `{ claimId, text, source: "audio" \| "selection" \| "screenshot", lineId? }` | amber "checking…" |
| `claim.unverified` | proposed | `{ claimId, reason: "no_match" \| "unverifiable" }` | claim marked unverified, then dropped |
| `claim.verdict` | decided (payload proposed) | `{ claimId, factId, verdict: "current" \| "outdated" \| "unverifiable", oldValue, newValue?, evidence, sourceUrl?, card }` | inline note / card |
| `fact.updated` | proposed | `{ factId, version: { value, source, at, by }, card }` (low tier, auto) | "updated" |
| `review.created` | proposed | `{ reviewId, factId, oldValue, newValue, evidence, tier, reviewers: [personId], card }` | review request, accept/reject when HUD is interactive |
| `review.closed` | proposed | `{ reviewId, factId, status: "accepted" \| "rejected" }` | review resolved |
| `strategy.flagged` | proposed | `{ strategyId, name, factId }` | flagged strategy |
| `strategy.healthy` | proposed | `{ strategyId, name }` | flag cleared |
| `message.created` | proposed | `{ messageId, to: [personId], strategyId, factId, text }` | Inlook message |

Fields marked `?` (and `checkId` in the `/check` 202 response) may be omitted or `null`; pydantic's default `model_dump()` writes unset optional fields as `null`.

## HUD card (decided)

Filled by Gemini in the verdict + card call; `card.schema.json` is the `responseSchema`.

| Field | Values | Rule |
|---|---|---|
| `title` | `"Fact outdated"`, `"Fact updated"`, `"Needs review"` | |
| `criticality` | `"low"`, `"medium"`, `"high"` | copied from the fact's stored `tier`; the backend checks it against `tier` before sending |
| `fact` | one line | e.g. `"Competitor X: €59 → €39 per seat"` |

## Tier routing (decided)

| Tier | Outcome | Reviewer | Events |
|---|---|---|---|
| low | new version saved at once | none | `claim.verdict`, `fact.updated` |
| medium | review created, fact `pending_review` | person who stated the fact | `claim.verdict`, `review.created` |
| high | review created, dependent strategies flagged, Inlook message to owners | strategy owners | `claim.verdict`, `review.created`, `strategy.flagged`, `message.created` |

Any fact a strategy relies on is at least medium.
