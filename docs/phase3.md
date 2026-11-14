# Phase 3: capture

## What was done

- `overlay/src/main/screenshot.ts`: captures the full display under the cursor. Active-window capture is out of scope. The HUD and widget still hide during the shot.
- After capture the image is downscaled with `nativeImage.resize` (quality "good") to long side ≤ 1280 px and area ≤ ~1.15 MP.
- New `overlay/scripts/audio-sink.mjs`: dev-only stand-in for `POST /audio`. Saves chunks to a temp dir and answers 202.
- `selection.ts` and `mic.ts` unchanged.

## Why

- Downscaling keeps `/check` image uploads to Gemini small. The idea comes from openclicky's Linux notes.
- The audio sink lets the mic path be tested without the backend.

## Use the audio sink

```sh
node scripts/audio-sink.mjs [port]                 # from overlay/
INLOOK_BACKEND_URL=http://127.0.0.1:<port> npm start
```

## Checks done

- Real mic: 4 chunks. ffprobe: opus 48 kHz mono, 9.90 s each (the last is partial, cut by stop). Each is a standalone webm, starting 9 s apart (1 s overlap).
- Selection: `clipboard.selection.readText()` read PRIMARY written by another X11 client.
- Resize math on synthetic images: 1920×1080 → 1280×720, 1920×1200 → 1280×800, small images unchanged.

## Not verified

Checked on NixOS/Hyprland, not Debian X11:
- Live `desktopCapturer` capture (times out under XWayland on that machine).
- Selection from a real X11 app.
- Mic through the real widget button.
