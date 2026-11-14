"""Mirror of shared/CONTRACT.md. Change the contract there first.

Request bodies and most event payloads are *proposed*; agree them with the
overlay before relying on them.
"""
from typing import Literal

from pydantic import BaseModel

Tier = Literal["low", "medium", "high"]
EventType = Literal[
    "transcript.line", "claim.spotted", "claim.unverified", "claim.verdict", "fact.updated",
    "review.created", "review.closed", "strategy.flagged", "strategy.healthy", "message.created",
]


class HudCard(BaseModel):
    """shared/card.schema.json. decided"""
    title: Literal["Fact outdated", "Fact updated", "Needs review"]
    criticality: Tier  # copied from the fact's stored tier; checked before sending
    fact: str  # one line, e.g. "Competitor X: €59 → €39 per seat"


class Event(BaseModel):
    """SSE envelope { seq, type, payload, at }. decided"""
    seq: int
    type: EventType
    payload: dict
    at: str


class CheckText(BaseModel):
    kind: Literal["text"]
    text: str
    source: Literal["selection", "claim"]


class CheckImage(BaseModel):
    kind: Literal["image"]
    mime: Literal["image/png"]
    dataBase64: str
    source: Literal["screenshot"]


class ReviewDecision(BaseModel):
    decision: Literal["accept", "reject"]


class Accepted(BaseModel):
    accepted: bool = True
    checkId: str | None = None


class ReviewResult(BaseModel):
    id: str
    status: Literal["accepted", "rejected"]


class DevEvent(BaseModel):
    """POST /dev/events body (INLOOK_DEV=1 only)."""
    type: EventType
    payload: dict
