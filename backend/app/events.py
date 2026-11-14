"""Append-only event log with a seq cursor, served as SSE.

Pattern from Goblin Drill (routes_live.py:272, sim/live.py:55): replay after
Last-Event-ID, then follow; keep-alives; no-buffering headers.

DEV STAND-IN: the log is in memory. The spec's target is a MongoDB `events`
collection with a change stream in place of polling (UNCONFIRMED, see db.py).
"""
import asyncio
import json
import secrets
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from .contract import Event, EventType

KEEPALIVE_S = 15.0

# The log is in memory, so seq restarts at 1 whenever the process restarts. SSE ids are
# `<bootId>:<seq>`: a client resuming with another boot id gets the whole current log.
BOOT_ID = secrets.token_hex(4)


class EventLog:
    def __init__(self) -> None:
        self._events: list[Event] = []
        self._cond = asyncio.Condition()

    async def publish(self, type: EventType, payload: dict) -> Event:
        async with self._cond:
            event = Event(
                seq=len(self._events) + 1,
                type=type,
                payload=payload,
                at=datetime.now(timezone.utc).isoformat(),
            )
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
            pending = self._events[cursor:]
            for event in pending:
                cursor = event.seq
                yield f"id: {BOOT_ID}:{event.seq}\nevent: {event.type}\ndata: {json.dumps(event.model_dump())}\n\n"
            async with self._cond:
                try:
                    await asyncio.wait_for(
                        self._cond.wait_for(lambda: len(self._events) > cursor), KEEPALIVE_S
                    )
                except TimeoutError:
                    yield ": keep-alive\n\n"


log = EventLog()
