# inLook overlay architecture spec

Hackathon build: ~24 h, 2–3 people, 2-minute pitch video. One user on one machine; a second machine only if time allows.
inLook catches outdated facts in meetings, flags the strategies that depend on them and notifies only their owners.
Dashboards, fact browsing and the company-wide flow are pre-made visuals in `visualizations/visuals/`, not built.

Ownership: Ant builds the overlay (`overlay/`) and the HTTP/SSE contract (`shared/`). Others own the backend internals, the database and the Context.dev integration.

**UNCONFIRMED** marks anything not decided yet: all of MongoDB (hosting, collections, fields, change stream), all of Context.dev, and embedding-first claim noticing versus Gemini spotting claims first.

## Scope

Built and working live in the demo:

1. Mic → ElevenLabs STT → live transcript with speaker labels in the HUD → Gemini flags fact-checkable claims.
2. Claim → matching stored fact → re-check at the source (Context.dev, UNCONFIRMED) → Gemini verdict ("Outdated: €39").
3. Screen read on demand: widget button sends the X11 selection or a screenshot to Gemini.
4. Tiered update and strategy flag: low tier auto-updates, higher tiers go to review, dependent strategies are flagged and their owners get an Inlook message.

Claimed as future work (pitch only): `live / record / replay` input adapters (live built first), saving new facts from meetings, Slack and other app integrations, multiple users with their own overlays, a real dashboard and strategy editor, passive screen capture, ElevenLabs voice.

## Platform

- Debian, **X11 session** (not Wayland). X11 allows screenshots, reading the selection, always-on-top transparent windows and click-through without portal prompts.
- Transparency needs a compositor: GNOME on X11 (Mutter) has one; a bare window manager needs `picom`.
- No browser extension.

## Components

```
            Context.dev (UNCONFIRMED)
                 ▲ fetch source page
                 │
Overlay app ◄─SSE── Inlook backend ──► MongoDB (UNCONFIRMED)
(Electron)  ──HTTP──►     │
  mic PCM (WS),           ├──► ElevenLabs STT (transcript, speaker labels)
  selection, screenshots  └──► Gemini (claims, match, verdict + card, vision)
  windows: HUD + widget
```

Data flows overlay → backend over HTTP; results come back over SSE.

### Overlay app (Electron)

One Electron app is both the "overlay backend" and "overlay frontend" from the sketch.

- **Main process** (overlay backend):
  - Mic capture: `getUserMedia` + an AudioWorklet run in the widget renderer (they exist only in renderers). **Proposed change:** the worklet makes 100 ms frames of 16 kHz mono s16le PCM, sent to main over IPC; main streams them over `WS /audio/stream` to the backend (ElevenLabs realtime STT takes a continuous stream; the earlier ~10 s Opus chunks with ~1 s overlap added ~10 s of delay and duplicated words).
  - Selection read: `clipboard.selection.readText()` (Electron 45) reads the X11 PRIMARY selection (highlighted text, no copy needed).
  - Screenshot: `desktopCapturer` for the screen or the active window, only when the widget asks.
  - Global hotkey (`globalShortcut`) for "check now".
- **HUD window**: transparent, frameless, always on top, docked as a side strip on one screen edge.
  - Default `setIgnoreMouseEvents(true)`: fully click-through. On Linux the `forward` option does not work, so hover cannot wake it.
  - Shows: live transcript, flagged claims (amber "checking…"), verdicts, fact version changes, review requests, Inlook messages.
- **Widget window**: small, always on top, normal mouse input, slight opacity.
  - Buttons: transcribe on/off, check selection, check screen, toggle HUD interactive.
  - "Toggle HUD interactive" switches the HUD to accept clicks (for accept/reject on reviews), then back to click-through.

### Inlook backend

- **Language: Python, FastAPI.** Gemini through `google-genai`. Goblin Drill's SSE code ports almost directly.
- Wire format of every endpoint and event: `shared/CONTRACT.md`.
- Endpoints:
  - `WS /audio/stream` — **proposed.** Continuous PCM frames in; transcript lines and claims come out as events. Replaces `POST /audio` (10 s webm chunks, deprecated).
  - `POST /check` — text or image in (selection, screenshot, or a single claim).
  - `POST /reviews/:id` — accept or reject a pending change.
  - `POST /webhooks/context` — **UNCONFIRMED.** Context.dev page-change notification; re-checks the facts that use that page.
  - `GET /stream` — SSE, every event with a `seq`; SSE `id` is `<bootId>:<seq>` (**proposed**), replay with `Last-Event-ID`; another boot id replays the whole log.
- The live-update pattern comes from Goblin Drill (`routes_live.py:272`, `sim/live.py:55`): append-only event log with a sequence cursor, SSE replay-then-follow, keep-alives, no-buffering headers. The skeleton keeps the log in memory; the boot id keeps clients working across a backend restart. **UNCONFIRMED:** an `events` collection in MongoDB and a change stream in place of the 500 ms poll.

### Database

- Strategies and people are **mock data**, seeded by a script.
- **UNCONFIRMED:** MongoDB on the Atlas free tier (change streams without setting up a replica set), with `pymongo` (async).

### Gemini

SDK: `google-genai` (Python). Structured JSON output (`responseSchema`) on every call. Models may be swapped later.

| Use | Model |
|---|---|
| Transcription | ElevenLabs STT (realtime, speaker labels) |
| Claims, matching, verdicts, screenshots, HUD cards | `gemini-3.8-flash` |
| Large fact sets | `gemini-embedding-2` |
| Voice (future) | ElevenLabs |

| Call | Input | Output |
|---|---|---|
| Spot | transcript lines | claims marked fact-checkable (**UNCONFIRMED:** or embeddings notice claims first) |
| Match | claim, list of stored facts (mock set is small, send all) | matching `factId` or none |
| Verdict + card | stored fact, its `tier`, source page content, HUD card template | `current` / `outdated` / `unverifiable`, new value, evidence snippet, filled card |
| Vision | screenshot | claims, same shape as spot |

**HUD cards.** The backend sends Gemini the card template as the `responseSchema` along with the fact info, in the same call as the verdict. Gemini returns the filled fields (no category):

- **Title:** "Fact outdated", "Fact updated" or "Needs review".
- **Criticality:** copied from the stored `tier`. The backend checks it against `tier` before sending the card to the HUD.
- **Fact:** one line, e.g. "Competitor X: €59 → €39 per seat".

Transcription is not a Gemini call: ElevenLabs STT returns transcript lines with speaker labels, which go to the spot call. For the demo, speaker labels are mapped to names by a fixed list.

### Context.dev (UNCONFIRMED)

Everything in this section is UNCONFIRMED.

- Re-fetches the fact's stored `sourceUrl` and returns the page content for the verdict call.
- If no URL is stored, it searches the web for the claim.
- Exact API and limits still need checking before the build.
- **Page watching:** Context.dev watches each fact's `sourceUrl` and calls `POST /webhooks/context` when the page changes. The backend finds every fact with that `sourceUrl` and runs the verdict + card call, so a stale fact is flagged without anyone saying it.
  - One watch per `sourceUrl`, registered when a fact is saved.
  - Needs a public backend URL during the demo (tunnel or deployed host).
  - Fallback if Context.dev has no watching, or checks too slowly for the demo: the backend re-fetches every `sourceUrl` itself every N minutes, with the same verdict flow.

## Data model (UNCONFIRMED)

Collections and fields are a proposal. The tier rules and routing in the next section are decided.

```
facts       { _id, key, label, value, unit, tier: low|medium|high, sourceUrl,
              statedBy, statedIn, statedAt, versions: [{ value, source, at, by }],
              status: current|outdated|pending_review }
strategies  { _id, name, owners: [personId], factIds: [factId], status: healthy|flagged }
people      { _id, name, team }
reviews     { _id, factId, oldValue, newValue, evidence, tier, reviewers: [personId],
              status: pending|accepted|rejected }
messages    { _id, to: [personId], strategyId, factId, text, at }
events      { seq, type, payload, at }   // SSE source, written for every change
```

## Fact-check flow

1. Claim spotted (audio chunk, selection, or screenshot) → event `claim.spotted`, HUD shows "checking…".
2. Gemini matches the claim to a stored fact. No match → claim shown as unverified and dropped.
3. The source is re-checked (Context.dev, UNCONFIRMED) → Gemini verdict → event `claim.verdict`, HUD shows the inline note.
4. If outdated, route by tier:

| Tier | What happens | Reviewer |
|---|---|---|
| Low | New version saved right away, HUD shows "updated" | none |
| Medium | Review created, fact `pending_review` | the person who stated the fact |
| High | Review created, dependent strategies flagged, Inlook message sent | the owners of the dependent strategies |

### Tier rules

- Mostly **stored per fact** in the mock data.
- Floor from dependencies: a fact that any strategy relies on is at least medium. Only facts no strategy uses can be low.

### Strategy flag and notify

- A strategy is flagged when any of its facts is outdated or in review at high tier. Only that fact's block turns red (scene 08).
- One Inlook message goes to the strategy's owners only (scene 09). With one user, it arrives in that user's HUD.

### Review outcome

- On accept: new version appended to `versions`, fact back to `current`, strategy back to `healthy` once no fact is pending.
- On reject: the fact keeps its value and the review is closed.
- In the single-user demo, the current user stands in for the reviewer.

## Demo script mapping

| Visual | Live part |
|---|---|
| scenes 01–04 (capture, memory, strategy, routing) | pre-made visuals |
| scene 05 (world changes) | the source page changes (detection by Context.dev is UNCONFIRMED) |
| scene 06 (live check) | built: mic → claim → verdict in the HUD |
| scene 07 (version history) | built: new version in the fact, shown in the HUD |
| scenes 08–09 (flag, notify) | built: high-tier flag and HUD message |
| scene 10 (one memory) | pre-made visual |

## Open items

- Context.dev API surface and rate limits, whether it offers page watching, and how often it checks.
- ElevenLabs STT latency and whether its realtime mode returns speaker labels.
- Which real public page is the demo source.
- MongoDB hosting, collections, fields and change stream.
- Embedding-first claim noticing versus Gemini spotting claims first.
