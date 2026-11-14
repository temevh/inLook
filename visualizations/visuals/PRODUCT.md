# Product

<!-- impeccable:product-schema 1 -->

<!-- Facts come from .plans/overlay-architecture-spec.md and the files in this folder. Product-wide facts and brand: ../../PRODUCT.md. -->

## Platform

web

## Stack

Static HTML/CSS with vanilla JS, no build step. Each file opens on its own.

## Users

Viewers of inLook's 2-minute hackathon pitch video. The visuals are screen-recorded as loops on a dark stage; nobody interacts with them.

## Product Purpose

Pre-made visuals that show the parts of inLook the hackathon does not build: capture, company memory, strategies, routing, dashboards, the company-wide flow and the "one memory" close. They sit between the live overlay demo moments so the video tells the whole story. Success: each scene reads in the seconds it is on screen.

## Positioning

Undecided.

## Operating Context

Paths are relative to `visualizations/visuals/`.

- `scenes/01–10`: the pitch sequence, 1920×1080 SVG stages sharing `scenes/kit.css` and `scenes/kit.js`. Mapping to the live demo: spec, "Demo script mapping".
- `architecture.html`, `fact-check-flow.html`, `data-and-sources.html`, `overlay-internals.html`: system diagrams. Where they show MongoDB, Context.dev or page watching, those parts are UNCONFIRMED (see the spec).
- `bloom.html`, `transit.html`, `tributary.html`: earlier explorations of information flowing to branches and members.
- `journey.html`, `matrix.html`, `network.html` with `base.css` and `data.js`: the first org-information visuals, from the original inLook brief.

## Capabilities and Constraints

- Recorded at 1920×1080 on a dark stage.
- Undecided: which of the earlier explorations appear in the final video.

## Brand Commitments

Name: inLook. Colours and fonts: [root PRODUCT.md](../../PRODUCT.md#brand-commitments). Re-theming these files toward them is optional. The product dark mode is closest to the dark stage.

## Evidence on Hand

No real data. Every branch, member, fact, strategy and person is mock data and must be labelled as such wherever a viewer could take it as real.

## Product Principles

- One idea per scene, readable in the seconds it is on screen.
- Scenes 05–09 must match what the live overlay actually shows, so the video does not promise more than the demo.
- Synthetic data is authored at full fidelity and labelled synthetic.
- Each file stands alone and opens without a build step.

## Accessibility & Inclusion

No product-specific requirement established.
