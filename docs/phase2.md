# Phase 2: harden the shell

## 2a: Electron security and HUD window

Files: `overlay/src/main/main.ts`, `windows.ts`, both `index.html`.

- Both pages have a strict CSP meta: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. Renderers make no network requests; main does all HTTP.
- `lockDown(win)` on both windows: `setWindowOpenHandler` denies, `will-navigate` is prevented.
- Every `ipcMain.handle` checks `event.senderFrame.url` is one of our two pages (`isOwnPage`) and validates args: booleans; review id non-empty, ≤ 200 chars; decision `accept`|`reject`; audio chunk a non-empty ArrayBuffer ≤ 4 MB, `audio/*` mime, string `startedAt`, integer `seqNo` ≥ 0.
- `setPermissionCheckHandler` added beside the request handler: media only for our pages.
- The HUD is created at its final position and size and never moved or resized after show (on GNOME/X11 a moved click-through window can block clicks; openclicky's Linux notes). Already true, no change.
- Kept: `contextIsolation`, `sandbox`, `nodeIntegration: false`. Why: Electron security checklist, minimal.

Checked live via remote debugging: bad IPC args rejected, valid chunk accepted, fetch blocked by CSP, `window.open` returns null, navigation blocked.
Unverified: a foreign sender, mic permission with real `getUserMedia` through the handler, Debian X11.

## 2b: SSE client and validation

Files: `overlay/src/main/sse.ts`, new `validate.ts`, `overlay/scripts/copy-static.mjs`.

- `sse.ts` uses the `eventsource` package instead of a hand-written parser and reconnect loop. Same `subscribe({onEvent, onStatus})` API; `seq` de-dupe kept.
- `Last-Event-ID` is sent through a custom fetch, because a re-created instance forgets it. The instance is re-created 3 s after fatal errors (non-200); the package retries the rest itself.
- It listens per event type, since backend frames carry `event: <type>`.
- `validate.ts`: ajv (2020-12) + ajv-formats compile `event.schema.json` and `card.schema.json` once. Invalid events are dropped with a warning.
- `copy-static.mjs` copies `shared/*.schema.json` to `dist/schemas/` and `.woff2` fonts from `src/renderer`.

Checked live: valid events arrive once each, invalid ones are dropped, reconnect after a backend kill works, the fatal-error path re-creates the instance and resumes with `Last-Event-ID`.

## Known limitation

The backend skeleton's event log is in memory. After a backend restart `seq` starts again at 1 and the backend skips everything ≤ the client's `Last-Event-ID`, so the overlay shows nothing new. Workaround: restart the overlay after restarting the backend (also with `uvicorn --reload`).

No overlay code change (decided by manager). A persistent `seq` (the spec's planned MongoDB `events` collection, UNCONFIRMED) removes it; otherwise the backend owners could send a boot id. The overlay cannot fix it alone.
