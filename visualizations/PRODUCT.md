# Product

<!-- impeccable:product-schema 1 -->

<!-- Init ran without an interview: agents in this repo route questions to manager, not Ant.
     Facts come from .plans/overlay-architecture-spec.md, the existing files and the restructure brief. Lines marked (inferred) are not confirmed. -->

## Platform

web

## Stack

Static HTML/CSS with vanilla JS, no build step. Each file opens on its own.

## Users

Viewers of inLook's 2-minute hackathon pitch video. The visuals are screen-recorded as loops on a dark stage; nobody interacts with them.

## Product Purpose

Pre-made visuals that show the parts of inLook the hackathon does not build: capture, company memory, strategies, routing, and the "one memory" close. They sit between the live overlay demo moments so the video tells the whole story. Success: each scene reads in the seconds it is on screen.

## Positioning

Undecided.

## Operating Context

- `visuals/scenes/01–10`: the pitch sequence, 1920×1080 SVG stages sharing `scenes/kit.css` and `scenes/kit.js`. Spec mapping: 01–04 and 10 are pre-made only; 05–09 mirror moments the overlay performs live.
- `visuals/architecture.html`: the system diagram.
- `visuals/bloom.html`, `transit.html`, `tributary.html`: earlier explorations of information flowing to branches and members.
- `journey.html`, `matrix.html`, `network.html` with `base.css` and `data.js`: the first org-information visuals (what is shared with which branch and member), from the original inLook brief.

## Capabilities and Constraints

- Recorded at 1920×1080 on a dark stage.
- Undecided: which of the earlier explorations appear in the final video.

## Brand Commitments

Name: inLook. Visual basis given by Ant: context.dev's design system, most likely colours and fonts only. Re-theming toward it is optional for these files. Recorded as given, not expanded:

- Product dark mode (closest to the dark stage): page #0d0e16, card #151720, background hsl(233 25% 7%), card hsl(233 20% 10.5%), border hsl(233 12% 21%), foreground hsl(220 20% 96%), primary #268bff.
- Brand primary #2563eb, accent #60a5fa. Blue scale #3b73ed, #5182ef, #7ca1f3, #92b1f5, #bed0f9, #d3e0fb, #e9effd. Navy #2159d4, #1e4fbc, #163b8d, #07142f, #040a18.
- Light surfaces: page #f7f7f7, surface #fff, canvas #fafafa, frame #f2f2f2. Text #000, muted #4d4d4d, subtle #707070. Borders #e6e6e6, subtle #f0f0f0, strong #ccc. CTA black #000 with white text, hover #242426.
- Status: success #15803d, danger #dc2626, warning #854d0e.
- Overall look: monochrome black on off-white with one blue accent.
- Fonts: Rethink Sans (variable 400–800) for display, body and UI at 400, 450, 600, 800. Doto (100–900) for data and numbers.
- Type scale 6 / 4.5 / 3.5 / 2.75 / 2 / 1.5 / 1.25 / 1 / .875 / .75 rem, line-height 1.15–1.3.
- Lower priority: radii button .5rem, card .875rem, pills fully rounded. Easing cubic-bezier(.22,1,.36,1).

## Evidence on Hand

No real data. Every branch, member, fact, strategy and person is synthetic and must be labelled synthetic wherever a viewer could take it as real.

## Product Principles

- One idea per scene, readable in the seconds it is on screen.
- Scenes 05–09 must match what the live overlay actually shows, so the video does not promise more than the demo.
- Synthetic data is authored at full fidelity and labelled synthetic.
- Each file stands alone and opens without a build step.

## Accessibility & Inclusion

No product-specific requirement established.
