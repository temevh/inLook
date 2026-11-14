"""MongoDB (Atlas): async client, indexes and the helpers the check flow needs.

Collections and fields follow the spec's "Data model" (a proposal). Documents use the contract ids as
`_id` (`f-…` facts, `s-…` strategies, `p-…` people, `r-…` reviews, `m-…` messages).

Tiers are plain strings ("low" / "medium" / "high"), as stored; the contract models accept them.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from functools import cache
from typing import Any, Literal

from .. import config

COLLECTIONS = ("facts", "strategies", "people", "reviews", "messages", "events")

Doc = dict[str, Any]
Tier = Literal["low", "medium", "high"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@cache
def client():
    from pymongo import AsyncMongoClient
    if not config.MONGODB_URI:
        raise RuntimeError("MONGODB_URI is not set (backend/.env)")
    timeout = config.MONGODB_TIMEOUT_MS
    return AsyncMongoClient(config.MONGODB_URI, connectTimeoutMS=timeout, serverSelectionTimeoutMS=timeout)


async def ping(timeout_s: float | None = None) -> bool:
    """True if Atlas answers within `timeout_s` (default: the client timeout plus DNS slack). Never raises."""
    timeout_s = timeout_s if timeout_s is not None else config.MONGODB_TIMEOUT_MS / 1000 + 3
    try:
        await asyncio.wait_for(database().command("ping"), timeout_s)
        return True
    except Exception:
        return False


def database():
    return client()[config.MONGODB_DB]


async def close() -> None:
    if client.cache_info().currsize:
        await client().close()
        client.cache_clear()


# --- events (the SSE log) ---------------------------------------------------------------

async def next_event_seq() -> int:
    """Next event seq from a counter document. The counter is not in COLLECTIONS, so the seed
    script's reset never rewinds it: seq stays monotonic and a running overlay keeps working."""
    from pymongo import ReturnDocument
    doc = await database().counters.find_one_and_update(
        {"_id": "events"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return doc["seq"]


async def insert_event(event: Doc) -> None:
    await database().events.insert_one(dict(event))


async def events_after(seq: int, limit: int = 500) -> list[Doc]:
    return await database().events.find({"seq": {"$gt": seq}}, {"_id": 0}).sort("seq", 1).limit(limit).to_list()


async def ensure_indexes() -> None:
    db = database()
    await db.facts.create_index("key", unique=True)
    await db.facts.create_index("sourceUrl")
    await db.strategies.create_index("factIds")
    await db.reviews.create_index([("factId", 1), ("status", 1)])
    await db.events.create_index("seq", unique=True)


# --- facts and strategies ---------------------------------------------------------------

async def list_facts() -> list[Doc]:
    return await database().facts.find().to_list()


async def get_fact(fact_id: str) -> Doc | None:
    return await database().facts.find_one({"_id": fact_id})


async def facts_by_source(source_url: str) -> list[Doc]:
    """Every fact that uses this page (for a page-change webhook or a polling fallback)."""
    return await database().facts.find({"sourceUrl": source_url}).to_list()


async def people(ids: list[str]) -> list[Doc]:
    """People as events carry them: [{id, name, role}], in the order given. An unknown id still appears,
    named by its id, so a review or message never loses a recipient."""
    found = {p["_id"]: p for p in await database().people.find({"_id": {"$in": list(ids)}}).to_list()}
    return [{"id": i, "name": found.get(i, {}).get("name", i), "role": found.get(i, {}).get("role", "")} for i in ids]


async def strategies_using(fact_id: str) -> list[Doc]:
    return await database().strategies.find({"factIds": fact_id}).to_list()


async def fact_tier(fact: Doc) -> Tier:
    """Stored tier with the dependency floor: a fact a strategy relies on is at least medium."""
    stored: Tier = fact["tier"]
    if stored == "low" and await database().strategies.count_documents({"factIds": fact["_id"]}, limit=1):
        return "medium"
    return stored


# --- applying a verdict -----------------------------------------------------------------

async def apply_version(fact_id: str, value: str, source: str | None, by: str) -> Doc:
    """Append a version and make it the fact's value (low tier auto-update, or an accepted review)."""
    version = {"value": value, "source": source or "", "at": now(), "by": by}
    await database().facts.update_one(
        {"_id": fact_id},
        {"$set": {"value": value, "status": "current"}, "$push": {"versions": version}},
    )
    return version


async def get_review(review_id: str) -> Doc | None:
    return await database().reviews.find_one({"_id": review_id})


async def mirror_dev_event(type: str, payload: Doc) -> None:
    """DEV ONLY. Make a hand-injected event real in the database, so the mock scenarios
    (overlay `npm run mock`) can be clicked through: a `review.created` creates that review,
    a `strategy.flagged` flags that strategy. Ignored when the fact or strategy is not seeded."""
    db = database()
    if type == "review.created" and await get_fact(payload["factId"]):
        review = {
            "_id": payload["reviewId"], "factId": payload["factId"], "oldValue": payload["oldValue"],
            "newValue": payload["newValue"], "evidence": payload["evidence"], "tier": payload["tier"],
            "reviewers": [r["id"] if isinstance(r, dict) else r for r in payload["reviewers"]],
            "status": "pending", "createdAt": now(),
        }
        await db.reviews.replace_one({"_id": review["_id"]}, review, upsert=True)
        await db.facts.update_one({"_id": review["factId"]}, {"$set": {"status": "pending_review"}})
    elif type == "strategy.flagged":
        await db.strategies.update_one({"_id": payload["strategyId"]}, {"$set": {"status": "flagged"}})


async def create_review(fact: Doc, new_value: str, evidence: str, tier: Tier, reviewers: list[str]) -> Doc:
    """Open a review and mark the fact pending_review."""
    review = {
        "_id": new_id("r"), "factId": fact["_id"], "oldValue": fact["value"], "newValue": new_value,
        "evidence": evidence, "tier": tier, "reviewers": reviewers, "status": "pending", "createdAt": now(),
    }
    db = database()
    await db.reviews.insert_one(review)
    await db.facts.update_one({"_id": fact["_id"]}, {"$set": {"status": "pending_review"}})
    return review


async def flag_strategies(fact_id: str) -> list[Doc]:
    """Flag every healthy strategy that uses the fact. Returns the ones that changed."""
    db = database()
    healthy = await db.strategies.find({"factIds": fact_id, "status": "healthy"}).to_list()
    if healthy:
        await db.strategies.update_many(
            {"_id": {"$in": [s["_id"] for s in healthy]}}, {"$set": {"status": "flagged"}}
        )
    return healthy


async def create_message(to: list[str], strategy_id: str, fact_id: str, text: str) -> Doc:
    message = {
        "_id": new_id("m"), "to": to, "strategyId": strategy_id, "factId": fact_id, "text": text, "at": now(),
    }
    await database().messages.insert_one(message)
    return message


# --- review outcome ---------------------------------------------------------------------

async def _heal_strategies(fact_id: str) -> list[Doc]:
    """Flagged strategies that use the fact go back to healthy once none of their facts is pending."""
    db = database()
    healed = []
    for strategy in await db.strategies.find({"factIds": fact_id, "status": "flagged"}).to_list():
        pending = await db.facts.count_documents(
            {"_id": {"$in": strategy["factIds"]}, "status": "pending_review"}, limit=1
        )
        if not pending:
            await db.strategies.update_one({"_id": strategy["_id"]}, {"$set": {"status": "healthy"}})
            healed.append(strategy)
    return healed


async def resolve_review(
    review_id: str, decision: Literal["accept", "reject"], by: str = "reviewer"
) -> tuple[Doc, list[Doc]] | None:
    """Close a pending review. Returns (review, strategies back to healthy), or None if the
    review does not exist or is already closed.

    accept: new version appended, fact back to current. reject: the fact keeps its value.
    Either way the fact leaves pending_review and its strategies are healed once nothing is pending.
    """
    db = database()
    status = "accepted" if decision == "accept" else "rejected"
    review = await db.reviews.find_one_and_update(
        {"_id": review_id, "status": "pending"},
        {"$set": {"status": status, "closedAt": now(), "closedBy": by}},
        return_document=True,
    )
    if review is None:
        return None
    fact_id = review["factId"]
    if status == "accepted":
        await apply_version(fact_id, review["newValue"], (await get_fact(fact_id) or {}).get("sourceUrl"), by)
    still_pending = await db.reviews.count_documents({"factId": fact_id, "status": "pending"}, limit=1)
    if not still_pending:
        await db.facts.update_one({"_id": fact_id}, {"$set": {"status": "current"}})
    return review, await _heal_strategies(fact_id)


# --- Context.dev monitors -------------------------------------------------------------------
# `monitors` and `webhook_events` are not in COLLECTIONS: a reseed keeps the monitors and their secrets.

async def save_monitor(monitor_id: str, url: str, secret: str) -> None:
    await database().monitors.replace_one(
        {"_id": monitor_id}, {"_id": monitor_id, "url": url, "secret": secret, "createdAt": now()}, upsert=True)


async def list_saved_monitors() -> list[Doc]:
    return await database().monitors.find().to_list()


async def forget_monitor(monitor_id: str) -> None:
    await database().monitors.delete_one({"_id": monitor_id})


async def monitor_secrets() -> list[str]:
    """Signing secrets of every monitor this backend created (each monitor signs with its own)."""
    return [m["secret"] for m in await database().monitors.find({}, {"secret": 1}).to_list() if m.get("secret")]


async def claim_webhook_event(event_id: str) -> bool:
    """True the first time an event id is seen. Context.dev retries and replays keep the same id."""
    from pymongo.errors import DuplicateKeyError
    try:
        await database().webhook_events.insert_one({"_id": event_id, "at": now()})
        return True
    except DuplicateKeyError:
        return False
