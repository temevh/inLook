# Product

<!-- impeccable:product-schema 1 -->

<!-- Facts come from .plans/overlay-architecture-spec.md. Product-wide facts and brand: ../PRODUCT.md. -->

## Platform

web

Electron (Chromium renderer) on Debian, X11 session. Desktop only, no browser extension, no mobile.

## Stack

Electron 45, TypeScript, no UI framework (plain DOM renderers). Two renderer windows: HUD and widget. Wire contract: `shared/CONTRACT.md`.

## Users

One person on one machine during a live meeting or while reading on screen (hackathon demo, single user). They keep working in other apps; the overlay sits on top and tells them when something said or shown contradicts a stored fact.

## Product Purpose

The overlay captures speech, the X11 selection and screenshots, sends them to the backend, and shows the results: transcript, verdicts, updates, reviews, strategy flags and Inlook messages. The check and the tier routing are in `.plans/overlay-architecture-spec.md`, "Fact-check flow". Success: the user sees "Outdated: €39" inline, seconds after the claim, without leaving the app they are in.

## Positioning

Undecided.

## Operating Context

- HUD and widget windows: spec, "Overlay app (Electron)".
- The HUD floats over whatever app is open and is filmed for the pitch video.

## Capabilities and Constraints

- Capture and platform limits: spec, "Platform" and "Overlay app (Electron)".
- Speaker names come from ElevenLabs speaker labels, mapped to names by a fixed list.
- HUD cards carry title, criticality and fact only (no category): `shared/CONTRACT.md`.
- Undecided: HUD edge and width (configurable, see `README.md`), multi-monitor behaviour, the demo source page.

## Brand Commitments

Name: inLook. Colours and fonts: [root PRODUCT.md](../PRODUCT.md#brand-commitments). The product dark mode fits the HUD.

## Evidence on Hand

The HUD and widget exist as a skeleton with placeholder styles. Pitch scenes 06–09 in `visualizations/visuals/scenes/` show the live check, update, strategy flag and notify moments; their look is the visuals' own, not the HUD's. Strategies and people are mock data and must not be presented as real.

## Product Principles

- Never block the user's real work: click-through by default, interactive only on request.
- Verdict first, evidence second: the inline note is the product; detail is one step away.
- Only what is checked is shown as checked; unmatched claims read as unverified.
- Demo truth: what the HUD shows comes from the live pipeline, except where the spec marks it as pre-made.

## Accessibility & Inclusion

No product-specific requirement established.
