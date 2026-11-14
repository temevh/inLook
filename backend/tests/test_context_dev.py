"""Context.dev: the client against a mocked API, webhook signatures, and POST /webhooks/context + /recheck
over HTTP (ASGI, no network). Run from backend/: python -m unittest
"""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app import check, config, seed
from app.main import app
from app.services import context_dev, db

SECRET = "whsec_test"


class FakeApi:
    """Records requests and answers with canned JSON per (method, path)."""

    def __init__(self, routes: dict):
        self.routes, self.requests = routes, []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.routes[(request.method, request.url.path)]
        return httpx.Response(status, json=body)


class ClientTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for name, value in (("CONTEXT_DEV_API_KEY", "key-123"),):
            patcher = patch.object(config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def use(self, routes: dict) -> FakeApi:
        api = FakeApi(routes)
        patcher = patch.object(context_dev, "_transport", httpx.MockTransport(api))
        patcher.start()
        self.addCleanup(patcher.stop)
        return api

    async def test_scrape_asks_for_fresh_markdown(self):
        api = self.use({("POST", "/v1/web/scrape"): (200, {"markdown": {"success": True, "data": "# Pricing\n$12"}})})
        self.assertEqual(await context_dev.scrape("https://www.notion.com/pricing"), "# Pricing\n$12")
        sent = json.loads(api.requests[0].content)
        self.assertEqual((sent["url"], sent["formats"], sent["maxAgeMs"]),
                         ("https://www.notion.com/pricing", {"markdown": True}, 0))
        self.assertEqual(api.requests[0].headers["authorization"], "Bearer key-123")

    async def test_scrape_errors_raise(self):
        self.use({("POST", "/v1/web/scrape"): (502, {"error": "upstream"})})
        with self.assertRaises(context_dev.ContextDevError):
            await context_dev.scrape("https://x.example/")

    async def test_scrape_without_markdown_raises(self):
        self.use({("POST", "/v1/web/scrape"): (200, {"markdown": {"success": False, "error": {"code": "BLOCKED"}}})})
        with self.assertRaises(context_dev.ContextDevError):
            await context_dev.scrape("https://x.example/")

    async def test_no_key_raises_before_any_request(self):
        with patch.object(config, "CONTEXT_DEV_API_KEY", ""), self.assertRaises(context_dev.ContextDevError):
            await context_dev.scrape("https://x.example/")

    async def test_search_keeps_results_with_content(self):
        self.use({("POST", "/v1/web/search"): (200, {"results": [
            {"url": "https://a.example", "title": "A", "markdown": {"markdown": None}},
            {"url": "https://b.example", "title": "B", "markdown": {"markdown": "body b"}},
        ]})})
        self.assertEqual(await context_dev.search("q"), [{"url": "https://b.example", "title": "B", "markdown": "body b"}])

    async def test_create_monitor_body(self):
        api = self.use({("POST", "/v1/monitors"): (201, {"id": "mon_1", "webhook": {"secret": SECRET}})})
        await context_dev.create_monitor("https://p.example", "https://hook.example/webhooks/context", "n")
        sent = json.loads(api.requests[0].content)
        self.assertEqual(sent["target"], {"type": "page", "url": "https://p.example"})
        self.assertEqual(sent["webhook"]["events"], ["change.detected"])
        self.assertEqual(sent["schedule"], {"type": "interval", "frequency": 10, "unit": "minutes"})


class SignatureTest(unittest.TestCase):
    body = b'{"id":"evt_1"}'

    def test_valid(self):
        self.assertTrue(context_dev.verify_webhook(self.body, context_dev.sign(self.body, SECRET), ["other", SECRET]))

    def test_wrong_secret_body_or_header(self):
        header = context_dev.sign(self.body, SECRET)
        self.assertFalse(context_dev.verify_webhook(self.body, header, ["whsec_other"]))
        self.assertFalse(context_dev.verify_webhook(b'{"id":"evt_2"}', header, [SECRET]))
        self.assertFalse(context_dev.verify_webhook(self.body, "", [SECRET]))
        self.assertFalse(context_dev.verify_webhook(self.body, "t=1,v1=zz", [SECRET]))

    def test_old_timestamp(self):
        header = context_dev.sign(self.body, SECRET, t=1_000_000)
        self.assertFalse(context_dev.verify_webhook(self.body, header, [SECRET]))
        self.assertTrue(context_dev.verify_webhook(self.body, header, [SECRET], now=1_000_100))


class EndpointTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not config.MONGODB_URI:
            self.skipTest("MONGODB_URI is not set (backend/.env)")
        self.assertEqual(config.MONGODB_DB, "inlook_test", "refusing to touch the demo database")
        self.addAsyncCleanup(db.close)
        await seed.main(verbose=False)
        for name in ("monitors", "webhook_events"):
            await db.database()[name].delete_many({})
        await db.save_monitor("mon_1", "https://www.notion.com/pricing", SECRET)
        self.recheck_url = AsyncMock(return_value=1)
        self.recheck_fact = AsyncMock()
        for name, mock in (("recheck_url", self.recheck_url), ("recheck_fact", self.recheck_fact)):
            patcher = patch.object(check, name, mock)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addAsyncCleanup(self.http.aclose)

    async def deliver(self, event: dict, secret: str = SECRET, event_id: str | None = None) -> httpx.Response:
        raw = json.dumps(event).encode()
        return await self.http.post("/webhooks/context", content=raw, headers={
            "content-type": "application/json", "x-context-signature": context_dev.sign(raw, secret),
            "x-context-id": event_id or event["id"], "x-context-event": event["event"]})

    def change(self, event_id: str = "evt_1", url: str = "https://www.notion.com/pricing") -> dict:
        return {"event": "change.detected", "id": event_id, "created_at": "2026-11-14T10:00:00Z",
                "data": {"change": {"id": "chg_1", "monitor_id": "mon_1", "url": url}}}

    async def test_change_detected_rechecks_the_page_once(self):
        r = await self.deliver(self.change())
        await asyncio.sleep(0)  # the background task
        self.assertEqual(r.status_code, 204)
        self.recheck_url.assert_awaited_once_with("https://www.notion.com/pricing")
        again = await self.deliver(self.change())  # a Context.dev retry: same event id
        await asyncio.sleep(0)
        self.assertEqual(again.status_code, 204)
        self.assertEqual(self.recheck_url.await_count, 1)

    async def test_bad_signature_is_401(self):
        r = await self.deliver(self.change(), secret="whsec_wrong")
        self.assertEqual(r.status_code, 401)
        self.recheck_url.assert_not_awaited()

    async def test_mismatched_event_id_is_400(self):
        r = await self.deliver(self.change(), event_id="evt_other")
        self.assertEqual(r.status_code, 400)

    async def test_run_completed_is_acknowledged_and_ignored(self):
        r = await self.deliver({"event": "run.completed", "id": "evt_9", "data": {"run": {}, "change": None}})
        await asyncio.sleep(0)
        self.assertEqual(r.status_code, 204)
        self.recheck_url.assert_not_awaited()

    async def test_recheck_by_fact(self):
        r = await self.http.post("/recheck", json={"factId": "f-compx-price"})
        await asyncio.sleep(0)
        self.assertEqual((r.status_code, r.json()), (202, {"accepted": True, "facts": 1}))
        self.assertEqual(self.recheck_fact.await_args.args[0]["_id"], "f-compx-price")

    async def test_recheck_by_url(self):
        r = await self.http.post("/recheck", json={"url": "https://www.apple.com/shop/help/returns_refund"})
        await asyncio.sleep(0)
        self.assertEqual(r.status_code, 202)
        self.recheck_url.assert_awaited_once_with("https://www.apple.com/shop/help/returns_refund")

    async def test_recheck_errors(self):
        self.assertEqual((await self.http.post("/recheck", json={})).status_code, 422)
        self.assertEqual((await self.http.post("/recheck", json={"factId": "f-nope"})).status_code, 404)
        self.assertEqual((await self.http.post("/recheck", json={"url": "https://nobody.example"})).status_code, 404)


if __name__ == "__main__":
    unittest.main()
