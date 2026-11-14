"""The MongoDB event log behind GET /stream, against the inlook_test database. Run from backend/: python -m unittest"""
import asyncio
import unittest

from app import config
from app.events import MongoEventLog
from app.services import db


class MongoEventLogTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not config.MONGODB_URI:
            self.skipTest("MONGODB_URI is not set (backend/.env)")
        self.assertEqual(config.MONGODB_DB, "inlook_test", "refusing to touch the demo database")
        self.addAsyncCleanup(db.close)
        await db.database().events.delete_many({})

    async def frames(self, log: MongoEventLog, after: int, count: int) -> list[str]:
        out = []
        async def take():
            async for frame in log.follow(after):
                if not frame.startswith(":"):
                    out.append(frame)
                if len(out) == count:
                    return
        await asyncio.wait_for(take(), 10)
        return out

    async def test_an_old_shape_event_is_skipped_not_fatal(self):
        """An event stored before the Person change (`to` as bare ids) must not end the stream."""
        log = MongoEventLog()
        start = await db.next_event_seq()
        await db.insert_event({"seq": start + 1, "type": "message.created", "at": db.now(), "payload": {
            "messageId": "m-old", "to": ["p-ada"], "strategyId": "s-pricing", "factId": "f-compx-price", "text": "old"}})
        await db.database().counters.update_one({"_id": "events"}, {"$set": {"seq": start + 1}})
        good = await log.publish("claim.unverified", {"claimId": "c-1", "reason": "no_match"})
        frames = await self.frames(log, start, 1)
        self.assertEqual(len(frames), 1)
        self.assertIn(f":{good.root.seq}\n", frames[0])
        self.assertIn('"claim.unverified"', frames[0])


if __name__ == "__main__":
    unittest.main()
