"""Run from backend/: python -m unittest"""
import asyncio
import json
import unittest

from pydantic import ValidationError

from app.events import BOOT_ID, EventLog

LINE = {"lineId": "l1", "speaker": "A", "text": "hi"}


class EventLogTest(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_payload_outside_contract(self):
        log = EventLog()
        with self.assertRaises(ValidationError):
            await log.publish("transcript.line", {"lineId": "l1"})
        with self.assertRaises(ValidationError):
            await log.publish("no.such.type", LINE)

    def test_resume_cursor(self):
        self.assertEqual(EventLog.resume_cursor(f"{BOOT_ID}:7"), 7)
        for other in (None, "", "7", "otherboot:7", f"{BOOT_ID}:x", f"{BOOT_ID}:-1"):
            self.assertEqual(EventLog.resume_cursor(other), 0, other)

    async def test_follow_replays_after_cursor_then_follows(self):
        log = EventLog()
        for i in (1, 2):
            await log.publish("transcript.line", {**LINE, "lineId": f"l{i}"})
        frames = log.follow(1)
        first = await anext(frames)
        self.assertTrue(first.startswith(f"id: {BOOT_ID}:2\ndata: "))
        self.assertEqual(json.loads(first.split("data: ", 1)[1])["payload"]["lineId"], "l2")
        nxt = asyncio.ensure_future(anext(frames))
        await log.publish("transcript.line", {**LINE, "lineId": "l3"})
        self.assertIn(f"id: {BOOT_ID}:3\n", await asyncio.wait_for(nxt, 1))


if __name__ == "__main__":
    unittest.main()
