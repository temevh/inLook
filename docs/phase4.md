# Phase 4: HUD cards

Later changes to card styling, motion and review/widget behaviour: `docs/phase7.md`.

Files: `overlay/src/renderer/hud/hud.ts`, `hud.css`, `widget/widget.css`, new `renderer/fonts/`.

## What was done

- Fonts: Rethink Sans variable (latin woff2) vendored in `src/renderer/fonts/` with `fonts.css`, imported by `hud.css` and `widget.css`. It loads under the strict CSP (`font-src 'self'`). Doto was dropped (its only use, a values row, was removed), including the `@fontsource/doto` dependency.
- HUD uses the brand's product dark tokens. The window stays transparent: only the header, transcript block and each card are opaque, and the gaps show the user's app.
- Card = title, criticality pill (low blue, medium amber, high red), fact line, evidence line (spec "HUD cards"). The old → new values row was removed because it repeated the fact line.
- States:
  - amber "Checking…" with claim text and source; `claim.verdict` replaces the checking card of the same `claimId`;
  - unverified (no match, or verdict "unverifiable") keeps the claim text, fades and is removed after 4.5 s;
  - `fact.updated` shows the version value and source;
  - review cards show Accept/Reject, dimmed and dashed unless the HUD is interactive (`body.interactive`), disabled after a click;
  - strategy-flagged card (High, red) and Inlook message card (no pill: the event carries no criticality).
- Cards are keyed by `claimId`/`factId`/`reviewId`/`strategyId`/`messageId`. `prefers-reduced-motion` is respected.
- Widget: same tokens and font only.

## Why

The skeleton styles were placeholders. A full-height translucent panel would cover a 380 px column of the screen (the first version did, fixed in review), so the HUD shows opaque cards only.

## Checks done

- Typecheck.
- Built HUD page rendered in an offscreen Electron harness (stub preload), fed with `mock/demo.json` and `mock/tiers.json`, screenshots over a busy backdrop.

## Unverified

- The real HUD window on Debian X11: transparency over real apps, click-through toggle, real Accept/Reject path.
- Widget looks (typecheck only).
- No grim screenshot: this machine has no monitor output for XWayland.
