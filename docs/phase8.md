# Phase 8: SSE across backend restarts, continuous mic audio

Two review fixes. Both transport changes are **proposed**: agree them with the backend owners.

## Fix 1: SSE survives a backend restart

Files: `backend/app/events.py`, stream handler in `backend/app/main.py`, `overlay/src/main/sse.ts`, `overlay/test/sse.test.ts`.

- SSE frames carry `id: <bootId>:<seq>`; `bootId` is random per backend process. The JSON envelope is unchanged.
- On connect, `Last-Event-ID` `<currentBootId>:<n>` replays seq > n. Anything else (missing, another boot id, a bare number) replays the whole current log.
- The overlay scopes its seq de-dupe to the boot id; a new boot id resets `lastSeq`.
- Why: the in-memory log restarts `seq` at 1, and the backend skipped everything ≤ the client's `Last-Event-ID`. Now the HUD keeps receiving events after a restart (also `uvicorn --reload`) without restarting the overlay. This resolves the phase 2 known limitation.

## Fix 2: mic audio streams continuously

Files: `overlay/src/renderer/widget/mic.ts`, new `pcm-worklet.js`, new `overlay/src/main/audio-stream.ts`, `ipc.ts`, `preload.ts`, `main.ts`, `backend-client.ts`, `contract.ts`, `overlay/scripts/copy-static.mjs`, backend stub, dev sink.

- Why: ElevenLabs realtime STT (`wss://api.elevenlabs.io/v1/speech-to-text/realtime`, `audio_format=pcm_16000`, `diarize=true` for speaker labels) takes a continuous stream. The 10 s chunks with 1 s overlap added up to 10 s of delay and duplicated words.
- Wire format: `WS /audio/stream` on the backend URL (http→ws, https→wss). One connection = one transcribing session, closed with code 1000 when it stops. Binary frames only, overlay → backend: raw PCM s16le, mono, 16 kHz, 1600 samples (3200 B, 100 ms), no header. Nothing server → client; transcript and claims still arrive over SSE. Details in `shared/CONTRACT.md`.
- Overlay: getUserMedia (echoCancellation, noiseSuppression) → AudioContext(16 kHz) → AudioWorklet making 100 ms frames (linear-interpolation resampling as fallback) → IPC `audio:frame` (ArrayBuffer, 1–64 KB, sender-checked) → main's WebSocket (Node built-in, no new dependency).
- Reconnect after 1 s if the socket drops mid-session (a new session). Frames are dropped while the socket is not open or when > 320 KB is buffered.
- `POST /audio` is replaced: the overlay no longer calls it; the backend keeps it marked deprecated. The backend has only a stub `WS /audio/stream` that discards frames. Relaying to ElevenLabs realtime in `services/stt.py` is the backend owners' TODO.
- Dev sink: `overlay/scripts/audio-sink.mjs` replaced by `overlay/scripts/audio-sink.py` (`backend/.venv/bin/python overlay/scripts/audio-sink.py [port]`); saves each session as a 16 kHz mono .wav and logs frame count and rate.

## Also new

`scripts/` (Ant's laptop scripts): `sync-to.sh`, `setup-debian.sh`, `launch-overlay.sh`, `run-over-ssh.sh`.

## Checks done

- Typecheck and build clean. `npm test`: 3 files, 11 tests (new worklet test).
- Real mic run: ffprobe pcm_s16le 16000 Hz mono 16.4 s, 164 frames at 10.1/s, max gap 117 ms.
- Reconnect after killing the sink. The backend stub accepts a session.

## Laptop test

Demo laptop `san` (Debian 13, GNOME on Xorg, 1920×1080), synced with `scripts/sync-to.sh`, real X11. All pass.

- Transparency: the HUD is a depth-32 ARGB window. GNOME Shell's composited screenshot shows the app behind through the gaps, cards opaque, widget slightly see-through (opacity .92). `xwd -root` flattens ARGB windows to black, so it cannot show this.
- Click-through: synthetic XTest clicks on gaps, cards, card text, the empty area and the Accept position all reached the xterm underneath while the HUD was non-interactive. With the HUD interactive, Accept sent `POST /reviews/…` (501 from the stub) and showed "Not sent … Try again." with buttons re-enabled. Toggled off, click-through returned.
- Restart survival: `kill -9` and restart of the backend; the new boot's events (seq 1, 2) appeared in the HUD without restarting the overlay.
- Screenshots: "Check screen" and the Ctrl+Alt+K hotkey uploaded a 1280×720 PNG (0.92 MP) of the desktop with no HUD or widget in it.
- Selection: double-clicking "PLATYPUS42" in xterm sent `{"kind":"text","text":"PLATYPUS42","source":"selection"}`, via button and hotkey.
- Mic: `audio-sink.py` got 119 frames over 11.8 s (10.1/s, max gap 117 ms). The wav is pcm_s16le 16 kHz mono, 11.9 s. A tone played through the laptop speaker was picked up (overall RMS −17.9 dBFS). The first ~0.8 s is silence (mic start-up).

Noted, not fixed:
- `scripts/launch-overlay.sh` sources `~/.config/inlook/env` after the caller's environment, so the file wins over an `INLOOK_BACKEND_URL` set by the caller.
- After `npm ci` on `san` the Electron binary was missing until `node node_modules/electron/install.js` ran.
- The widget window measured 264×290 instead of 232×248.
