"""The mic path behind WS /audio/stream (spec "Fact-check flow", shared/CONTRACT.md).

    overlay mic frames (PCM s16le, mono, 16 kHz, 100 ms)
      → ElevenLabs realtime STT (services/stt.py): a line is committed after a pause, with speaker labels
      → transcript.line {lineId, speaker, text}
      → prefilter (a number, a currency, a word from a stored fact) → Gemini spot, batched
      → check.check_claim(text, quote, "audio", speaker, lineId): claim.spotted → verdict → routing

One overlay connection is one transcribing session (`relay`). Frames wait in a short queue while
ElevenLabs connects; if ElevenLabs drops, the session reconnects up to RECONNECTS times, and after that
(or at once without a key, with a rejected key or no credits) the rest of the session's audio is discarded.

Speakers: labels ("speaker_0", ...) map to config.SPEAKERS in the order people first speak, then
"Speaker N". A line whose labels do not arrive within DIARIZE_WAIT_S is shown as "Speaker".

Gemini quota: small talk never reaches Gemini (SPOT_PREFILTER), lines are spotted in one call per batch
(SPOT_DEBOUNCE_S), and a claim already checked in this session is not checked again. Each spoken claim
costs three Gemini calls in all (spot, match, verdict).
"""
import asyncio
import contextlib
import logging
import re
from collections import Counter, deque

from starlette.websockets import WebSocket, WebSocketDisconnect

from . import check, config
from .events import log
from .services import db, gemini, stt

logger = logging.getLogger("inlook.listen")

FRAME_BYTES = 3200          # 100 ms of 16 kHz s16le mono
QUEUE_FRAMES = 30           # ~3 s held while ElevenLabs (re)connects; older frames are dropped
RECONNECTS = 2              # per session, after a working connection drops or a connect fails
FLUSH_SILENCE_S = 1.2       # sent after the overlay stops, so voice-activity detection commits the last words
FLUSH_WAIT_S = 3.0          # then how long to wait for that last line
DIARIZE_WAIT_S = 0.6        # a committed line waits this long for its speaker labels
CONTEXT_LINES = 2           # earlier lines sent with a spot batch, so "it" and "they" can be resolved
UNKNOWN_SPEAKER = "Speaker"

_PREFILTER = re.compile(
    r"\d|[$€£¥%]|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|"
    r"forty|fifty|sixty|hundred|thousand|million|billion|percent|half|dozen|dollars?|euros?|pounds?|cents?|"
    r"bucks|days?|weeks?|months?|years?|hours?|per)\b",
    re.IGNORECASE,
)
_NOT_KEYWORDS = {"benchmark", "competitor", "with", "from", "this", "that", "what", "have"}


def fact_keywords(facts: list[dict]) -> set[str]:
    """Words (4+ letters) from each fact's label and key: 'Notion Plus price per seat' → notion, plus, ..."""
    words = set()
    for fact in facts:
        for part in (fact.get("label") or "", fact.get("key") or ""):
            words.update(w for w in re.split(r"[^a-z0-9]+", part.lower()) if len(w) >= 4)
    return words - _NOT_KEYWORDS


def worth_spotting(text: str, keywords: set[str]) -> bool:
    """Could this line hold a checkable claim? Cheap, so Gemini only sees lines that might."""
    if _PREFILTER.search(text):
        return True
    return any(w in keywords for w in re.findall(r"[a-z0-9]+", text.lower()))


def can_check() -> bool:
    """Claims need the stored facts: no database (or Atlas down at startup) means transcript only."""
    return bool(config.MONGODB_URI) and not getattr(log, "offline", False)


def _normal(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9$€£%]+", text.lower()))


class Listener:
    """Turns ElevenLabs messages into transcript lines and claims, for one overlay session."""

    def __init__(self) -> None:
        self._names: dict[str, str] = {}        # speaker label → name
        self._merged: dict[str, str] = {}       # speaker label → the label it was merged into
        self._segments: dict[int, tuple[str, asyncio.Task]] = {}  # committed, waiting for speaker labels
        self._published: set[int] = set()       # segment indices already shown (per ElevenLabs connection)
        self._lines: deque[dict] = deque(maxlen=50)
        self._pending: list[dict] = []          # lines waiting for the next spot batch
        self._spot_timer: asyncio.Task | None = None
        self._spot_lock = asyncio.Lock()
        self._seen: set[str] = set()            # claims already checked this session
        self._keywords: set[str] = set()
        self._checking = False
        self.partial_open = False               # words heard that are not committed yet
        self.messages = 0                       # since the current ElevenLabs connection opened
        self.line_count = 0

    async def start(self) -> None:
        self._checking = can_check()
        if not self._checking:
            logger.warning("mic: no database for this run; transcript only, claims are not checked")
        elif config.SPOT_PREFILTER:
            try:
                self._keywords = fact_keywords(await db.list_facts())
            except Exception as exc:
                logger.warning("mic: could not load fact keywords (%s); prefilter uses numbers only", exc)

    async def new_upstream(self) -> None:
        """A new ElevenLabs connection: segment indices start again at 0."""
        for index in list(self._segments):
            await self._without_speaker(index, wait=False)
        self._published.clear()
        self.partial_open = False
        self.messages = 0

    async def handle(self, msg: dict) -> None:
        self.messages += 1
        kind = msg.get("message_type")
        if kind == "partial_transcript":
            self.partial_open = bool((msg.get("text") or "").strip())
        elif kind == "committed_transcript":
            self.partial_open = False
            text, index = (msg.get("text") or "").strip(), msg.get("segment_index")
            if not stt.diarizing() or not isinstance(index, int):
                await self._line(text, UNKNOWN_SPEAKER)
            elif index not in self._published and index not in self._segments:
                self._segments[index] = (text, asyncio.create_task(self._without_speaker(index)))
        elif kind == "diarized_transcript":
            index = msg.get("segment_index")
            if not isinstance(index, int) or index in self._published:
                return  # already shown without speaker labels
            waiting = self._segments.pop(index, None)
            if waiting:
                waiting[1].cancel()
            self._published.add(index)
            text = (msg.get("text") or (waiting[0] if waiting else "")).strip()
            await self._line(text, self._name(_majority_speaker(msg.get("words") or [])))
        elif kind == "speakers_merged":
            src, dst = msg.get("from_speaker_id"), msg.get("to_speaker_id")
            if src and dst and src != dst:
                self._merged[src] = dst
        elif kind == "session_started":
            logger.info("mic: elevenlabs session %s", msg.get("session_id"))

    async def close(self) -> None:
        """The overlay stopped: show what is still waiting, and spot it (a claim said just before stopping)."""
        for index in list(self._segments):
            await self._without_speaker(index, wait=False)
        if self._spot_timer:
            self._spot_timer.cancel()
            self._spot_timer = None
        if self._pending:
            check.start_background(self._spot())

    # lines ---------------------------------------------------------------------------------

    async def _without_speaker(self, index: int, wait: bool = True) -> None:
        if wait:
            await asyncio.sleep(DIARIZE_WAIT_S)
        waiting = self._segments.pop(index, None)
        if waiting is None:
            return
        if not wait:
            waiting[1].cancel()
        self._published.add(index)
        await self._line(waiting[0], UNKNOWN_SPEAKER)

    def _name(self, label: str | None) -> str:
        if not label:
            return UNKNOWN_SPEAKER
        seen = set()
        while label in self._merged and label not in seen:
            seen.add(label)
            label = self._merged[label]
        if label not in self._names:
            i = len(self._names)
            self._names[label] = config.SPEAKERS[i] if i < len(config.SPEAKERS) else f"Speaker {i + 1}"
        return self._names[label]

    async def _line(self, text: str, speaker: str) -> None:
        if not re.search(r"\w", text):
            return
        line = {"lineId": db.new_id("l"), "speaker": speaker, "text": text}
        try:
            await log.publish("transcript.line", line)
        except Exception:
            logger.exception("mic: could not publish a transcript line")
            return
        self.line_count += 1
        self._lines.append(line)
        if self._checking and (not config.SPOT_PREFILTER or worth_spotting(text, self._keywords)):
            self._pending.append(line)
            if self._spot_timer is None:
                self._spot_timer = asyncio.create_task(self._spot_after(config.SPOT_DEBOUNCE_S))

    # claims --------------------------------------------------------------------------------

    async def _spot_after(self, delay: float) -> None:
        await asyncio.sleep(delay)
        self._spot_timer = None
        await self._spot()

    async def _spot(self) -> None:
        """One Gemini spot call for the waiting lines (plus a little context), then a check per new claim."""
        async with self._spot_lock:
            batch, self._pending = self._pending, []
            if not batch:
                return
            lines = list(self._lines)
            first = next((i for i, l in enumerate(lines) if l is batch[0]), len(lines))
            context = [l for l in lines[max(0, first - CONTEXT_LINES):first] if l not in batch]
            by_id = {l["lineId"]: l for l in batch}
            try:
                claims = await gemini.spot(context + batch)
            except Exception:
                logger.exception("mic: spot failed for %d line(s)", len(batch))
                return
            started = 0
            for claim in claims:
                line_id = claim.get("lineId")
                if line_id and line_id not in by_id:
                    continue  # from a context line, which had its own chance
                key = _normal(claim["text"])
                if not key or key in self._seen:
                    continue
                self._seen.add(key)
                line = by_id.get(line_id) or batch[-1]
                check.check_claim(claim["text"], claim.get("quote") or claim["text"], "audio",
                                  line["speaker"], line["lineId"])
                started += 1
                if started == check.MAX_CLAIMS:
                    break


def _majority_speaker(words: list[dict]) -> str | None:
    labels = Counter(w.get("speaker_id") for w in words if w.get("type", "word") == "word" and w.get("speaker_id"))
    return labels.most_common(1)[0][0] if labels else None


# relay -------------------------------------------------------------------------------------

def _put(frames: asyncio.Queue, item: bytes | None, stats: dict) -> None:
    """Never blocks the overlay: when the queue is full the oldest frame goes."""
    while frames.full():
        frames.get_nowait()
        stats["dropped"] += 1
    frames.put_nowait(item)


async def _read_overlay(ws: WebSocket, frames: asyncio.Queue, stats: dict, ended: asyncio.Event) -> None:
    """Overlay frames into the queue; None marks the end of the session, and so does `ended`."""
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                stats["frames"] += 1
                _put(frames, msg["bytes"], stats)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _put(frames, None, stats)
        ended.set()


def _fatal(exc: BaseException) -> bool:
    """Would another connection fail the same way? (no key, rejected key, no credits, bad settings)"""
    if isinstance(exc, stt.SttError):
        return exc.fatal
    status = getattr(getattr(exc, "response", None), "status_code", None)
    return status in (401, 403)


async def _run_session(session: stt.Session, frames: asyncio.Queue, listener: Listener) -> None:
    """Relay until the overlay stops (returns) or ElevenLabs fails (raises)."""

    async def send() -> None:
        while (pcm := await frames.get()) is not None:
            await session.send(pcm)
        for _ in range(round(FLUSH_SILENCE_S * 1000 / 100)):
            await session.send(bytes(FRAME_BYTES))

    async def receive() -> None:
        async for msg in session.messages():
            await listener.handle(msg)
        raise stt.SttError("closed", "the server ended the session")

    sender, receiver = asyncio.create_task(send()), asyncio.create_task(receive())
    try:
        done, _ = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        if sender in done and sender.exception() is None:
            # The overlay stopped. Wait for the last words to be committed, if any are still open.
            deadline = asyncio.get_running_loop().time() + FLUSH_WAIT_S
            while listener.partial_open and not receiver.done() and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.1)
            return
        failed = receiver if receiver in done else sender
        raise failed.exception()
    finally:
        for task in (sender, receiver):
            task.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)
        with contextlib.suppress(Exception):
            await session.close()


async def _transcribe(frames: asyncio.Queue, listener: Listener, ended: asyncio.Event) -> None:
    failures = 0
    while True:
        if ended.is_set() and frames.empty():
            return  # the overlay stopped while ElevenLabs was failing
        try:
            session = await stt.connect()
            await listener.new_upstream()
            await _run_session(session, frames, listener)
            return  # the overlay stopped
        except Exception as exc:
            if listener.messages:
                failures = 0  # that connection worked for a while
            failures += 1
            if _fatal(exc) or failures > RECONNECTS:
                logger.warning("mic: speech-to-text unavailable (%s: %s); discarding the rest of this session's "
                               "audio", type(exc).__name__, exc)
                break
            logger.warning("mic: speech-to-text failed (%s: %s); reconnecting", type(exc).__name__, exc)
            await asyncio.sleep(min(failures, 3))
    await ended.wait()  # frames keep arriving until then; _put drops them once the queue is full


async def relay(ws: WebSocket) -> None:
    """One transcribing session: the overlay's mic frames → ElevenLabs → transcript lines and claims."""
    stats = {"frames": 0, "dropped": 0}
    frames: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_FRAMES)
    ended = asyncio.Event()
    reader = asyncio.create_task(_read_overlay(ws, frames, stats, ended))
    listener = Listener()
    try:
        await listener.start()
        await _transcribe(frames, listener, ended)
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader
        await listener.close()
        logger.info("mic: session ended, %d frames (%d dropped), %d lines",
                    stats["frames"], stats["dropped"], listener.line_count)
