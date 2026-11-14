# frontend

The inLook dashboard: a Vue 3 app (`src/`) plus the read-only data API it reads from (`server/`).

## Run it

```bash
npm install            # also runs prisma generate
npm run dev:demo       # dashboard on http://localhost:5173 with built-in mock data, nothing else needed
```

Live, against the real backend:

```bash
cp .env.example .env   # DATABASE_URL must include the database name: .../inlook
npm run api            # data API on http://localhost:3001 (Prisma over MongoDB Atlas)
# backend on http://127.0.0.1:8000 (see backend/README.md)
npm run dev            # dashboard on http://localhost:5173
```

The Live / Demo switch in the top bar changes mode at any time; `?demo` in the URL starts in demo mode.

**Signed-in user.** There is no login screen yet. The dashboard is personalised for one employee, shown in the
top bar: `?user=<person id>` in the URL (e.g. `?user=p-noor`), else `VITE_INLOOK_USER` in `.env`, else Ada
Mockridge (`p-ada`). Mock people: `p-casey` (CEO), `p-noor` (COO), `p-ada`, `p-sam`, `p-mira`.
Vite proxies `/api` to the data API and `/stream`, `/check`, `/recheck`, `/reviews` to the backend, so neither
needs CORS. Override the targets with `INLOOK_API_URL` and `INLOOK_BACKEND_URL` in `.env`.

```bash
npm test               # reducer and hierarchy-scope tests (vitest)
npm run build          # type-check (vue-tsc) and production build into dist/
npm run typecheck      # server + app
```

## How it works

- **Snapshot, then stream.** On load the store reads `/api/*` (people, facts, strategies, reviews, messages, the
  last 200 events), then opens `GET /stream`. The stream replays the whole log on connect; events up to the
  snapshot's newest `seq` only fill the Activity log, newer ones are folded into the records by
  `src/lib/fold.ts`. A new boot id in the SSE `id:` reloads the snapshot.
- **Actions** (`Accept new value`, `Keep old value`, `Re-check now`, `Check a claim`) POST to the backend and keep
  their spinner until the confirming event arrives. Nothing is updated optimistically.
- **Who sees what** (`src/lib/scope.ts`): a viewer's scope is themselves plus everyone below them in the reporting
  line. Facts are in scope when someone in it stated them or owns a strategy that relies on them. Only the named
  reviewer can decide a review; people above see it as waiting.
- **Play meeting**: in demo mode it plays the meeting in `src/mock/demo-data.json` line by line, and every claim
  in it goes through the demo engine. In live mode it sends the same claims to `POST /check`, so the real
  pipeline handles them.

## Mock data

Everything shown is mock data and labelled so. All of it lives in one file, `src/mock/demo-data.json`:

- `people`: 17 people in eight teams, up to four levels deep (CEO → CTO → Engineering Manager → Platform
  Engineer). The database has no reporting line yet, so live mode borrows it from here too (`src/mock/org.ts`).
- `facts`: 24 facts across all tiers. `live` is what the fact's source says today, which decides a check's
  verdict: a different value is outdated, the same value is current, `null` (no public source) is unverifiable.
  `keywords` match a typed claim to a fact, standing in for the backend's Gemini match.
- `strategies`: 12 strategies with a one-line `summary` (demo only). They share facts across teams, so one change
  ripples: the EUR/USD rate feeds four strategies owned by four people in three teams.
- `history`: past claims and decisions, run through the demo engine at load: accepted, rejected and automatic
  changes, and four open reviews.
- `meeting`: 19 transcript lines that Play meeting replays, most with a claim.

`src/data/demo.ts` is the demo engine. It follows the backend's routing:

- Low tier and no strategy relies on it: updated automatically.
- Low tier but a strategy relies on it: treated as medium (Onboarding length, used by the Hiring Plan).
- Medium: review by whoever stated the fact. No flag.
- High: review by every owner of every relying strategy; each strategy is flagged (once) and each owner messaged.
- High but no strategy relies on it: review by whoever stated it (Office lease end date).
- A fact already in review is not asked about again.
- A flagged strategy turns healthy only when none of its facts is in review, including medium ones.

Every fact's side panel on the Facts page explains this for that fact under "If its source changes", and every
review card says why its reviewers were chosen.

Good people to sign in as with `?user=`: `p-ada` (default; her strategies pull in facts from four other teams),
`p-elin` (asked about both the Notion price and the exchange rate), `p-noor` (COO, sees reviews waiting two
levels down), `p-casey` (CEO, everything), `p-jon` (middle manager, owns nothing but sees his report's strategy),
`p-mira` (only low-tier facts, until the lease review lands on her), `p-hana` (gets the raised-tier review).

Demo-only extras:

- **Sign in as** (click your name in the top bar): switch person without losing the demo. Each person's list
  shows how many decisions wait on them.
- **Colleagues decide on their own**: a meeting claim's `autoDecide` in the JSON makes that person decide its
  review after a delay (Raj accepts the Notion price after 25 s, Sam keeps the Apple return window after 30 s),
  unless they are the one signed in. Others get an "Accepted" or "Kept old value" notification naming them, and
  the new version in the fact's history is credited to them.
- **Misstated claims**: when a claim's numbers differ from what company memory held, the card says so, whatever
  the source says (Dana's "100 requests a minute" while memory holds 120). This is worked out from the text, so it
  works in live mode too.
- **Ripple diagram** on the Facts page: the selected fact, the strategies relying on it and their owners. Edges
  animate while a change is in review; flagged strategies and the people asked to decide are marked.
- **Notification pop-ups** for anything new that reaches the bell, with its main action ("Decide now").

What to try in demo mode:

1. Play meeting. Watch Notion's price ask four people across three strategies, and the exchange rate flag two
   more strategies and message owners of strategies that were already flagged.
2. As Ada, accept the Notion price: Mock Pricing Plan stays flagged because the exchange rate is still in review.
   Accept the exchange rate too, and it turns healthy. Marketing Tools Budget stays flagged because of the HubSpot
   review (medium) from the history.
3. Facts → Maximum sales discount → Re-check now. Its earlier review was rejected, but the source still says 15%,
   so a new review opens.
4. Type a claim such as “VAT is 24%” or “HubSpot costs $20 a seat” into Check a claim.
   Unknown topics come back unverified.
5. Activity shows the full log, including weeks of history.

## Files

- `src/stores/inlook.ts`: the one Pinia store (snapshot, stream, demo engine, actions).
- `src/data/`: `api.ts` (fetch wrappers), `stream.ts` (EventSource), `demo.ts` (in-browser backend stand-in).
- `src/components/UserMenu.vue`, `FactRipple.vue`, `NotifyToasts.vue`: person switcher (demo), ripple diagram, pop-ups.
- `src/views/`: My desk, Meetings (transcript, claims, Check a claim), Facts (with version history), Strategies, Activity.
- `src/components/NotificationBell.vue` and `src/lib/inbox.ts`: the bell. Each notification links to its action
  (Decide now, the strategy, the fact) and can be hidden. Hidden items and read state are kept per person in
  the browser's localStorage, so they reset in another browser.
- `src/styles/base.css`: brand tokens from the root `PRODUCT.md`.
- `prisma/schema.prisma`: models from `prisma db pull`. `reviews`, `messages` and `events` were empty at
  introspection, so their fields are written by hand from `backend/app/services/db.py` and `backend/app/events.py`.
- `server/index.ts`: read-only JSON API. Prisma runs only here, never in the browser. The FastAPI backend stays
  the only writer.

MongoDB support is on Prisma 6 (pinned), so ignore the upgrade notice to 7+. TypeScript is pinned to 5.9 because
`vue-tsc` does not run on TypeScript 7 yet.
