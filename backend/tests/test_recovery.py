"""Timeouts and retries: Gemini calls, the claim deadline, Context.dev calls, event publishing.
No network and no database: every outside call is faked. Run from backend/: python -m unittest
"""
import asyncio
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from google.genai import errors
from pymongo.errors import AutoReconnect, DuplicateKeyError

from app import check, config, events
from app.events import EventLog, MongoEventLog
from app.services import context_dev, db, gemini


def fake_gemini(*steps):
    """A Gemini client whose generate_content plays `steps`: an exception, a number (seconds to hang),
    or a dict (the JSON answer)."""
    calls = []

    async def generate_content(**_):
        step = steps[len(calls)]
        calls.append(step)
        if isinstance(step, BaseException):
            raise step
        if isinstance(step, (int, float)):
            await asyncio.sleep(step)
        return SimpleNamespace(text=json.dumps(step if isinstance(step, dict) else {"factId": ""}))

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return client, calls


class GeminiRetryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for target, name, value in ((config, "GEMINI_TIMEOUT_S", 0.2), (config, "GEMINI_ATTEMPTS", 2),
                                    (gemini, "RETRY_PAUSE_S", 0.01)):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def run_with(self, *steps):
        client, calls = fake_gemini(*steps)
        with patch.object(gemini, "client", lambda: client):
            result = await gemini._generate_json("prompt", {})
        return result, calls

    async def test_a_hanging_call_times_out_and_is_retried(self):
        t0 = time.monotonic()
        result, calls = await self.run_with(5, {"factId": "f-1"})
        self.assertEqual(result, {"factId": "f-1"})
        self.assertEqual(len(calls), 2)
        self.assertLess(time.monotonic() - t0, 1)

    async def test_rate_limit_and_server_error_are_retried(self):
        rate = errors.ClientError(429, {"error": {"code": 429, "message": "slow down", "status": "RESOURCE_EXHAUSTED"}})
        self.assertEqual((await self.run_with(rate, {"factId": "a"}))[0], {"factId": "a"})
        down = errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}})
        self.assertEqual((await self.run_with(down, {"factId": "b"}))[0], {"factId": "b"})

    async def test_a_bad_request_is_not_retried(self):
        bad = errors.ClientError(400, {"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}})
        with self.assertRaises(errors.ClientError):
            await self.run_with(bad, {"factId": "never"})

    async def test_gives_up_after_the_last_attempt(self):
        with self.assertRaises(TimeoutError):
            await self.run_with(5, 5)

    async def test_a_missing_key_fails_at_once(self):
        with patch.object(config, "GEMINI_API_KEY", ""), self.assertRaises(RuntimeError):
            await gemini._generate_json("prompt", {})


class ClaimDeadlineTest(unittest.IsolatedAsyncioTestCase):
    """The claim deadline closes the HUD card; it never cuts routing off half-way."""

    async def asyncSetUp(self):
        self.log = EventLog()
        fact = {"_id": "f-1", "label": "Price", "value": "$8", "tier": "high", "sourceUrl": "https://p.example"}
        for target, name, value in (
            (check, "log", self.log), (config, "CHECK_TIMEOUT_S", 0.2),
            (db, "list_facts", AsyncMock(return_value=[fact])), (db, "fact_tier", AsyncMock(return_value="high")),
            (context_dev, "scrape", AsyncMock(return_value="page")),
        ):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        check._recent.clear()
        self.fact = fact

    def types(self):
        return [e.root.type for e in self.log._events if e.root.type != "claim.progress"]

    async def test_a_hanging_match_closes_the_card_in_time(self):
        async def hang(*_):
            await asyncio.sleep(10)
        with patch.object(gemini, "match", hang):
            t0 = time.monotonic()
            await check.run_claim("c-1", "Price is $8", "price is 8", "selection")
        self.assertLess(time.monotonic() - t0, 1)
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])

    async def test_a_hanging_page_recheck_closes_the_card_in_time(self):
        async def hang(*_):
            await asyncio.sleep(10)
        with patch.object(context_dev, "scrape", hang):
            await check.recheck_fact(self.fact)
        self.assertEqual(self.types(), ["claim.spotted", "claim.unverified"])

    async def test_slow_routing_is_not_cut_off(self):
        """Routing after the verdict takes longer than the deadline and still finishes."""
        async def slow_route(*_):
            await asyncio.sleep(0.4)
            await self.log.publish("strategy.healthy", {"strategyId": "s-1", "name": "S"})
        verdict = {"verdict": "outdated", "newValue": "$10", "evidence": "page says $10", "card": {}}
        with patch.object(gemini, "match", AsyncMock(return_value="f-1")), \
             patch.object(gemini, "verdict_card", AsyncMock(return_value=verdict)), \
             patch.object(check, "_route", slow_route):
            await check.run_claim("c-1", "Price is $8", "price is 8", "selection")
        self.assertEqual(self.types(), ["claim.spotted", "claim.verdict", "strategy.healthy"])


class ContextDevRetryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for target, name, value in ((config, "CONTEXT_DEV_API_KEY", "k"), (context_dev, "RETRY_PAUSE_S", 0.01)):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def answers(self, *responses):
        calls = []

        def handler(request):
            calls.append(request)
            r = responses[len(calls) - 1]
            if isinstance(r, Exception):
                raise r
            return r
        patcher = patch.object(context_dev, "_transport", httpx.MockTransport(handler))
        patcher.start()
        self.addCleanup(patcher.stop)
        return calls

    async def test_a_503_then_success(self):
        calls = self.answers(httpx.Response(503, json={}),
                             httpx.Response(200, json={"markdown": {"success": True, "data": "ok"}}))
        self.assertEqual(await context_dev.scrape("https://p.example"), "ok")
        self.assertEqual(len(calls), 2)

    async def test_a_network_error_then_success(self):
        calls = self.answers(httpx.ConnectTimeout("slow"),
                             httpx.Response(200, json={"markdown": {"success": True, "data": "ok"}}))
        self.assertEqual(await context_dev.scrape("https://p.example"), "ok")
        self.assertEqual(len(calls), 2)

    async def test_two_failures_raise(self):
        self.answers(httpx.Response(502, json={}), httpx.Response(502, json={}))
        with self.assertRaises(context_dev.ContextDevError):
            await context_dev.scrape("https://p.example")

    async def test_a_400_is_not_retried(self):
        calls = self.answers(httpx.Response(400, json={"error": "bad url"}))
        with self.assertRaises(context_dev.ContextDevError):
            await context_dev.scrape("https://p.example")
        self.assertEqual(len(calls), 1)

    async def test_creating_a_monitor_is_never_retried(self):
        calls = self.answers(httpx.Response(503, json={}))
        with self.assertRaises(context_dev.ContextDevError):
            await context_dev.create_monitor("https://p.example", "https://hook.example", "n")
        self.assertEqual(len(calls), 1)


class PublishRetryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        patcher = patch.object(events, "PUBLISH_PAUSE_S", 0.01)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_an_atlas_blip_is_retried(self):
        log = MongoEventLog()
        seq = AsyncMock(side_effect=[AutoReconnect("blip"), 41])
        insert = AsyncMock(side_effect=[AutoReconnect("blip"), None])
        with patch.object(db, "next_event_seq", seq), patch.object(db, "insert_event", insert):
            event = await log.publish("claim.unverified", {"claimId": "c-1", "reason": "no_match"})
        self.assertEqual(event.root.seq, 41)
        self.assertEqual(insert.await_count, 2)

    async def test_an_insert_that_landed_before_the_blip_counts_as_done(self):
        log = MongoEventLog()
        insert = AsyncMock(side_effect=[AutoReconnect("reply lost"), DuplicateKeyError("seq exists")])
        with patch.object(db, "next_event_seq", AsyncMock(return_value=7)), patch.object(db, "insert_event", insert):
            event = await log.publish("claim.unverified", {"claimId": "c-1", "reason": "no_match"})
        self.assertEqual(event.root.seq, 7)

    async def test_a_lasting_outage_raises(self):
        log = MongoEventLog()
        with patch.object(db, "next_event_seq", AsyncMock(side_effect=AutoReconnect("down"))), \
             self.assertRaises(AutoReconnect):
            await log.publish("claim.unverified", {"claimId": "c-1", "reason": "no_match"})


if __name__ == "__main__":
    unittest.main()
