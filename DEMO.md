# Live demo guide

Seven claims, one for each thing inLook does: five numbers, then a person and a product name. Each one is
checked against a **real, live web page** (read through Context.dev), so the values below are what those
pages said on 2026-11-14.

| # | Say (the stale value) | Live page | What the HUD shows | Shows that… |
|---|---|---|---|---|
| 1 | Salesforce Advanced **$350** per user / month | $395 | **Needs review** (high): affects *Mock Pricing Plan*, Ada notified | a wrong number in a meeting reaches the strategy and its owner |
| 2 | Microsoft Dynamics Sales Enterprise **$105** per user / month | $105 | green **Up to date**, fades | it does not cry wolf |
| 3 | HubSpot Enterprise onboarding fee **$3,000** | $3,500 | green **Fact updated** at once, no review | low-stakes facts fix themselves, nobody is bothered |
| 4 | HubSpot Sales Hub Enterprise **$120** a seat / month | $150 | **Needs review** (medium): Ada reviews, no strategy flagged | medium facts ask one person, no alarm |
| 5 | Apple gives **30 days** to return anything | 14 days | **Needs review** (medium): Sam reviews | it works beyond pricing |
| 6 | Nike's CEO is **John Donahoe** | Elliott Hill | **Needs review** (high): affects *Mock Nike Account Plan*, Tess notified | it checks names, not just numbers |
| 7 | Salesforce's premium plan is called **Unlimited Edition** | Advanced | **Needs review** (medium): Ada reviews | one page feeds several facts |

The value you say does not matter for the verdict: inLook compares the **stored** fact with the live page.
Saying the stored value just makes the story make sense.

## Before you start

From the repo root:

```bash
scripts/demo-reset.sh
```

It stops everything, reloads the demo data into MongoDB, restarts the backend (which also empties its
5-minute repeat cache) and starts the overlay. **Run it again before every take.** Without it, a claim
repeated within 5 minutes shows an old card with no buttons, and accepted facts stay accepted.

Then:
- Close every other audio source: videos, streams, calls. The mic transcribes everything it hears.
- Optional, on the day: `cd backend && .venv/bin/python -m app.monitors peek` prints what each page says
  now. If a competitor changed a price, update `backend/seed.json` and this table.

## Run it

Click the **eye ball**, then the **microphone bubble**. The ring around the ball moves when it hears you.
After each line, **wait for the card (about 5 seconds)** before the next one. The HUD shows the steps
while it works: *Checking… → Matched → Reading salesforce.com*.

### 1. Salesforce: the headline (high tier)

> **Mira:** "Okay, pricing slide. Where do we stand against Salesforce?"
> **Sam:** "Salesforce Advanced is **three hundred fifty dollars** per user a month, so we're clearly cheaper."

Card: **NEEDS REVIEW · $350 → $395 per user per month**, salesforce.com source, *Affects Mock Pricing
Plan*, *Review by Ada Mockridge ✓ notified*.

> **You:** "We were quoting a stale number. Salesforce is at three ninety-five now. inLook read their live
> pricing page, flagged the pricing plan that depends on it, and told the one person who owns it."

Press **Ctrl+Alt+A** (or click Accept). The number rolls to $395 and the card turns green: **Fact updated**.

### 2. Microsoft: a correct claim (no false alarm)

> **Sam:** "And Microsoft Dynamics Sales Enterprise is **a hundred and five dollars** per user a month."

Card: green **Up to date**, which fades after a few seconds.

> **You:** "When we're right, it stays out of the way."

### 3. HubSpot onboarding: fixes itself (low tier)

> **Sam:** "HubSpot also charges a **three thousand dollar** onboarding fee for Enterprise."

Card: green **Fact updated · $3,000 → $3,500**, applied at once with no review. It fades.

> **You:** "Low-stakes facts just get corrected. Nobody gets pinged."

### 4. HubSpot seat price: one reviewer (medium tier)

> **Sam:** "HubSpot Sales Hub Enterprise is **a hundred twenty dollars** a seat per month."

Card: **NEEDS REVIEW · $120 → $150 per seat per month**, hubspot.com source, *Review by Ada Mockridge*.
No strategy flagged, nobody else notified.

To show the other button, press **Ctrl+Alt+R** (Reject): the card says **Kept** and the stored value stays.

### 5. Apple returns: not just pricing (medium tier)

> **Sam:** "Apple gives customers **thirty days** to return anything."

Card: **NEEDS REVIEW · 30 → 14 days**, apple.com source, *Review by Sam Sample*. Accept with **Ctrl+Alt+A**.

### 6. Nike: a person, not a number (high tier)

> **Sam:** "Our champion at Nike reports straight to the CEO, **John Donahoe**."

Card: **NEEDS REVIEW · John Donahoe → Elliott Hill**, en.wikipedia.org source, *Affects Mock Nike Account
Plan*, *Review by Tess Testwell ✓ notified*.

> **You:** "It's not only prices. We were about to walk into Nike naming the wrong CEO. The account plan
> is flagged and the account owner knows."

### 7. Salesforce edition: a renamed product (medium tier)

> **Sam:** "Salesforce's premium plan is still called **Unlimited Edition**."

Card: **NEEDS REVIEW · Unlimited → Advanced Edition**, salesforce.com source, *Review by Ada Mockridge*.
It reads the same page as point 1: one source page keeps several facts honest.

## Checking text instead of speaking

Every point also works without the mic: select the sentence anywhere on screen (a slide, a doc, this
file) and press **Ctrl+Alt+K**. Good for a noisy room, or to show that it works on written material:

- Salesforce Advanced costs $350 per user per month.
- Microsoft Dynamics Sales Enterprise is $105 per user a month.
- HubSpot charges a $3,000 onboarding fee for Enterprise.
- HubSpot Sales Hub Enterprise costs $120 a seat per month.
- Apple gives you 30 days to return anything.
- Our champion at Nike reports straight to the CEO, John Donahoe.
- Salesforce's premium plan is still called Unlimited Edition.

## Good to know

- **Accept and Reject hotkeys act on the topmost card waiting for review.** New cards appear on top, so
  decide each review before saying the next line, or click the buttons on the card you mean.
- **You do not need all seven.** For a 2-minute pitch, points 1, 2 and 6 tell the story: a stale price
  caught, a correct claim left alone, and a name instead of a number. Keep the rest for questions.
- The HUD holds up to 6 cards; outcomes (Fact updated, Up to date, Kept) fade by themselves.
- Each spoken claim costs about 3 Gemini calls (spot, match, verdict). The free tier has a small daily
  limit, so rehearse with the selection check or the backup below, and keep the live mic for the real run.
- With the mic on, a claim is checked once per mic session; saying it again does nothing until the mic is
  turned off and on again (and after `scripts/demo-reset.sh`, the 5-minute repeat cache is empty too).

## If something goes wrong

| What you see | Do this |
|---|---|
| No card after a line | Say it again, slower, with the number or name clearly. Check that no other audio is playing. |
| Card with no Accept / Reject | It was checked in the last 5 minutes. Run `scripts/demo-reset.sh`. |
| "Could not be checked" | Probably the Gemini daily limit or the network. Switch to the backup. |
| Wrong verdict | Send the backend log (`/tmp/inlook-backend.log`) to the team. Use the backup. |

**Backup with no mic and no AI calls:** `scripts/demo-reset.sh --mock` plays the scripted Salesforce story
(transcript, check, review, Accept) through the same HUD.

**Rehearse without speaking:** with the backend running,
`cd backend && .venv/bin/python -m app.replay fixtures/mic-demo.wav` plays a recording of point 1 into
the mic path.
