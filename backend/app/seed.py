"""Reset the demo database: clear every collection and fill it with the mock data.

Run from backend/ before each demo take:
    python -m app.seed            (or: uv run python -m app.seed)

Reads MONGODB_URI / MONGODB_DB from backend/.env. Ids match overlay/mock/*.json so the mock scenarios
and the database tell the same story. Everything here is mock data. The `events` counter is not reset,
so event seq stays monotonic and a running overlay keeps accepting events.
The sourceUrls are placeholders (.example): point at least one at a real, changeable public page for the demo.
"""
import asyncio

from . import config
from .services import db

PEOPLE = [
    {"_id": "p-ada", "name": "Ada Sample", "team": "Pricing"},
    {"_id": "p-sam", "name": "Sam Sample", "team": "Support"},
    {"_id": "p-mira", "name": "Mira Mockwell", "team": "Sales"},
]


def _fact(id: str, key: str, label: str, value: str, unit: str, tier: str, source: str,
          stated_by: str, stated_in: str, stated_at: str) -> dict:
    return {
        "_id": id, "key": key, "label": label, "value": value, "unit": unit, "tier": tier,
        "sourceUrl": source, "statedBy": stated_by, "statedIn": stated_in, "statedAt": stated_at,
        "versions": [{"value": value, "source": source, "at": stated_at, "by": stated_by}],
        "status": "current",
    }


FACTS = [
    _fact("f-compx-price", "competitor-x.price-per-seat", "Competitor X price per seat", "€59 per seat",
          "EUR/seat", "high", "https://competitor-x.example/pricing", "p-sam",
          "Pricing review, 2026-10-03", "2026-10-03T09:00:00+00:00"),
    _fact("f-refund-window", "policy.refund-window", "Refund window", "30 days",
          "days", "medium", "https://terms.example/refunds", "p-sam",
          "Support sync, 2026-10-10", "2026-10-10T13:00:00+00:00"),
    # Used by no strategy, so it can stay low tier.
    _fact("f-wifi-name", "office.wifi-name", "Office wifi network", "MockNet",
          "", "low", "https://handbook.example/office", "p-mira",
          "Office onboarding, 2026-09-01", "2026-09-01T08:00:00+00:00"),
]

STRATEGIES = [
    {"_id": "s-pricing", "name": "Mock Pricing Plan", "owners": ["p-ada"],
     "factIds": ["f-compx-price"], "status": "healthy"},
    {"_id": "s-returns", "name": "Mock Returns Policy", "owners": ["p-sam"],
     "factIds": ["f-refund-window"], "status": "healthy"},
]


async def main(verbose: bool = True) -> None:
    say = print if verbose else (lambda *_: None)
    say(f"database: {config.MONGODB_DB}")
    database = db.database()
    for name in db.COLLECTIONS:
        deleted = (await database[name].delete_many({})).deleted_count
        say(f"  cleared {name} ({deleted} documents)")
    await db.ensure_indexes()
    await database.people.insert_many(PEOPLE)
    await database.facts.insert_many(FACTS)
    await database.strategies.insert_many(STRATEGIES)
    say(f"seeded {len(PEOPLE)} people, {len(FACTS)} facts, {len(STRATEGIES)} strategies")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
