# Product

<!-- impeccable:product-schema 1 -->

<!-- Facts come from .plans/overlay-architecture-spec.md. Per-surface detail: overlay/PRODUCT.md, visualizations/visuals/PRODUCT.md. -->

## Platform

desktop overlay (Electron on Debian X11) and static web visuals

## Stack

Overlay: [overlay/PRODUCT.md](overlay/PRODUCT.md). Visuals: [visualizations/visuals/PRODUCT.md](visualizations/visuals/PRODUCT.md). Backend and models: [the spec](.plans/overlay-architecture-spec.md).

## Users

One person in a live meeting (hackathon demo, single user), and viewers of the 2-minute pitch video.

## Product Purpose

inLook catches outdated facts in meetings, flags the strategies that depend on them and notifies only their owners. The flow and tier rules are in [the spec](.plans/overlay-architecture-spec.md).

## Positioning

Undecided.

## Operating Context

- Built: the overlay (Ant) and a backend skeleton (others).
- Not built: dashboards and the company-wide flow. They are pre-made visuals in `visualizations/visuals/`.

## Capabilities and Constraints

Hackathon scope: ~24 h, 2–3 people. Future work is listed in [the spec](.plans/overlay-architecture-spec.md#scope).

## Brand Commitments

Name: inLook. Visual basis given by Ant: context.dev's design system, most likely colours and fonts only. Recorded as given, not expanded:

- Product dark mode: page #0d0e16, card #151720, background hsl(233 25% 7%), card hsl(233 20% 10.5%), border hsl(233 12% 21%), foreground hsl(220 20% 96%), primary #268bff.
- Brand primary #2563eb, accent #60a5fa. Blue scale #3b73ed, #5182ef, #7ca1f3, #92b1f5, #bed0f9, #d3e0fb, #e9effd. Navy #2159d4, #1e4fbc, #163b8d, #07142f, #040a18.
- Light surfaces: page #f7f7f7, surface #fff, canvas #fafafa, frame #f2f2f2. Text #000, muted #4d4d4d, subtle #707070. Borders #e6e6e6, subtle #f0f0f0, strong #ccc. CTA black #000 with white text, hover #242426.
- Status: success #15803d, danger #dc2626, warning #854d0e.
- Overall look: monochrome black on off-white with one blue accent.
- Fonts: Rethink Sans (variable 400–800) for display, body and UI at 400, 450, 600, 800. Doto (100–900) for data and numbers.
- Type scale 6 / 4.5 / 3.5 / 2.75 / 2 / 1.5 / 1.25 / 1 / .875 / .75 rem, line-height 1.15–1.3.
- Lower priority: radii button .5rem, card .875rem, pills fully rounded. Easing cubic-bezier(.22,1,.36,1).

## Evidence on Hand

No real data. Strategies and people are mock data and must not be presented as real.

## Product Principles

- Notify only the people who own what changed.

## Accessibility & Inclusion

No product-specific requirement established.
