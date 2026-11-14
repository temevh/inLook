"""The mic path (app/listen.py, app/services/stt.py) with ElevenLabs, Gemini and the check flow faked.
No database needed. Run from backend/: python -m unittest
"""
import asyncio
import base64
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import websockets

from app import check, config, listen
from app.events import EventLog
from app.services import db, gemini, stt

FACTS = [
    {"_id": "f-compx-price", "key": "competitor.notion-plus.price-per-seat", "label": "Notion Plus price per seat"},
    {"_id": "f-refund-window", "key": "benchmark.apple-store.return-window", "label": "Apple Store return window"},
]


def committed(index: int, text: str) -> dict:
    return {"message_type": "committed_transcript", "segment_index": index, "text": text}


def diarized(index: int, text: str, speaker: str) -> dict:
    words = [{"text": w, "type": "word", "speaker_id": speaker} for w in text.split()]
    return {"message_type": "diarized_transcript", "segment_index": index, "text": text, "words": words}


class ListenTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.log = EventLog()
        self.spot = AsyncMock(return_value=[])
        self.check_claim = MagicMock(return_value="c-1")
        for target, name, value in (
            (listen, "log", self.log), (gemini, "spot", self.spot), (check, "check_claim", self.check_claim),
            (db, "list_facts", AsyncMock(return_value=FACTS)), (listen, "DIARIZE_WAIT_S", 0.05),
            (config, "MONGODB_URI", "mongodb://test"), (config, "SPOT_DEBOUNCE_S", 0.05),
            (config, "SPEAKERS", ["Mira Mockwell", "Sam Sample"]), (config, "ELEVENLABS_MODEL", "scribe_v3_live"),
        ):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def lines(self) -> list[dict]:
        return [e.root.payload.model_dump() for e in self.log._events if e.root.type == "transcript.line"]

    async def say(self, listener: listen.Listener, index: int, text: str, speaker: str | None) -> None:
        await listener.handle(committed(index, text))
        if speaker:
            await listener.handle(diarized(index, text, speaker))


class LinesTest(ListenTestCase):
    async def test_speakers_are_named_in_the_order_they_first_speak(self):
        listener = listen.Listener()
        await listener.start()
        for i, (text, speaker) in enumerate([("Hello all", "speaker_0"), ("Hi Mira", "speaker_1"),
                                             ("Let us start", "speaker_0"), ("Sorry I am late", "speaker_2")]):
            await self.say(listener, i, text, speaker)
        self.assertEqual([(l["speaker"], l["text"]) for l in self.lines()], [
            ("Mira Mockwell", "Hello all"), ("Sam Sample", "Hi Mira"),
            ("Mira Mockwell", "Let us start"), ("Speaker 3", "Sorry I am late")])
        self.assertEqual(len({l["lineId"] for l in self.lines()}), 4)

    async def test_a_line_without_speaker_labels_is_shown_after_a_short_wait(self):
        listener = listen.Listener()
        await listener.start()
        await listener.handle(committed(0, "Can everyone hear me"))
        self.assertEqual(self.lines(), [])
        await asyncio.sleep(0.1)
        self.assertEqual([(l["speaker"], l["text"]) for l in self.lines()], [("Speaker", "Can everyone hear me")])
        await listener.handle(diarized(0, "Can everyone hear me", "speaker_0"))  # too late: not shown twice
        self.assertEqual(len(self.lines()), 1)

    async def test_labels_before_the_committed_line_show_it_once(self):
        listener = listen.Listener()
        await listener.start()
        await listener.handle(diarized(0, "Good morning", "speaker_0"))
        await listener.handle(committed(0, "Good morning"))
        await asyncio.sleep(0.1)
        self.assertEqual([(l["speaker"], l["text"]) for l in self.lines()], [("Mira Mockwell", "Good morning")])

    async def test_merged_speakers_keep_one_name(self):
        listener = listen.Listener()
        await listener.start()
        await self.say(listener, 0, "First words", "speaker_0")
        await listener.handle({"message_type": "speakers_merged", "from_speaker_id": "speaker_1",
                               "to_speaker_id": "speaker_0"})
        await self.say(listener, 1, "Still me", "speaker_1")
        self.assertEqual([l["speaker"] for l in self.lines()], ["Mira Mockwell", "Mira Mockwell"])

    async def test_empty_and_punctuation_only_lines_are_skipped(self):
        listener = listen.Listener()
        await listener.start()
        await self.say(listener, 0, " ", "speaker_0")
        await self.say(listener, 1, "...", "speaker_0")
        self.assertEqual(self.lines(), [])

    async def test_a_new_elevenlabs_connection_restarts_segment_numbers(self):
        listener = listen.Listener()
        await listener.start()
        await self.say(listener, 0, "Before the drop", "speaker_0")
        await listener.new_upstream()
        await self.say(listener, 0, "After the drop", "speaker_0")
        self.assertEqual([l["text"] for l in self.lines()], ["Before the drop", "After the drop"])


class SpotTest(ListenTestCase):
    def test_prefilter(self):
        keywords = listen.fact_keywords(FACTS)
        self.assertTrue({"notion", "plus", "price", "seat", "apple", "return", "window"} <= keywords)
        self.assertNotIn("benchmark", keywords)
        for text in ("Notion Plus costs 8 dollars a month", "It is eight dollars", "returns take thirty days",
                     "about 5%", "What does Apple charge?", "€40 per seat"):
            self.assertTrue(listen.worth_spotting(text, keywords), text)
        for text in ("Can everyone see my screen?", "Okay, let's get started", "Thanks, that was great"):
            self.assertFalse(listen.worth_spotting(text, keywords), text)

    async def test_small_talk_never_reaches_gemini(self):
        listener = listen.Listener()
        await listener.start()
        await self.say(listener, 0, "Can everyone see my screen?", "speaker_0")
        await asyncio.sleep(0.15)
        self.spot.assert_not_awaited()

    async def test_lines_are_spotted_in_one_batch_and_each_claim_is_checked_once(self):
        listener = listen.Listener()
        await listener.start()
        self.spot.side_effect = lambda lines: [
            {"text": "Notion Plus costs $8 per member a month", "quote": "Notion Plus costs 8 dollars",
             "lineId": lines[-1]["lineId"]},
            {"text": "Something from the context line", "quote": "x", "lineId": lines[0]["lineId"]},
        ]
        await self.say(listener, 0, "Okay, pricing slide.", "speaker_0")                 # small talk: context only
        await self.say(listener, 1, "Where do we stand against Notion?", "speaker_0")    # keyword
        await self.say(listener, 2, "Notion Plus costs 8 dollars per member a month.", "speaker_1")  # number
        await asyncio.sleep(0.15)
        self.spot.assert_awaited_once()
        sent = self.spot.await_args.args[0]
        self.assertEqual([l["text"] for l in sent], ["Okay, pricing slide.", "Where do we stand against Notion?",
                                                     "Notion Plus costs 8 dollars per member a month."])
        sam_line = self.lines()[2]
        self.check_claim.assert_called_once_with("Notion Plus costs $8 per member a month",
                                                 "Notion Plus costs 8 dollars", "audio", "Sam Sample",
                                                 sam_line["lineId"])
        # The same claim again later: spotted, but not checked a second time.
        self.spot.side_effect = lambda lines: [{"text": "Notion Plus costs $8 per member a month.", "quote": "q",
                                                "lineId": lines[-1]["lineId"]}]
        await self.say(listener, 3, "As I said, Notion Plus is 8 dollars.", "speaker_1")
        await asyncio.sleep(0.15)
        self.assertEqual(self.spot.await_count, 2)
        self.check_claim.assert_called_once()

    async def test_a_claim_said_just_before_the_mic_stops_is_still_checked(self):
        listener = listen.Listener()
        await listener.start()
        self.spot.side_effect = lambda lines: [{"text": "Apple returns take 30 days", "quote": "q", "lineId": ""}]
        await self.say(listener, 0, "Apple returns take 30 days.", "speaker_0")
        await listener.close()
        await asyncio.sleep(0.05)
        self.check_claim.assert_called_once()
        self.assertEqual(self.check_claim.call_args.args[2:4], ("audio", "Mira Mockwell"))

    async def test_without_a_database_the_transcript_still_shows(self):
        with patch.object(config, "MONGODB_URI", ""):
            listener = listen.Listener()
            await listener.start()
            await self.say(listener, 0, "Notion Plus costs 8 dollars.", "speaker_0")
            await asyncio.sleep(0.15)
        self.assertEqual(len(self.lines()), 1)
        self.spot.assert_not_awaited()

    async def test_a_failed_spot_call_does_not_stop_the_session(self):
        listener = listen.Listener()
        await listener.start()
        self.spot.side_effect = RuntimeError("gemini down")
        await self.say(listener, 0, "Notion Plus costs 8 dollars.", "speaker_0")
        await asyncio.sleep(0.15)
        self.spot.side_effect = lambda lines: [{"text": "Apple returns take 14 days", "quote": "q", "lineId": ""}]
        await self.say(listener, 1, "Apple returns take 14 days.", "speaker_0")
        await asyncio.sleep(0.15)
        self.check_claim.assert_called_once()


class FakeOverlay:
    """The overlay side of WS /audio/stream: some frames, then a disconnect."""

    def __init__(self, frames: list[bytes], gap_s: float = 0.01) -> None:
        self._frames, self._gap = list(frames), gap_s

    async def receive(self) -> dict:
        await asyncio.sleep(self._gap)
        if self._frames:
            return {"type": "websocket.receive", "bytes": self._frames.pop(0)}
        return {"type": "websocket.disconnect", "code": 1000}


class RelayTest(ListenTestCase):
    """Against a local fake of the ElevenLabs realtime endpoint."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.connections, self.chunks, self.keys = 0, [], []
        self.script = self.transcribe  # what the fake server does with one connection
        self.server = await websockets.serve(self.handler, "127.0.0.1", 0)
        self.addAsyncCleanup(self.close_server)
        port = self.server.sockets[0].getsockname()[1]
        for target, name, value in ((stt, "URL", f"ws://127.0.0.1:{port}/v1/speech-to-text/realtime"),
                                    (config, "ELEVENLABS_API_KEY", "test-key"), (listen, "FLUSH_WAIT_S", 0.5)):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def close_server(self):
        self.server.close()
        await self.server.wait_closed()

    async def handler(self, ws):
        self.connections += 1
        self.keys.append(ws.request.headers.get("xi-api-key"))
        self.query = ws.request.path
        await self.script(ws)

    async def transcribe(self, ws):
        await ws.send(json.dumps({"message_type": "session_started", "session_id": "s1"}))
        said = False
        async for raw in ws:
            msg = json.loads(raw)
            self.chunks.append(base64.b64decode(msg["audio_base_64"]))
            if len(self.chunks) == 5 and not said:
                said = True
                await ws.send(json.dumps(committed(0, "Notion Plus costs 8 dollars per member a month.")))
                await ws.send(json.dumps(diarized(0, "Notion Plus costs 8 dollars per member a month.", "speaker_0")))

    async def test_frames_are_relayed_and_lines_published(self):
        frames = [bytes([i]) * listen.FRAME_BYTES for i in range(8)]
        await asyncio.wait_for(listen.relay(FakeOverlay(frames)), 5)
        self.assertEqual(self.connections, 1)
        self.assertEqual(self.keys, ["test-key"])
        for part in ("model_id=scribe_v3_live", "audio_format=pcm_16000", "commit_strategy=vad", "diarize=true",
                     "language_code=en"):
            self.assertIn(part, self.query)
        self.assertEqual(self.chunks[:8], frames)  # in order, unchanged
        self.assertTrue(all(c == bytes(listen.FRAME_BYTES) for c in self.chunks[8:]))  # then flush silence
        self.assertEqual([(l["speaker"], l["text"]) for l in self.lines()],
                         [("Mira Mockwell", "Notion Plus costs 8 dollars per member a month.")])
        await asyncio.sleep(0.1)  # spotting the last line runs in the background after the session closes
        self.spot.assert_awaited_once()  # the session's last line is spotted even though the mic stopped

    async def test_a_rejected_key_is_not_retried_and_the_session_still_ends(self):
        async def reject(ws):
            await ws.send(json.dumps({"message_type": "auth_error", "error": "Invalid API key"}))
            await ws.close()
        self.script = reject
        await asyncio.wait_for(listen.relay(FakeOverlay([bytes(listen.FRAME_BYTES)] * 20)), 5)
        self.assertEqual(self.connections, 1)
        self.assertEqual(self.lines(), [])

    async def test_a_dropped_connection_is_reopened(self):
        async def drop_first(ws):
            if self.connections == 1:
                await ws.recv()
                await ws.close(1011, "transcriber restarted")
                return
            await self.transcribe(ws)
        self.script = drop_first
        frames = [bytes([i % 7]) * listen.FRAME_BYTES for i in range(40)]
        await asyncio.wait_for(listen.relay(FakeOverlay(frames, gap_s=0.03)), 10)
        self.assertEqual(self.connections, 2)
        self.assertEqual(len(self.lines()), 1)

    async def test_without_a_key_audio_is_discarded(self):
        with patch.object(config, "ELEVENLABS_API_KEY", ""):
            await asyncio.wait_for(listen.relay(FakeOverlay([bytes(listen.FRAME_BYTES)] * 5)), 5)
        self.assertEqual(self.connections, 0)
        self.assertEqual(self.lines(), [])


if __name__ == "__main__":
    unittest.main()
