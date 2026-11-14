# Phase 6: integrate and demo

## What was done

Integration run on the dev machine: backend skeleton (`INLOOK_DEV=1 uvicorn app.main:app --port 8020`) + the real overlay (`electron . --ozone-platform=x11 --remote-debugging-port=9333`, `INLOOK_BACKEND_URL=http://127.0.0.1:8020`) + `npm run mock`.

Checked over CDP:
- HUD stream status `open`.
- The HUD rendered the demo cards: Inlook message, Strategy flagged (High), Needs review (High, Accept/Reject), Fact outdated (High, "Competitor X: €59 → €39 per seat", with evidence).
- Rethink Sans loaded in both windows under the CSP. The widget rendered its four buttons.
- Widget IPC: HUD interactive toggle on/off reflected in state; a non-boolean arg rejected ("invalid boolean").
- `decideReview` reached `POST /reviews/{id}` and returned the backend's 501 (reviews need the db, UNCONFIRMED, others' work) as `{ok:false}`.
- A test audio chunk reached `POST /audio` → 202.

## Mocks vs real backend

The overlay already talks to the real backend endpoints; only the events are scripted. Switching to the real pipeline is not possible yet: STT, Gemini, Context.dev and MongoDB are others' work and not built.

## Packaging

None. Run from source with `npm start` on the demo machine. `electron-builder --linux AppImage` was planned only if a second machine is used; it is not.

## Not verified

The dev machine is NixOS + Hyprland; XWayland has no monitor output, so the HUD window was 1×1. Not verifiable here:
- Transparency, click-through and always-on-top on Debian X11 with Mutter or picom.
- Live `desktopCapturer` screenshots.
- Selection from a real X11 app.
- Mic through the widget button.

## Demo-machine checklist (Debian X11)

- [ ] `npm install && npm start` with `INLOOK_BACKEND_URL` set; the HUD strip appears at the configured edge at full height.
- [ ] HUD is transparent over real apps (compositor running); only the header, transcript and cards are opaque.
- [ ] HUD is click-through and stays on top; clicks reach the app underneath.
- [ ] HUD interactive toggle makes Accept/Reject clickable; the toggle back restores click-through.
- [ ] Screenshot hotkey (`INLOOK_HOTKEY`): the shot shows the display under the cursor without HUD or widget, and the upload is downscaled.
- [ ] Hotkey with a selection in a real X11 app sends that text.
- [ ] Mic button: audio chunks reach `POST /audio` (use `scripts/audio-sink.mjs` if the backend is absent).
- [ ] `npm run mock` plays the demo scenario on screen.

## Pending (Ant/manager with the backend owners)

- Agree the "proposed" payloads in `shared/CONTRACT.md`.
- Hand over `shared/generated/contract_models.py`.
- In-memory `seq` restart limitation (phase 2): restart the overlay after restarting the backend.
