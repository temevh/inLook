# frontend

The inLook dashboard: a Vue 3 app (`src/`) plus the read-only data API it reads from (`server/`).

## Run it

```bash
npm install            # also runs prisma generate
npm run dev:demo       # dashboard on http://localhost:5173 with built-in mock data, nothing else needed
```

Demo with the mock backend, so every action goes over HTTP and SSE like live mode and a terminal shows what
the backend "does":

```bash
npm run mock           # terminal 1: mock backend on http://localhost:8787 (MOCK_PORT to change)
npm run dev:demo       # terminal 2: dashboard; demo mode finds the mock backend through /mock
```

**Mock backend** (`server/mock-backend.ts`, MOCK DATA). A stand-in for `backend/` that answers the same
contract (`shared/CONTRACT.md`): `GET /stream` (SSE with `<bootId>:<seq>` ids and Last-Event-ID replay),
`POST /check`, `POST /recheck`, `POST /reviews/{id}` (404 / 409 like the real one), `GET /health`, and the data
API's `GET /api/*`. Play meeting sends each transcript line to `POST /dev/events`, standing in for the
ElevenLabs relay, and the mock spots the claims in it. `POST /dev/reset` (the Reset button) reseeds it and
changes the boot id. Claims run through the same engine as the in-browser demo (`src/data/demo.ts`), so the
results match. For every request the terminal prints who sent it (`x-inlook-user`, a mock-only header), the
body, each step the real backend would take (Gemini spot / match / verdict, Context.dev scrape, tier routing,
MongoDB writes, SSE publishes with their seq) and the response. Gemini, Context.dev, ElevenLabs and MongoDB
are simulated; nothing leaves the process. When the mock backend is not running, demo mode runs in the browser
as before; the top bar says which (`Mock backend · seq N` or `Demo data · seq N`).

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
needs CORS, and `/mock/*` to the mock backend. Override the targets with `INLOOK_API_URL`,
`INLOOK_BACKEND_URL` and `INLOOK_MOCK_URL` in `.env`.

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

- `people`: 5 people, three levels deep: Casey (CEO) → Ada (Head of Pricing) and Noor (COO) → Sam (Support Lead)
  and Mira (Office Manager). Live mode borrows this reporting line too (`src/mock/org.ts`).
- `facts`: 5 facts. `live` is what the fact's source says today, which decides a check's verdict: a different
  value is outdated, the same value is current. `keywords` match a typed claim to a fact.
- `strategies`: 3 strategies relying on 1, 2 and 3 facts. Facts are used by 0, 1 or 2 strategies.
- `history`: Sam once kept the Apple return window (rejected review), and the ticket volume review is open.
- `meeting`: 9 transcript lines that Play meeting replays, 7 of them with a claim.

| Fact | Tier | Stated by | Strategies | What the demo shows |
| --- | --- | --- | --- | --- |
| Notion Plus price | high | Sam | Pricing Plan, 2027 Budget | Both owners (Ada, Casey) decide; two strategies flagged; Casey accepts after 25 s |
| EUR/USD rate | high | Ada | 2027 Budget | Casey decides, not Ada who stated it; Ada misstates it (1.10 vs 1.08) |
| Apple return window | medium | Sam | Support Plan | Sam decides; rejected once before; Sam accepts after 30 s |
| Weekly support tickets | low → medium | Sam | Support Plan, 2027 Budget | Raised to medium because strategies rely on it; already in review, not asked twice |
| Office wifi | low | Mira | none | Updated automatically, then confirmed current |

`src/data/demo.ts` is the demo engine and follows the backend's routing: low and unused updates itself; low but
relied on is treated as medium; medium goes to whoever stated it; high goes to every owner of every relying
strategy (or to whoever stated it if none), flags each strategy once and messages its owners. A flagged strategy
turns healthy only when none of its facts is in review, including medium ones.

Good people to sign in as: `p-ada` (default), `p-casey` (CEO, decides the most), `p-noor` (COO, sees Sam's and
Mira's work), `p-sam` (Support Lead, medium-tier reviews), `p-mira` (no strategy, only the wifi).

Demo-only extras:

- **Sign in as** (click your name in the top bar): switch person without losing the demo.
- **Colleagues decide on their own**: a meeting claim's `autoDecide` makes that person decide its review after a
  delay, unless they are the one signed in. Others get a notification naming them, and the fact history credits them.
- **Misstated claims**: when a claim's numbers differ from what company memory held, the card says so. This is
  worked out from the text, so it works in live mode too.
- **Ripple diagram** on the Facts page, and **notification pop-ups** for anything new in the bell.

What to try in demo mode:

1. Play meeting as Ada. The Notion price flags Mock Pricing Plan and 2027 Budget. 25 s later Casey accepts it:
   the Pricing Plan heals, the Budget stays flagged because the exchange rate and ticket volume are in review.
2. Switch to Casey and accept the exchange rate: the Budget still waits on Sam's ticket volume review.
3. Switch to Sam and accept the ticket volume: the Budget turns healthy.
4. Facts → Weekly support tickets shows the raised tier; the ripple diagram shows who it reaches.
5. Type “is it still 1.08 dollars per euro?” into Check a claim on Meetings; unknown topics come back unverified.

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
- `server/mock-backend.ts`: the mock backend for demo mode (`npm run mock`), see "Run it".
- `server/index.ts`: read-only JSON API. Prisma runs only here, never in the browser. The FastAPI backend stays
  the only writer.

MongoDB support is on Prisma 6 (pinned), so ignore the upgrade notice to 7+. TypeScript is pinned to 5.9 because
`vue-tsc` does not run on TypeScript 7 yet.
