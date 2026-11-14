"""Reset the demo database from backend/seed.json: clear every collection, then load the records.

Run from backend/ before each demo take:
    uv run python -m app.seed

Records follow the spec's "Data model" (people, facts, strategies; reviews and messages start empty).
Their `id` becomes the MongoDB `_id`. The tier floor is applied here, at load: a fact any strategy
uses is stored as at least medium. Ids match overlay/mock/*.json.

Sources are real public pages, read through Context.dev; people and strategies are mock data. The two
sourced facts carry an older value than their page shows (seen 2026-11-14: Notion Plus $10 per member /
month; Apple a 14-day return window), so the first re-check finds them outdated. See what the pages say
now with `uv run python -m app.monitors peek`. Free Context.dev plan: 2 monitors, so 2 source pages.

The `events` counter is not reset, so event seq stays monotonic and a running overlay keeps accepting events.
"""
import asyncio
import json

from . import config
from .services import db

SEED_FILE = config.BACKEND_DIR / "seed.json"


def load(path=SEED_FILE) -> dict[str, list[dict]]:
    """seed.json as MongoDB documents (`id` → `_id`), tier floor applied."""
    data = json.loads(path.read_text())
    docs = {name: [{"_id": r["id"], **{k: v for k, v in r.items() if k != "id"}} for r in data[name]]
            for name in ("people", "facts", "strategies")}
    used = {fid for s in docs["strategies"] for fid in s["factIds"]}
    for fact in docs["facts"]:
        if fact["tier"] == "low" and fact["_id"] in used:
            fact["tier"] = "medium"
    return docs


async def main(verbose: bool = True) -> None:
    say = print if verbose else (lambda *_: None)
    say(f"database: {config.MONGODB_DB}")
    docs = load()
    database = db.database()
    for name in db.COLLECTIONS:
        deleted = (await database[name].delete_many({})).deleted_count
        say(f"  cleared {name} ({deleted} documents)")
    await db.ensure_indexes()
    for name, records in docs.items():
        await database[name].insert_many(records)
    say(", ".join(f"{len(r)} {n}" for n, r in docs.items()) + " seeded from seed.json")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
