"""Append-only event log with a seq cursor, served as SSE: replay after
Last-Event-ID, then follow, with keep-alives.

Every event is validated against the contract (app/contract.py, generated from
shared/event.schema.json) before it is stored, so the overlay never drops one.

Two implementations, chosen by `config.EVENTS`:

- EventLog: in memory (never trimmed, fine for one demo session). seq restarts at 1 with the process.
- MongoEventLog (default when MONGODB_URI is set): events live in the `events` collection, so they
  survive a restart. One change stream per process wakes the SSE followers the moment an event is
  inserted, whoever inserts it. Followers also poll every POLL_S as a safety net, so a dropped change
  stream costs latency, never events.
"""
import asyncio
import contextlib
import logging
import secrets
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from pydantic import ValidationError

from . import config
from .contract import InlookEvent

KEEPALIVE_S = 15.0
POLL_S = 2.0

# SSE ids are `<bootId>:<seq>`: a client resuming with another boot id gets the whole current log.
BOOT_ID = secrets.token_hex(4)

logger = logging.getLogger("inlook.events")


def _event(seq: int, type: str, payload: dict) -> InlookEvent:
    """Raises pydantic.ValidationError if the payload breaks the contract."""
    return InlookEvent.model_validate({
        "seq": seq,
        "type": type,
        "payload": payload,
        "at": datetime.now(timezone.utc),
    })


def _frame(event: InlookEvent) -> str:
    return f"id: {BOOT_ID}:{event.root.seq}\ndata: {event.model_dump_json()}\n\n"


class EventLog:
    # shortcut: in memory and never trimmed, fine for one demo session; MongoEventLog is the store.
    def __init__(self) -> None:
        self._events: list[InlookEvent] = []
        self._cond = asyncio.Condition()

    async def start(self) -> None:
        """Called once at app startup."""

    async def stop(self) -> None:
        """Called once at app shutdown."""

    async def publish(self, type: str, payload: dict) -> InlookEvent:
        """Raises pydantic.ValidationError if the payload breaks the contract."""
        async with self._cond:
            event = _event(len(self._events) + 1, type, payload)
            self._events.append(event)
            self._cond.notify_all()
        return event

    @staticmethod
    def resume_cursor(last_event_id: str | None) -> int:
        """Seq to replay after, from a Last-Event-ID header. 0 (replay all) unless it is `<BOOT_ID>:<n>`."""
        boot, _, n = (last_event_id or "").partition(":")
        return int(n) if boot == BOOT_ID and n.isascii() and n.isdigit() else 0

    async def follow(self, after: int) -> AsyncIterator[str]:
        """Yield SSE frames for every event with seq > after, then keep following."""
        cursor = after
        while True:
            for event in self._events[cursor:]:
                cursor = event.root.seq
                yield _frame(event)
            async with self._cond:
                try:
                    await asyncio.wait_for(
                        self._cond.wait_for(lambda: len(self._events) > cursor), KEEPALIVE_S
                    )
                except TimeoutError:
                    yield ": keep-alive\n\n"


class MongoEventLog(EventLog):
    """Events in MongoDB, followers woken by a change stream.

    If Atlas does not answer at startup, this process runs on the in-memory log instead (`offline`), so the
    backend still starts and the HUD stream works; restart the backend once Atlas is reachable again.
    """

    def __init__(self) -> None:
        super().__init__()
        self.offline = False
        self._lock = asyncio.Lock()  # one writer at a time: seq order must equal insert order
        self._version = 0  # bumped by the change stream; followers wait for it to move
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        from .services import db
        if not await db.ping():
            self.offline = True
            logger.warning("MongoDB Atlas is unreachable: this run uses the in-memory event log. Endpoints that "
                           "need the database answer 503. Restart the backend once Atlas is reachable.")
            return
        try:
            await db.ensure_indexes()
        except Exception as exc:  # reachable a moment ago: keep going, indexes exist from earlier runs
            logger.warning("could not ensure MongoDB indexes (%s); continuing", exc)
        self._task = asyncio.create_task(self._watch(), name="events-change-stream")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def publish(self, type: str, payload: dict) -> InlookEvent:
        """Raises pydantic.ValidationError if the payload breaks the contract (before any seq is used)."""
        from .services import db
        if self.offline:
            return await super().publish(type, payload)
        _event(1, type, payload)  # validate first, so a bad payload does not burn a seq
        # Followers are woken by the change stream, not here: the same path serves events
        # inserted by another process.
        async with self._lock:
            event = _event(await db.next_event_seq(), type, payload)
            await db.insert_event(event.model_dump(mode="json"))
        return event

    async def _watch(self) -> None:
        """Change stream on `events` inserts. Reconnects after errors."""
        from .services import db
        while True:
            try:
                events = db.database().events
                async with await events.watch([{"$match": {"operationType": "insert"}}]) as stream:
                    logger.info("events change stream open")
                    async for _ in stream:
                        async with self._cond:
                            self._version += 1
                            self._cond.notify_all()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("events change stream failed (%s); retrying in 2 s, polling meanwhile", exc)
                await asyncio.sleep(2)

    async def follow(self, after: int) -> AsyncIterator[str]:
        """Yield SSE frames for every event with seq > after, then keep following.
        A MongoDB error does not end the stream: it waits and retries (keep-alives continue)."""
        from .services import db
        if self.offline:
            async for frame in super().follow(after):
                yield frame
            return
        cursor = after
        last_sent = time.monotonic()
        while True:
            seen = self._version
            try:
                batch = await db.events_after(cursor)
            except Exception as exc:
                logger.warning("events: reading the log failed (%s); retrying in %s s", exc, POLL_S)
                batch = []
            for doc in batch:
                cursor = doc["seq"]
                try:
                    event = InlookEvent.model_validate(doc)
                except ValidationError as err:
                    # Stored before a contract change, or written by another process: skip it rather
                    # than end the stream for every client.
                    logger.warning("events: skipping seq %s (%s), it breaks the contract: %s",
                                   doc.get("seq"), doc.get("type"), err.errors(include_url=False)[:1])
                    continue
                yield _frame(event)
                last_sent = time.monotonic()
            if batch:
                continue
            async with self._cond:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._cond.wait_for(lambda: self._version != seen), POLL_S)
            if time.monotonic() - last_sent >= KEEPALIVE_S:
                yield ": keep-alive\n\n"
                last_sent = time.monotonic()


log: EventLog = MongoEventLog() if config.EVENTS == "mongo" else EventLog()
