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
  shared/contract.ts   event, card and request types (mirror of shared/CONTRACT.md)
  shared/ipc.ts        preload bridge types (window.inlook)
  main/main.ts         app entry: windows, IPC, SSE, hotkey; event backlog replayed to windows on load
  main/config.ts       env settings (table above)
  main/windows.ts      HUD + widget BrowserWindows, HUD interactive toggle
  main/backend-client.ts  POST /audio, /check, /reviews/:id
  main/sse.ts          GET /stream subscriber, Last-Event-ID replay, seq de-dupe, backoff
  main/selection.ts    X11 PRIMARY selection read
  main/screenshot.ts   desktopCapturer screen capture (STUB: no active-window capture yet)
  preload/preload.ts   contextBridge → window.inlook
  renderer/hud/        HUD strip: transcript, checking/verdict/review/strategy/message cards
  renderer/widget/     buttons + mic.ts (10 s Opus chunks, 1 s overlap)
```

Build output: `dist/main`, `dist/preload`, `dist/shared` (CommonJS) and `dist/web` (renderer ES modules + HTML/CSS).

## Notes

- Each audio chunk is a separate `MediaRecorder` session, so every chunk is a standalone webm/Opus file. A new recorder starts every 9 s, giving the 1 s overlap.
- Screenshots hide the HUD and widget for ~150 ms so they are not in the shot.
- Fonts (Rethink Sans, Doto) are not bundled yet; styles fall back to system fonts. The styles are a skeleton, not the designed HUD.
