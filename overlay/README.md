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
  shared/ipc.ts        preload bridge types (window.inlook)
  main/main.ts         app entry: windows, IPC, SSE, hotkey; event backlog replayed to windows on load
  main/config.ts       env settings (table above)
  main/windows.ts      HUD + widget BrowserWindows, HUD interactive toggle
  main/backend-client.ts  POST /check, /reviews/:id
  main/audio-stream.ts    WebSocket to WS /audio/stream: one session per transcribing run, reconnect after 1 s, drops frames when closed or > 320 KB buffered
  main/sse.ts          GET /stream via the `eventsource` package, Last-Event-ID replay, seq de-dupe scoped to the boot id, re-create 3 s after fatal errors
  main/validate.ts     ajv check of every incoming event against shared/event.schema.json; invalid ones are dropped with a warning
  main/selection.ts    X11 PRIMARY selection read
  main/screenshot.ts   desktopCapturer capture of the display under the cursor, downscaled before upload
  preload/preload.ts   contextBridge → window.inlook
  renderer/hud/        HUD strip: transcript, checking/verdict/review/strategy/message cards (hud.ts, hud.css)
  renderer/fonts/      Rethink Sans variable (latin woff2) + fonts.css, imported by hud.css and widget.css
  renderer/widget/     buttons + mic.ts (getUserMedia → AudioContext 16 kHz → pcm-worklet.js: 100 ms s16le mono frames → IPC audio:frame)
  renderer/widget/pcm-worklet.js  AudioWorklet producing the PCM frames
mock/
  demo.json            7 events, pitch scenes 06–09
  tiers.json           10 events: low, medium, unverified, review closed, strategy healthy
test/
  fixtures.test.ts     every mock/*.json item passes the overlay's validator; bad items are rejected
  sse.test.ts          built `subscribe` against a local SSE server: order, seq de-dupe, invalid dropped, reconnect with Last-Event-ID
scripts/
  mock.mjs             POSTs a scenario to the backend's /dev/events (the backend validates it)
  gen-contract.mjs     schema → TS / Python types
  copy-static.mjs      build step: shared/*.schema.json → dist/schemas/, .woff2 fonts and pcm-worklet.js from src/renderer
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

`INLOOK_BACKEND_URL` applies (default `http://127.0.0.1:8000`). The backend validates each event against the contract; the script stops with exit 1 on the first rejected item. Fixtures hold `{type, payload, delayMs}`; `seq` and `at` come from the backend.

## Contract types

`src/shared/contract.gen.ts` is generated from `shared/*.schema.json`; do not edit it. Edit the schema, then regenerate:

```sh
npm run gen:contract      # TypeScript → src/shared/contract.gen.ts
npm run gen:contract:py   # Python (pydantic v2) → ../backend/app/contract.py
```


## Tests

```sh
npm test
```

Runs vitest after a build (`pretest` runs `npm run build`), because `validate.ts` loads the schemas from `dist/schemas` and the SSE test runs the compiled code in `dist/main`. Covers the fixtures against the event schema and the SSE client. Not covered: HUD DOM and an Electron smoke test; check those by running the demo (`npm run mock`).

## Security

- Both pages carry a strict CSP: `default-src 'none'`, `script-src`, `style-src`, `font-src` and `img-src` limited to `'self'`, `connect-src 'none'`. Renderers make no network requests; main does all HTTP.
- `contextIsolation` and `sandbox` on, `nodeIntegration` off. Window opening is denied and navigation is blocked in both windows.
- Every `ipcMain.handle` checks the sender frame is one of our two pages and validates its arguments. Mic permission is granted only to our pages.
- The HUD is created at its final position and size and never moved or resized after show (on GNOME/X11 a moved click-through window can block clicks).

## Notes

- Mic audio streams continuously: raw PCM (s16le, mono, 16 kHz, 100 ms frames) over `WS /audio/stream`. Wire format: `shared/CONTRACT.md`.
- Screenshots hide the HUD and widget for ~150 ms so they are not in the shot. The full display under the cursor is captured (no active-window capture), then downscaled with `nativeImage.resize` (quality "good") to long side ≤ 1280 px and area ≤ ~1.15 MP. Smaller images are unchanged.
- Fonts: Rethink Sans (variable, latin) is vendored in `src/renderer/fonts/` and loads under the CSP. Doto is not used. The HUD uses the brand's product dark tokens. The window stays transparent: only the header, transcript block and each card are opaque.

## Demo laptop

`scripts/` at the repo root sets up and runs the overlay on the Debian demo laptop: `sync-to.sh` (copy the repo to `~/inLook`), `setup-debian.sh`, `launch-overlay.sh`, `run-over-ssh.sh`. Each script's header comment says how to run it.
