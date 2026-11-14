# Overlay ↔ backend contract

Source: `.plans/overlay-architecture-spec.md`. Schemas: `event.schema.json`, `card.schema.json`, `api.schema.json` (source). Generated from them: `overlay/src/shared/contract.gen.ts`, `shared/generated/contract_models.py`. This file describes them; if they differ, the schemas win.

Status key:
- **decided**: stated in the spec or the task brief.
- **proposed**: shape filled in for the skeleton; agree with the backend owners before relying on it.
- **UNCONFIRMED**: depends on an unconfirmed component (MongoDB, Context.dev, embedding-first noticing).

## Transport (decided)

- Overlay → backend: HTTP POST.
- Backend → overlay: SSE on `GET /stream`. Every event has a `seq` id (sent as the SSE `id:`). On reconnect the client sends `Last-Event-ID`; the backend replays everything after it, then follows. Keep-alive comments every ~15 s, no-buffering headers.
- Base URL: overlay reads `INLOOK_BACKEND_URL` (default `http://127.0.0.1:8000`).

## Endpoints

| Endpoint | Status | Request | Response |
|---|---|---|---|
| `POST /audio` | decided (body proposed) | `multipart/form-data`: `chunk` (audio/webm;codecs=opus, ~10 s, ~1 s overlap), `startedAt` (ISO time), `seqNo` (int, per session) | `202 { "accepted": true }`. Transcript lines and claims arrive as events. |
| `POST /check` | decided (body proposed) | JSON, one of: `{ "kind": "text", "text": "...", "source": "selection" \| "claim" }` or `{ "kind": "image", "mime": "image/png", "dataBase64": "...", "source": "screenshot" }` | `202 { "accepted": true, "checkId": "..." }`. Results arrive as events. |
| `POST /reviews/{id}` | decided (body proposed) | JSON `{ "decision": "accept" \| "reject" }` | `200 { "id": "...", "status": "accepted" \| "rejected" }` |
| `GET /stream` | decided | header `Last-Event-ID` (optional) | `text/event-stream` of events below |
| `POST /webhooks/context` | **UNCONFIRMED** | Context.dev page-change notification; shape unknown | not called by the overlay |

## Event envelope (decided)

```json
{ "seq": 42, "type": "claim.verdict", "payload": { }, "at": "2026-11-14T10:00:00Z" }
```

SSE framing: `id: <seq>`, `event: <type>`, `data: <envelope JSON>`.

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
