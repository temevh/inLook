# inLook

**inLook catches outdated facts in meetings, flags the strategies that depend on them, and notifies only their owners.**

Someone in a meeting says *"Notion Plus is eight dollars a seat, so we're clearly cheaper."* inLook hears it, finds the matching fact in company memory, re-reads the source page, and sees that the price is now $10. Because two strategies rely on that number, it flags both and asks just their owners to accept the new value. Everyone else keeps working.

> Hackathon build: about 24 hours, 2 to 3 people, with a 2-minute pitch video. All people, strategies and companies shown are **mock data**.

<p align="center">
  <img src="docs/images/desk-demo-after-meeting.png" alt="The inLook dashboard after a meeting: a pending high-tier review, a flagged strategy, the viewer's scope and every claim checked live" width="900">
</p>

---

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Demo data](#demo-data)
- [Screenshots](#screenshots)
- [Pitch visuals](#pitch-visuals)
- [Further reading](#further-reading)

---

## How it works

<p align="center">
  <img src="docs/images/viz-fact-check-flow.png" alt="Fact-check flow: input, spot claim, match fact, re-check source, verdict and HUD card, then routing by tier" width="900">
</p>

1. **Listen.** The desktop overlay streams the mic as 16 kHz PCM to the backend, which relays it to ElevenLabs realtime speech-to-text and gets transcript lines with speaker labels. A hotkey or widget button can also send highlighted text or a screenshot.
2. **Spot.** Gemini picks out fact-checkable claims from the transcript (prefiltered and batched to save quota).
3. **Match.** Each claim is matched to a stored fact in MongoDB.
4. **Re-check at the source.** The fact's source page is scraped through Context.dev (or searched for, when the fact has no page).
5. **Verdict.** Gemini decides whether the claim is current or outdated and writes a HUD card such as *"Outdated: $10 per seat"*.
6. **Route by tier.** What happens next depends on how much rides on the fact:

| Tier | What happens |
|---|---|
| **Low** | Updated automatically. A low fact that any strategy relies on is raised to medium. |
| **Medium** | A review goes to whoever stated the fact. |
| **High** | A review goes to every owner of every strategy relying on it. Each strategy is flagged once and its owners get an inLook message. |

A flagged strategy turns healthy again only when none of its facts is still in review. Facts are also watched without a meeting: Context.dev page monitors call a webhook when a source page changes, and `POST /recheck` re-checks a fact on demand.

<p align="center">
  <img src="docs/images/ripple-diagram.png" alt="How a change ripples: a fact, the strategies relying on it, and their owners" width="800">
</p>

---

## Features

**Desktop overlay (Electron)**
- Transparent HUD strip docked to a screen edge that is click-through everywhere except where it draws.
- Live transcript, one card per fact from "Checking…" to its outcome, with Accept / Reject by click or global hotkey.
- Small widget to toggle transcription, check the highlighted text, or check the screen.
- Hardened: strict CSP, context isolation, sandboxed renderers, validated IPC.

**Backend (FastAPI + MongoDB Atlas)**
- Realtime mic path over `WS /audio/stream` into ElevenLabs STT.
- Background fact-check flow with Gemini (spot, match, verdict, vision) and Context.dev (scrape, search, page monitors).
- Tier routing, strategy flags, reviews and messages, all stored in MongoDB.
- Server-sent event stream with replay (`Last-Event-ID`) backed by a MongoDB change stream, so it survives restarts.
- Every event is validated against a shared JSON-schema contract. Every step is logged with its claim id.
- Degrades gracefully: without a database it runs on an in-memory event log; a slow claim closes as "unverifiable".

**Dashboard (Vue 3 + Vite + Pinia)**
- **My desk**: reviews only you can decide, strategies at risk, facts in your scope, and your inbox.
- **Meetings**: the live transcript and every claim checked, plus a box to check a claim by hand.
- **Facts**: company memory with version history and a ripple diagram of who a change reaches.
- **Strategies** and **Activity** log.
- Hierarchy-aware scope: you see yourself and everyone below you in the reporting line.
- Notification bell and pop-ups, a "sign in as" switcher, and a responsive phone layout.
- A demo mode that needs nothing else, and a mock backend that prints every step the real backend would take.

---

## Architecture

<p align="center">
  <img src="docs/images/viz-architecture-simple.png" alt="Architecture at a glance: desktop, overlay app, inLook backend, AI services, data and sources" width="900">
</p>

```
                        Context.dev  (scrape · search · page monitors → webhook)
                             ▲
                             │
 Overlay (Electron) ──HTTP / WS audio──►  inLook backend (FastAPI)  ──►  ElevenLabs realtime STT
  HUD + widget       ◄──────SSE──────          │        │           ──►  Gemini (spot · match · verdict · vision)
                                               │        ▼
 Dashboard (Vue 3) ──POST actions────────────►  │   MongoDB Atlas  (facts · strategies · people · reviews · messages · events)
                   ◄──────SSE /stream──────────┘        ▲
                   ──GET /api/*──► Data API (Node + Prisma, read-only)    ┘
```

- The **overlay** sends audio, selections and screenshots to the backend and receives results over SSE.
- The **backend** is the only writer to MongoDB. It publishes every change as an event on `GET /stream`.
- The **dashboard** loads a snapshot from the read-only Prisma **data API** (`/api/*`, port 3001), then folds new events from the stream into it. Actions (accept, reject, re-check, check a claim) are POSTed to the backend and confirmed by the event that follows; nothing is optimistic.
- The wire contract (`shared/*.schema.json`) is the single source for event, card and request shapes. TypeScript types for the overlay and pydantic models for the backend are generated from it.

<details>
<summary><b>Detailed architecture</b></summary>
<p align="center"><img src="docs/images/viz-architecture.png" alt="Detailed architecture with every connection between overlay, backend, ElevenLabs, Gemini, MongoDB and Context.dev" width="900"></p>
</details>

<details>
<summary><b>Overlay internals</b></summary>
<p align="center"><img src="docs/images/viz-overlay-internals.png" alt="Overlay internals: Electron main process, widget and HUD windows, mic, X11 selection, screenshot and hotkey inputs" width="900"></p>
</details>

<details>
<summary><b>Data and sources</b></summary>
<p align="center"><img src="docs/images/viz-data-and-sources.png" alt="Data and sources: MongoDB collections, Context.dev and the options for keeping sources fresh" width="900"></p>
</details>

**Tech stack**

| Part | Stack |
|---|---|
| Overlay | Electron 45, TypeScript, AudioWorklet, `eventsource`, ajv, vitest. Debian on X11 |
| Backend | Python 3.12+, FastAPI, uvicorn, pydantic v2, pymongo, httpx, google-genai, websockets |
| AI and data services | Gemini, ElevenLabs realtime STT (`scribe_v3_live`), Context.dev, MongoDB Atlas |
| Dashboard | Vue 3, Vite, Pinia, Vue Router, Prisma 6 (MongoDB), tsx, vitest |
| Hosting | Backend and mock backend on Render, dashboard on Vercel |

---

## Repository layout

| Directory | What it is | Docs |
|---|---|---|
| [`overlay/`](overlay/) | Electron HUD + widget for Debian X11 | [overlay/README.md](overlay/README.md) |
| [`backend/`](backend/) | FastAPI backend: audio relay, fact-check flow, SSE, MongoDB, Context.dev monitors | [backend/README.md](backend/README.md) |
| [`frontend/`](frontend/) | Vue 3 dashboard, read-only Prisma data API and mock backend | [frontend/README.md](frontend/README.md) |
| [`shared/`](shared/) | HTTP/SSE contract (JSON schemas) between overlay, backend and dashboard | [shared/README.md](shared/README.md), [CONTRACT.md](shared/CONTRACT.md) |
| [`visualizations/visuals/`](visualizations/visuals/) | Static HTML pitch visuals and animated scenes | [PRODUCT.md](visualizations/visuals/PRODUCT.md) |
| [`scripts/`](scripts/) | Demo-laptop setup, sync, launch and reset scripts | header comment in each script |
| [`.plans/`](.plans/) | Architecture spec, the source of truth | [overlay-architecture-spec.md](.plans/overlay-architecture-spec.md) |

Project notes: [`PRODUCT.md`](PRODUCT.md) (product and brand), [`DECISIONS.md`](DECISIONS.md) (decisions log), [`TODO.md`](TODO.md).

---

## Getting started

### Quickest look: dashboard demo mode

Needs only Node.js (22 recommended).

```bash
cd frontend
npm install            # also runs prisma generate
npm run dev:demo       # http://localhost:5173 with built-in mock data
```

Click **Play meeting** to replay a scripted meeting and watch the claims get checked, reviews appear and strategies get flagged. Switch person with the name in the top bar, or add `?user=p-casey` to the URL.

To see what the backend would do for every action, run the mock backend alongside it:

```bash
npm run mock           # terminal 1: mock backend on http://localhost:8787
npm run dev:demo       # terminal 2: demo mode finds it through /mock
```

### Backend

Needs Python 3.12+ ([uv](https://docs.astral.sh/uv/) recommended) and, for the full flow, MongoDB Atlas plus Gemini, Context.dev and ElevenLabs keys.

```bash
cd backend
uv sync                     # or: python3 -m venv .venv && .venv/bin/pip install -e .
cp .env.example .env        # then fill in your keys
uv run python -m app.seed   # load seed.json into MongoDB (also resets the demo)
uv run uvicorn app.main:app --env-file .env --reload    # http://localhost:8000
uv run python -m unittest   # tests
```

Rehearse the mic path without a microphone: `uv run python -m app.replay fixtures/mic-demo.wav`. Context.dev monitor commands (`peek`, `sync`, `status`) and the full endpoint list are in [backend/README.md](backend/README.md).

### Dashboard in live mode

```bash
cd frontend
cp .env.example .env   # DATABASE_URL must include the database name, e.g. .../inlook
npm run api            # read-only data API on http://localhost:3001
npm run dev            # dashboard on http://localhost:5173
```

The dashboard talks to the hosted backend by default; set `INLOOK_BACKEND_URL=http://127.0.0.1:8000` to use a local one. The **Live / Demo** switch in the top bar changes mode at any time.

### Overlay (Debian, X11 session)

Needs an X11 session with a compositor for transparency (Mutter on GNOME, or `picom`).

```bash
cd overlay
npm install
INLOOK_BACKEND_URL=http://127.0.0.1:8000 npm start
npm run mock           # optional: play a scripted scenario (needs INLOOK_DEV=1 on the backend)
```

Default hotkeys: **Ctrl+Alt+K** check now (selection, else screen), **Ctrl+Alt+A** accept, **Ctrl+Alt+R** reject.

### Tests

| Part | Command |
|---|---|
| Backend | `cd backend && uv run python -m unittest` |
| Dashboard | `cd frontend && npm test` (also `npm run typecheck`, `npm run build`) |
| Overlay | `cd overlay && npm test` |

### Changing the contract

Edit `shared/*.schema.json`, then regenerate from `overlay/`:

```bash
npm run gen:contract      # TypeScript → overlay/src/shared/contract.gen.ts
npm run gen:contract:py   # pydantic v2 → backend/app/contract.py
```

---

## Environment variables

Copy each `.env.example` to `.env`. Never commit real keys. Defaults and comments are in the example files.

**Backend** (`backend/.env`)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini key and model |
| `GEMINI_TIMEOUT_S`, `GEMINI_ATTEMPTS`, `CHECK_TIMEOUT_S` | Per-attempt timeout, attempts per call, and time a claim gets to reach a verdict |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` | Realtime speech-to-text |
| `STT_LANGUAGE`, `STT_VAD_SILENCE_S` | Transcript language and the pause that ends a line |
| `INLOOK_SPEAKERS` | Names given to speakers in the order they first speak |
| `SPOT_DEBOUNCE_S`, `SPOT_PREFILTER` | Claim-spotting batching and prefilter |
| `MONGODB_URI`, `MONGODB_DB` | MongoDB Atlas connection (empty runs on the in-memory event log) |
| `MONGODB_TIMEOUT_MS`, `MONGODB_STARTUP_TIMEOUT_S` | Database timeouts |
| `INLOOK_EVENTS` | `memory` forces the in-memory event log |
| `INLOOK_DEV` | Enables `POST /dev/events` for injecting events |
| `INLOOK_LOG_LEVEL` | Log level of the request and check-flow log |
| `CONTEXT_DEV_API_KEY` | Context.dev scrape, search and monitors |
| `PUBLIC_BASE_URL` | Public URL of the backend for Context.dev webhooks |

**Dashboard** (`frontend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MongoDB Atlas connection string for the Prisma data API |
| `PORT` | Data API port (3001) |
| `INLOOK_API_URL`, `INLOOK_BACKEND_URL`, `INLOOK_MOCK_URL` | Vite dev-proxy targets (optional) |
| `VITE_INLOOK_USER` | Signed-in person id until there is a login (default `p-ada`) |
| `MOCK_PORT` | Mock backend port (8787) |

**Overlay** (shell environment)

| Variable | Purpose |
|---|---|
| `INLOOK_BACKEND_URL` | Backend base URL |
| `INLOOK_HOTKEY`, `INLOOK_ACCEPT_HOTKEY`, `INLOOK_REJECT_HOTKEY` | Global hotkeys |
| `INLOOK_HUD_EDGE`, `INLOOK_HUD_WIDTH` | HUD position and width |

---

## Demo data

<p align="center">
  <img src="docs/images/demo-data-graph.png" alt="Demo data: five people, three strategies and five facts, showing who owns what and what relies on what" width="900">
</p>

The demo company has five people three levels deep, three strategies and five facts. Seeded facts point at real public pages (Notion pricing, Apple's return policy) with an older value, so the first re-check finds them outdated.

| Fact | Tier | Stated by | Strategies | What the demo shows |
|---|---|---|---|---|
| Notion Plus price | high | Sam | Pricing Plan, 2027 Budget | Both owners (Ada, Casey) decide; two strategies flagged |
| EUR/USD rate | high | Ada | 2027 Budget | Casey decides, not Ada who stated it |
| Apple return window | medium | Sam | Support Plan | Sam decides; rejected once before |
| Weekly support tickets | low → medium | Sam | Support Plan, 2027 Budget | Raised to medium because strategies rely on it |
| Office wifi | low | Mira | none | Updated automatically |

Good people to sign in as: `p-ada` (default), `p-casey` (CEO, decides the most), `p-noor` (COO), `p-sam` (Support Lead), `p-mira` (no strategy). A step-by-step demo walkthrough is in [frontend/README.md](frontend/README.md#mock-data).

---

## Screenshots

**Meetings**: the transcript and every claim inLook checked, newest first.

<img src="docs/images/meetings.png" alt="Meetings view with transcript and claim cards marked outdated, current, unverifiable and unverified" width="900">

| | |
|---|---|
| <img src="docs/images/desk-layout-ada.png" alt="My desk for Ada with two pending reviews"><br>**My desk**: reviews only you can decide, your strategies, scope and inbox | <img src="docs/images/desk-signed-in-noor.png" alt="My desk signed in as Noor, the COO"><br>**Scoped by hierarchy**: signed in as the COO, seeing their team's work |
| <img src="docs/images/bell.png" alt="Notification bell with review requests and messages"><br>**Notification bell**: each item links straight to its action | <img src="docs/images/colleague-decided.png" alt="A pop-up saying a colleague accepted a change"><br>**Colleagues decide too**: a pop-up when someone else accepts a change |
| <img src="docs/images/ripple.png" alt="Facts page with version history and ripple diagram"><br>**Facts**: company memory, version history and who a change reaches | <img src="docs/images/desk-ada-after-accept.png" alt="My desk after accepting a change"><br>**After a decision**: the strategy heals and the inbox records it |
| <img src="docs/images/desk-demo-ada.png" alt="My desk in demo mode with the person switcher"><br>**Demo mode**: switch person without losing the demo | <img src="docs/images/mobile-preview.png" alt="The dashboard at phone width"><br>**Responsive**: the dashboard on a phone |

**Mock backend terminal**: every request with who sent it, each step the real backend would take, and the response.

<img src="docs/images/mock-backend-terminal.png" alt="Terminal output of the mock backend showing Gemini, Context.dev, routing, MongoDB and SSE steps for each request" width="900">

---

## Pitch visuals

`visualizations/visuals/` holds static HTML visuals made for the pitch video, showing the parts of inLook beyond the hackathon build (the company-wide flow, dashboards and the "one shared memory" story). Each file opens on its own in a browser; `all-visuals.html` shows them all.

| | |
|---|---|
| <img src="docs/images/viz-scene-06-live-check.png" alt="Scene: inLook checks claims while the meeting is still going"><br>*inLook checks claims while the meeting is still going.* | <img src="docs/images/viz-scene-08-flag.png" alt="Scene: a high-criticality fact goes stale and only its strategies are flagged"><br>*A high-criticality fact goes stale. Only its strategies are flagged.* |
| <img src="docs/images/viz-scene-09-notify.png" alt="Scene: only the owners are asked to review"><br>*Only its owners are asked to review. Everyone else keeps working.* | <img src="docs/images/viz-scene-04-routing.png" alt="Scene: each fact reaches only the people who rely on it"><br>*Each fact reaches only the people who rely on it.* |

<details>
<summary><b>Organisation-wide flow concepts</b></summary>

| | |
|---|---|
| <img src="docs/images/viz-bloom.png" alt="Bloom: data radiating through the organisation"><br>**Bloom**: data radiating through the organisation | <img src="docs/images/viz-transit.png" alt="Transit: the organisation as a line map"><br>**Transit**: the organisation as a line map |
| <img src="docs/images/viz-tributary.png" alt="Tributary: from sources to people"><br>**Tributary**: from sources to people | <img src="docs/images/viz-network.png" alt="Network: one message moving between branches"><br>**Network**: one message moving between branches |

</details>

---

## Further reading

- [Architecture spec](.plans/overlay-architecture-spec.md): scope, components, data model, fact-check flow and tier rules
- [Wire contract](shared/CONTRACT.md): endpoints, event envelope, event types and the HUD card
- [Backend](backend/README.md): endpoints, logs, MongoDB collections, Context.dev monitors
- [Dashboard](frontend/README.md): how the snapshot and stream work, scope rules, mock data, deploying the mock backend
- [Overlay](overlay/README.md): layout, security model, demo-laptop scripts
- [Decisions](DECISIONS.md) and [TODO](TODO.md)

Future work claimed in the pitch: record and replay inputs, saving new facts from meetings, Slack and other integrations, multiple users with their own overlays, a strategy editor, and passive screen capture.
