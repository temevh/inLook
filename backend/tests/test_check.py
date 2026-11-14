"""The /check flow (app/check.py) with Gemini and Context.dev faked, against the inlook_test database.

Run from backend/: python -m unittest   (needs MONGODB_URI in .env; skipped without it)
Every event goes through EventLog.publish, which validates it against the generated contract.
"""
import asyncio
import base64
import unittest
from unittest.mock import AsyncMock, patch

from app import check, config, events, seed
from app.contract import CheckRequest1, CheckRequest2
from app.services import context_dev, db, gemini

COMPX, REFUND, WIFI = "f-compx-price", "f-refund-window", "f-wifi-name"


def outdated(new_value: str, card: dict | None = None) -> dict:
    return {"verdict": "outdated", "newValue": new_value, "evidence": f"Page now says {new_value}.",
            "card": card if card is not None else {"title": "Fact outdated", "criticality": "high", "fact": "x → y"}}


def text_request(text: str, source_kind: str = "selection") -> CheckRequest1:
    return CheckRequest1(kind="text", text=text, source=source_kind)


class CheckFlowTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not config.MONGODB_URI:
            self.skipTest("MONGODB_URI is not set (backend/.env)")
        # seed.main() clears every collection: it must only ever see the test database.
        self.assertEqual(config.MONGODB_DB, "inlook_test", "refusing to touch the demo database")
        self.addAsyncCleanup(db.close)  # the cached client must be closed in this test's own loop
        await seed.main(verbose=False)
        events.log._events.clear()
        check._route_lock = asyncio.Lock()  # each test has its own event loop
        check._recent.clear()

        self.match = AsyncMock(return_value=None)
        self.verdict = AsyncMock()
        self.fetch = AsyncMock(return_value="page text")
        self.search = AsyncMock(return_value=[{"url": "https://found.example/wifi", "title": "t", "markdown": "wifi page"}])
        self.spot = AsyncMock(side_effect=AssertionError("spot must not be called"))
        for target, name, mock in ((gemini, "match", self.match), (gemini, "verdict_card", self.verdict),
                                   (gemini, "spot", self.spot), (context_dev, "scrape", self.fetch),
                                   (context_dev, "search", self.search)):
            patcher = patch.object(target, name, mock)
            patcher.start()
            self.addCleanup(patcher.stop)

    # helpers -----------------------------------------------------------------------------

    def published(self) -> list[dict]:
        """Every event but the claim.progress steps, which test_progress_steps covers."""
        return [e.model_dump(mode="json") for e in events.log._events if e.root.type != "claim.progress"]

    def steps(self) -> list[dict]:
        return [e.root.payload.model_dump(mode="json") for e in events.log._events if e.root.type == "claim.progress"]

    def types(self) -> list[str]:
        return [e["type"] for e in self.published()]

    async def claim(self, text: str = "Salesforce Advanced costs $350 per user") -> None:
        await check.run_claim(db.new_id("c"), text, text, "selection")

    async def strategy(self, strategy_id: str) -> dict:
        return await db.database().strategies.find_one({"_id": strategy_id})

    # tests -------------------------------------------------------------------------------

    async def test_progress_steps(self):
        """Between spotted and the verdict the HUD is told: which fact matched, then which page is read."""
        self.match.return_value = COMPX
        self.verdict.return_value = outdated("$395 per user per month")
        await self.claim()
        self.assertEqual([e.root.type for e in events.log._events][:4],
                         ["claim.spotted", "claim.progress", "claim.progress", "claim.verdict"])
        matched, reading = self.steps()
        self.assertEqual((matched["step"], matched["factId"], matched["label"]),
                         ("matched", COMPX, "Salesforce Sales Cloud Advanced price per user"))
        self.assertEqual((reading["step"], reading["sourceUrl"]), ("reading", "https://www.salesforce.com/sales/pricing/"))

    async def test_progress_without_a_match_or_a_source_page(self):
        await self.claim("The mascot is a purple llama")
        self.assertEqual(self.steps(), [])  # nothing matched: no steps
        self.match.return_value = WIFI  # no sourceUrl: the web is searched
        self.verdict.return_value = outdated("MockNet-5G")
        await self.claim("Our wifi is called MockNet")
        self.assertEqual([(s["step"], s["sourceUrl"]) for s in self.steps()], [("matched", None), ("reading", None)])

    async def test_a_lost_progress_event_does_not_cost_the_verdict(self):
        self.match.return_value = COMPX
        self.verdict.return_value = outdated("$395 per user per month")
        publish = events.log.publish

        async def flaky(type, payload):
            if type == "claim.progress":
                raise RuntimeError("atlas blip")
            return await publish(type, payload)
        with patch.object(events.log, "publish", flaky):
            await self.claim()
        self.assertEqual(self.types()[:2], ["claim.spotted", "claim.verdict"])

    async def test_no_matching_fact(self):
        await self.claim("The mascot is a purple llama")
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        self.assertEqual(self.published()[1]["payload"]["reason"], "no_match")
        self.fetch.assert_not_awaited()

    async def test_low_tier_updates_at_once(self):
        self.match.return_value = WIFI
        self.verdict.return_value = outdated(
            "MockNet-5G", {"title": "Fact outdated", "criticality": "low", "fact": "Wifi: MockNet → MockNet-5G"})
        await self.claim("Our wifi is called MockNet")
        self.assertEqual(self.types(), ["claim.spotted", "claim.verdict", "fact.updated"])
        fact = await db.get_fact(WIFI)
        self.assertEqual((fact["value"], fact["status"], len(fact["versions"])), ("MockNet-5G", "current", 2))
        self.assertEqual(self.published()[2]["payload"]["version"]["by"], "inlook")
        self.search.assert_awaited_once_with("Our wifi is called MockNet")
        self.fetch.assert_not_awaited()
        self.assertEqual(self.published()[1]["payload"]["sourceUrl"], "https://found.example/wifi")

    async def test_medium_tier_asks_the_person_who_stated_it(self):
        self.match.return_value = REFUND
        self.verdict.return_value = outdated("14 days")
        await self.claim("Our refund window is 30 days")
        self.assertEqual(self.types(), ["claim.spotted", "claim.verdict", "review.created"])
        review = self.published()[2]["payload"]
        self.assertEqual((review["reviewers"], review["tier"]),
                         ([{"id": "p-sam", "name": "Sam Sample", "role": "Support Lead"}], "medium"))
        fact = await db.get_fact(REFUND)
        self.assertEqual((fact["status"], fact["value"]), ("pending_review", "30 days"))  # unchanged until accepted

    async def test_high_tier_flags_strategies_and_notifies_only_owners(self):
        self.match.return_value = COMPX
        self.verdict.return_value = outdated("€39 per seat")
        await self.claim()
        self.assertEqual(self.types(), [
            "claim.spotted", "claim.verdict", "review.created", "strategy.flagged", "message.created"])
        ev = self.published()
        ada = {"id": "p-ada", "name": "Ada Mockridge", "role": "Head of Pricing"}
        self.assertEqual(ev[2]["payload"]["reviewers"], [ada])
        self.assertEqual(ev[3]["payload"]["strategyId"], "s-pricing")
        self.assertEqual(ev[4]["payload"]["to"], [ada])
        stored = await db.database().reviews.find_one({"_id": ev[2]["payload"]["reviewId"]})
        self.assertEqual(stored["reviewers"], ["p-ada"])  # stored as ids, sent as people
        self.assertIn("Mock Pricing Plan", ev[4]["payload"]["text"])
        self.assertEqual((await self.strategy("s-pricing"))["status"], "flagged")
        self.assertEqual((await self.strategy("s-returns"))["status"], "healthy")  # unrelated: untouched

    async def test_the_flows_review_can_be_accepted(self):
        """The review the flow creates is the document POST /reviews resolves."""
        self.match.return_value = COMPX
        self.verdict.return_value = outdated("€39 per seat")
        await self.claim()
        review_id = self.published()[2]["payload"]["reviewId"]
        review, healed = await db.resolve_review(review_id, "accept", "p-ada")
        self.assertEqual((review["status"], [s["_id"] for s in healed]), ("accepted", ["s-pricing"]))
        self.assertEqual((await db.get_fact(COMPX))["value"], "€39 per seat")
        self.assertIsNone(await db.resolve_review(review_id, "accept"))  # already closed

    async def test_current_verdict_changes_nothing(self):
        self.match.return_value = COMPX
        self.verdict.return_value = {"verdict": "current", "newValue": None, "evidence": "Still €59.", "card": {}}
        await self.claim()
        self.assertEqual(self.types(), ["claim.spotted", "claim.verdict"])
        verdict = self.published()[1]["payload"]
        self.assertEqual(verdict["verdict"], "current")
        self.assertIn("still current", verdict["card"]["fact"])
        self.assertEqual(verdict["card"]["criticality"], "high")
        fact = await db.get_fact(COMPX)
        self.assertEqual((fact["value"], fact["status"]), ("$350 per user per month", "current"))

    async def test_criticality_is_always_the_facts_tier(self):
        """Gemini says low; the compx fact is high, so the card must say high."""
        self.match.return_value = COMPX
        self.verdict.return_value = outdated(
            "€39 per seat", {"title": "Fact outdated", "criticality": "low", "fact": "Competitor X: €59 → €39"})
        await self.claim()
        card = self.published()[1]["payload"]["card"]
        self.assertEqual((card["criticality"], card["title"]), ("high", "Fact outdated"))

    async def test_a_low_fact_that_a_strategy_uses_goes_to_review(self):
        """The tier floor: a fact a strategy relies on is at least medium, so no auto-update."""
        await db.database().strategies.update_one({"_id": "s-returns"}, {"$push": {"factIds": WIFI}})
        self.match.return_value = WIFI
        self.verdict.return_value = outdated("MockNet-5G")
        await self.claim("Our wifi is called MockNet")
        self.assertEqual(self.types(), ["claim.spotted", "claim.verdict", "review.created"])
        self.assertEqual(self.published()[2]["payload"]["tier"], "medium")
        self.assertEqual((await db.get_fact(WIFI))["value"], "MockNet")

    async def test_unverifiable_when_the_page_cannot_be_fetched(self):
        self.match.return_value = COMPX
        self.fetch.side_effect = RuntimeError("503 from source")
        await self.claim()
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        self.assertEqual(self.published()[1]["payload"]["reason"], "unverifiable")
        self.verdict.assert_not_awaited()

    async def test_a_gemini_failure_still_closes_the_hud_card(self):
        self.match.side_effect = RuntimeError("quota exceeded")
        await self.claim()
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        self.assertEqual(self.published()[1]["payload"]["reason"], "unverifiable")

    async def test_two_claims_about_one_fact_open_one_review(self):
        self.match.return_value = COMPX
        self.verdict.return_value = outdated("€39 per seat")
        await asyncio.gather(check.run_claim("c-a", "a", "a", "selection"), check.run_claim("c-b", "b", "b", "selection"))
        types = self.types()
        self.assertEqual((types.count("claim.verdict"), types.count("review.created"),
                          types.count("message.created")), (2, 1, 1))

    async def test_a_short_selection_is_one_claim_without_the_spot_call(self):
        await check.run("chk", text_request("Competitor X charges €59"))
        self.spot.assert_not_awaited()
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])

    async def test_a_single_claim_skips_spot_even_when_long(self):
        await check.run("chk", text_request("word " * 80, "claim"))
        self.spot.assert_not_awaited()
        self.assertEqual(self.types().count("claim.spotted"), 1)

    async def test_a_long_selection_goes_through_spot_and_each_claim_is_checked(self):
        self.spot.side_effect = None
        self.spot.return_value = [{"text": "Competitor X charges €59 per seat"}, {"text": "Refunds take 30 days"}]
        await check.run("chk", text_request("Notes from the pricing call. " * 20))
        self.spot.assert_awaited_once()
        types = self.types()
        self.assertEqual((types.count("claim.spotted"), types.count("claim.unverified")), (2, 2))

    async def test_a_selection_with_no_claims_shows_one_closed_card(self):
        self.spot.side_effect = None
        self.spot.return_value = []
        await check.run("chk", text_request("word " * 80))
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        self.assertEqual(self.published()[1]["payload"]["reason"], "no_match")

    async def test_a_failed_spot_closes_the_card(self):
        self.spot.side_effect = RuntimeError("gemini down")
        await check.run("chk", text_request("long " * 80))
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        self.assertEqual(self.published()[1]["payload"]["reason"], "unverifiable")

    async def test_no_search_result_is_unverifiable(self):
        self.match.return_value = WIFI
        self.search.return_value = []
        await self.claim("Our wifi is called MockNet")
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        self.verdict.assert_not_awaited()

    async def test_the_scrape_is_of_the_facts_own_page(self):
        self.match.return_value = COMPX
        self.verdict.return_value = outdated("$12 per seat per month")
        await self.claim()
        self.fetch.assert_awaited_once_with("https://www.salesforce.com/sales/pricing/")
        self.search.assert_not_awaited()

    # page re-checks (no spoken claim) ----------------------------------------------------

    async def test_recheck_of_a_changed_page_runs_the_high_tier_route(self):
        self.verdict.return_value = outdated("$12 per seat per month")
        # The seed has a second fact on this page (the edition name); this test is about the price fact.
        await db.database().facts.delete_one({"_id": "f-salesforce-edition"})
        count = await check.recheck_url("https://www.salesforce.com/sales/pricing/")
        self.assertEqual(count, 1)
        self.match.assert_not_awaited()  # the fact is known: no match call
        self.assertEqual(self.types(), [
            "claim.spotted", "claim.verdict", "review.created", "strategy.flagged", "message.created"])
        spotted = self.published()[0]["payload"]
        self.assertEqual(spotted["source"], "page")
        self.assertIn("Salesforce Sales Cloud Advanced price per user", spotted["text"])

    async def test_recheck_of_an_unknown_page_does_nothing(self):
        self.assertEqual(await check.recheck_url("https://nobody.example/"), 0)
        self.assertEqual(self.types(), [])

    async def test_a_failed_scrape_closes_the_recheck_card(self):
        self.fetch.side_effect = RuntimeError("context.dev 500")
        await check.recheck_fact(await db.get_fact(COMPX))
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])

    async def test_a_fact_checked_moments_ago_is_not_checked_again(self):
        self.match.return_value = REFUND
        self.verdict.return_value = {"verdict": "current", "newValue": None, "evidence": "Still 30.", "card": {}}
        await self.claim("Our refund window is 30 days")
        await self.claim("Refunds: 30 days, as I said")
        self.assertEqual(self.fetch.await_count, 1)  # one Context.dev scrape, one Gemini verdict
        self.assertEqual(self.verdict.await_count, 1)
        verdicts = [e["payload"] for e in self.published() if e["type"] == "claim.verdict"]
        self.assertEqual(len(verdicts), 2)
        self.assertNotEqual(verdicts[0]["claimId"], verdicts[1]["claimId"])
        self.assertEqual(verdicts[0]["evidence"], verdicts[1]["evidence"])

    async def test_a_page_recheck_ignores_the_repeat_window(self):
        self.match.return_value = REFUND
        self.verdict.return_value = {"verdict": "current", "newValue": None, "evidence": "Still 30.", "card": {}}
        await self.claim("Our refund window is 30 days")
        await check.recheck_fact(await db.get_fact(REFUND))
        self.assertEqual(self.fetch.await_count, 2)

    async def test_check_claim_returns_at_once_and_checks_in_the_background(self):
        claim_id = check.check_claim("The mascot is a llama", "uh, the mascot's a llama", "audio", speaker="p-ada")
        self.assertEqual(self.types(), [])  # nothing yet: fire and forget
        await asyncio.gather(*check._tasks)
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])
        spotted = self.published()[0]["payload"]
        self.assertEqual((spotted["claimId"], spotted["text"], spotted["source"]),
                         (claim_id, "The mascot is a llama", "audio"))

    async def test_a_screenshot_is_read_by_vision(self):
        vision = AsyncMock(return_value=[{"text": "Competitor X charges €59 per seat"}])
        with patch.object(gemini, "vision", vision):
            png = base64.b64encode(b"\x89PNG-fake").decode()
            await check.run("chk", CheckRequest2(kind="image", mime="image/png", dataBase64=png, source="screenshot"))
        vision.assert_awaited_once_with(b"\x89PNG-fake")
        self.assertEqual(self.published()[0]["payload"]["source"], "screenshot")



class SeedTest(unittest.TestCase):
    def test_seed_json_ids_and_tier_floor(self):
        import json, tempfile, pathlib
        data = json.loads(seed.SEED_FILE.read_text())
        data["strategies"][0]["factIds"].append("f-wifi-name")  # now a strategy uses the low fact
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "seed.json"
            path.write_text(json.dumps(data))
            docs = seed.load(path)
        wifi = next(f for f in docs["facts"] if f["_id"] == "f-wifi-name")
        self.assertEqual(wifi["tier"], "medium")
        self.assertNotIn("id", wifi)
        self.assertEqual({p["_id"] for p in docs["people"]}, {"p-ada", "p-sam", "p-mira", "p-tess"})
        self.assertTrue(all(p.get("role") for p in docs["people"]))


if __name__ == "__main__":
    unittest.main()
