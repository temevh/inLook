"""Atlas unreachable: the backend still starts and answers. No database needed: db calls are faked.
Run from backend/: python -m unittest
"""
import asyncio
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from pymongo.errors import ServerSelectionTimeoutError

from app import config, events
from app.events import MongoEventLog
from app.main import app
from app.services import db


class OfflineEventLogTest(unittest.IsolatedAsyncioTestCase):
    async def test_unreachable_atlas_starts_fast_on_the_memory_log(self):
        log = MongoEventLog()
        with patch.object(db, "ping", AsyncMock(return_value=False)), \
             patch.object(db, "ensure_indexes", AsyncMock(side_effect=AssertionError("must not be called"))), \
             patch.object(db, "next_event_seq", AsyncMock(side_effect=AssertionError("must not touch Mongo"))):
            t0 = time.monotonic()
            await log.start()
            self.assertLess(time.monotonic() - t0, 1)
            self.assertTrue(log.offline)
            event = await log.publish("claim.unverified", {"claimId": "c-1", "reason": "no_match"})
            self.assertEqual(event.root.seq, 1)
            frame = await asyncio.wait_for(anext(log.follow(0)), 2)
        self.assertIn('"claim.unverified"', frame)
        await log.stop()

    async def test_reachable_atlas_uses_mongo(self):
        log = MongoEventLog()
        with patch.object(db, "ping", AsyncMock(return_value=True)), \
             patch.object(db, "ensure_indexes", AsyncMock()), \
             patch.object(log, "_watch", AsyncMock()):
            await log.start()
        self.assertFalse(log.offline)
        await log.stop()

    async def test_a_failed_read_does_not_end_the_stream(self):
        log = MongoEventLog()
        doc = {"seq": 7, "type": "claim.unverified", "at": "2026-11-14T10:00:00Z",
               "payload": {"claimId": "c-7", "reason": "no_match"}}
        reads = AsyncMock(side_effect=[ServerSelectionTimeoutError("down"), [doc], []])
        with patch.object(db, "events_after", reads), patch.object(events, "POLL_S", 0.01):
            frame = await asyncio.wait_for(anext(log.follow(0)), 2)
        self.assertIn(":7\n", frame)


class OfflineHttpTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        patcher = patch.object(config, "MONGODB_URI", "mongodb://unreachable.invalid")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.addAsyncCleanup(self.http.aclose)

    async def test_health_reports_unreachable(self):
        with patch.object(db, "ping", AsyncMock(return_value=False)):
            r = await self.http.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["ok"], r.json()["database"]), (True, "unreachable"))

    async def test_endpoints_needing_data_answer_503(self):
        down = AsyncMock(side_effect=ServerSelectionTimeoutError("down"))
        with patch.object(db, "resolve_review", down), patch.object(db, "get_fact", down):
            review = await self.http.post("/reviews/r-1", json={"decision": "accept"})
            recheck = await self.http.post("/recheck", json={"factId": "f-1"})
        self.assertEqual((review.status_code, review.json()), (503, {"detail": "database unreachable"}))
        self.assertEqual(recheck.status_code, 503)


if __name__ == "__main__":
    unittest.main()
