# overlay

Electron + TypeScript overlay for Debian, X11 session: a click-through HUD side strip and an interactive widget. Owner: Ant.
Spec: `.plans/overlay-architecture-spec.md`, "Overlay app (Electron)". Wire contract: `shared/CONTRACT.md`.

## Run

```sh
npm install
npm run typecheck
INLOOK_BACKEND_URL=http://127.0.0.1:8000 npm start   # builds, then launches with --ozone-platform=x11
```

Needs an X11 session with a compositor for transparency (Mutter on GNOME, or `picom`).

| Env | Default | |
|---|---|---|
| `INLOOK_BACKEND_URL` | `http://127.0.0.1:8000` | backend base URL |
| `INLOOK_HOTKEY` | `CommandOrControl+Alt+K` | global "check now": selection if any, else screen |
| `INLOOK_HUD_EDGE` | `right` | `left` or `right` |
| `INLOOK_HUD_WIDTH` | `380` | px |

## Layout

```
src/
  shared/contract.gen.ts  GENERATED event, card and request types (from shared/*.schema.json)
  shared/contract.ts   re-exports contract.gen.ts, plus EVENT_TYPES, helper types, AudioChunk (IPC)
  shared/ipc.ts        preload bridge types (window.inlook)
  main/main.ts         app entry: windows, IPC, SSE, hotkey; event backlog replayed to windows on load
  main/config.ts       env settings (table above)
  main/windows.ts      HUD + widget BrowserWindows, HUD interactive toggle
  main/backend-client.ts  POST /audio, /check, /reviews/:id
  main/sse.ts          GET /stream via the `eventsource` package, Last-Event-ID replay, seq de-dupe, re-create 3 s after fatal errors
  main/validate.ts     ajv check of every incoming event against shared/event.schema.json; invalid ones are dropped with a warning
  main/selection.ts    X11 PRIMARY selection read
  main/screenshot.ts   desktopCapturer capture of the display under the cursor, downscaled before upload
  preload/preload.ts   contextBridge → window.inlook
  renderer/hud/        HUD strip: transcript, checking/verdict/review/strategy/message cards
  renderer/widget/     buttons + mic.ts (10 s Opus chunks, 1 s overlap)
mock/
  demo.json            7 events, pitch scenes 06–09
  tiers.json           10 events: low, medium, unverified, review closed, strategy healthy
scripts/
  mock.mjs             validates a scenario, POSTs it to the backend's /dev/events
  audio-sink.mjs       dev stand-in for POST /audio
  gen-contract.mjs     schema → TS / Python types
  copy-static.mjs      build step: shared/*.schema.json → dist/schemas/, .woff2 fonts from src/renderer
```

Build output: `dist/main`, `dist/preload`, `dist/shared` (CommonJS) and `dist/web` (renderer ES modules + HTML/CSS).

## Mock backend

Drives the overlay through the real `/stream` with scripted events. Start the backend skeleton with dev routes on, then the overlay, then play a scenario:

```sh
cd backend && INLOOK_DEV=1 uvicorn app.main:app   # terminal 1
npm start                                          # terminal 2, in overlay/
npm run mock                                       # terminal 3: demo scenario
npm run mock tiers                                 # tiers scenario
```

`INLOOK_BACKEND_URL` applies (default `http://127.0.0.1:8000`). Every item is validated against `shared/event.schema.json` first; the script exits 1 on the first invalid item and sends nothing. Fixtures hold `{type, payload, delayMs}`; `seq` and `at` come from the backend.

## Contract types

`src/shared/contract.gen.ts` is generated from `shared/*.schema.json`; do not edit it. Edit the schema, then regenerate:

```sh
npm run gen:contract      # TypeScript → src/shared/contract.gen.ts
npm run gen:contract:py   # Python (pydantic v2) → ../shared/generated/contract_models.py
```

`npm test` runs vitest.

## Security

- Both pages carry a strict CSP: `default-src 'none'`, `script-src`, `style-src`, `font-src` and `img-src` limited to `'self'`, `connect-src 'none'`. Renderers make no network requests; main does all HTTP.
- `contextIsolation` and `sandbox` on, `nodeIntegration` off. Window opening is denied and navigation is blocked in both windows.
- Every `ipcMain.handle` checks the sender frame is one of our two pages and validates its arguments. Mic permission is granted only to our pages.
- The HUD is created at its final position and size and never moved or resized after show (on GNOME/X11 a moved click-through window can block clicks).

## Notes

- Each audio chunk is a separate `MediaRecorder` session, so every chunk is a standalone webm/Opus file. A new recorder starts every 9 s, giving the 1 s overlap.
- Screenshots hide the HUD and widget for ~150 ms so they are not in the shot. The full display under the cursor is captured (no active-window capture), then downscaled with `nativeImage.resize` (quality "good") to long side ≤ 1280 px and area ≤ ~1.15 MP. Smaller images are unchanged.
- Dev without a backend: `node scripts/audio-sink.mjs [port]` stands in for `POST /audio`, saves chunks to a temp dir (path printed) and answers 202. Run the overlay with `INLOOK_BACKEND_URL=http://127.0.0.1:<port>`.
- Fonts (Rethink Sans, Doto) are not bundled yet; styles fall back to system fonts. The styles are a skeleton, not the designed HUD.
- Restart limitation: the backend skeleton's event log is in memory, so after a backend restart `seq` starts again at 1 and the backend skips everything ≤ the overlay's `Last-Event-ID`; the overlay then shows nothing new. Restart the overlay after restarting the backend (also with `uvicorn --reload`). A persistent `seq` (planned MongoDB `events` collection, unconfirmed) or a boot id from the backend would remove this; the overlay cannot fix it alone.
