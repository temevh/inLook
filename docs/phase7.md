# Phase 7: impeccable pass (polish, animate, UX)

Files: `overlay/src/renderer/hud/hud.css`, `hud.ts`, `widget/widget.css`, `widget.ts`. Done with the `impeccable` skill, Operate mode. Brand tokens and Rethink Sans kept. Supersedes the card styling in `docs/phase4.md`.

## What was done

**Polish**
- Criticality is a surface tint + tinted hairline + a pill whose weight follows the tier (high solid, medium tinted, low outline). It replaces the coloured left border and stays readable in grayscale video.
- The fact line is the largest text; the title is a small label above it; evidence is `.875rem`.
- Soft card shadow for edges over dark apps. Accept uses brand navy text on blue (~5.8:1 contrast).
- Older transcript lines fade. The stream status has a coloured dot (amber connecting, blue open, red closed).
- Widget toggles get a drawn switch; one-shot buttons stay plain. New tokens `--on-fill`, `--lift`.

**Animate** (transform/opacity only, brand easing)
- A verdict lands on the same "Checking…" card: tint tween, content rises title → fact → evidence, one ring pulse.
- Cards enter and exit, neighbours glide (FLIP, WAAPI). Exits 180 ms; unverified fades over 700 ms.
- Interactive-mode ring and Accept fill fade in. Press feedback on review and widget buttons. Widget toggle thumb slides.
- `prefers-reduced-motion`: opacity-only fades, no movement.

**UX**
- Review buttons show Sending… → Sent. On failure they re-enable with "Not sent: <error>. Try again." in red. `review.closed` shows Accepted/Rejected for 1.4 s, then the card closes.
- Removal timers are per card key and cancelled on update (fixes an old unverified timer removing a later verdict card).
- The oldest finished cards are dropped so the stack fits (max 8); pending reviews are never dropped.
- `claimText` entries are deleted when a claim resolves (capped at 100). HUD status shows "· interactive".
- Widget: check buttons disable with a spinner while running (no double-sends), success notes clear after 3 s, errors stay red, "Starting mic…" while permission is pending.

## Why

Cards had to read at a glance in a 2-minute pitch video, including in grayscale. The pass also closes three nits declined in an earlier review: review retry, stale timer, `claimText` map.

## Checks done

- Offscreen Electron harness over light and busy backdrops: before/after screenshots per pass and mid-animation frames.
- Reduced motion verified with `--force-prefers-reduced-motion`.
- `npm run typecheck` clean; `npm test` 7/7.

## Unverified

The real HUD on Debian X11: transparency, click-through, compositor shadows and ring under Mutter or picom, the real review POST.
