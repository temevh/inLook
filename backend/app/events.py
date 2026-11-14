"""Append-only event log with a seq cursor, served as SSE: replay after
Last-Event-ID, then follow, with keep-alives.

Every event is validated against the contract (app/contract.py, generated from
shared/event.schema.json) before it is stored, so the overlay never drops one.
"""
import asyncio
import secrets
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from .contract import InlookEvent

KEEPALIVE_S = 15.0

# seq restarts at 1 with the process. SSE ids are `<bootId>:<seq>`: a client resuming
# with another boot id gets the whole current log.
BOOT_ID = secrets.token_hex(4)


class EventLog:
    # shortcut: in memory and never trimmed, fine for one demo session; move to a store before long runs.
    def __init__(self) -> None:
        self._events: list[InlookEvent] = []
        self._cond = asyncio.Condition()

    async def publish(self, type: str, payload: dict) -> InlookEvent:
        """Raises pydantic.ValidationError if the payload breaks the contract."""
        async with self._cond:
            event = InlookEvent.model_validate({
                "seq": len(self._events) + 1,
                "type": type,
                "payload": payload,
                "at": datetime.now(timezone.utc),
            })
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
                yield f"id: {BOOT_ID}:{cursor}\ndata: {event.model_dump_json()}\n\n"
            async with self._cond:
                try:
                    await asyncio.wait_for(
                        self._cond.wait_for(lambda: len(self._events) > cursor), KEEPALIVE_S
                    )
                except TimeoutError:
                    yield ": keep-alive\n\n"


log = EventLog()
