# inLook

inLook catches outdated facts in meetings, flags the strategies that depend on them and notifies only their owners.
Hackathon build: ~24 h, 2–3 people, 2-minute pitch video.

Source of truth: [`.plans/overlay-architecture-spec.md`](.plans/overlay-architecture-spec.md). Product and brand: [`PRODUCT.md`](PRODUCT.md).

| Directory | What | Owner |
|---|---|---|
| [`overlay/`](overlay/README.md) | Electron HUD + widget on Debian X11 | Ant |
| [`shared/`](shared/README.md) | HTTP/SSE contract between overlay and backend | Ant |
| [`backend/`](backend/README.md) | Python FastAPI backend (skeleton) | others |
| [`visualizations/visuals/`](visualizations/visuals/PRODUCT.md) | pre-made pitch visuals: dashboards and the company-wide flow (not built) | — |
