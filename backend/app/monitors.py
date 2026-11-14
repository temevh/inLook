"""Context.dev page monitors: one per distinct fact sourceUrl, calling POST /webhooks/context on change.

Run from backend/ (needs CONTEXT_DEV_API_KEY, PUBLIC_BASE_URL and MONGODB_URI in .env):
    uv run python -m app.monitors sync     create missing monitors, delete stale inlook ones
    uv run python -m app.monitors status   list the inlook monitors and their state
    uv run python -m app.monitors run      queue a run of every inlook monitor now
    uv run python -m app.monitors peek     scrape each fact's page now and print the lines about it

Monitors run at most every 10 minutes (Free plan: 2 monitors). Each monitor signs its webhooks with its own
secret, kept in the `monitors` collection, which a reseed does not clear. A changed PUBLIC_BASE_URL (new tunnel)
means stale webhook URLs: `sync` replaces those monitors.
"""
import asyncio
import sys

from . import config
from .services import context_dev, db

TAG = "inlook"
EVERY_MINUTES = 10


def webhook_url() -> str:
    if not config.PUBLIC_BASE_URL:
        raise SystemExit("PUBLIC_BASE_URL is not set: Context.dev needs a public URL for the webhook")
    return f"{config.PUBLIC_BASE_URL}/webhooks/context"


async def ours() -> list[dict]:
    return [m for m in await context_dev.list_monitors() if TAG in (m.get("tags") or [])]


async def sync() -> None:
    hook = webhook_url()
    urls = sorted({f["sourceUrl"] for f in await db.list_facts() if f.get("sourceUrl")})
    saved = {m["_id"] for m in await db.list_saved_monitors()}
    keep: set[str] = set()
    for m in await ours():
        url = (m.get("target") or {}).get("url")
        current = url in urls and url not in keep and (m.get("webhook") or {}).get("url") == hook and m["id"] in saved
        if current:
            keep.add(url)
            print(f"  keep    {m['id']}  {url}")
        else:
            await context_dev.delete_monitor(m["id"])
            await db.forget_monitor(m["id"])
            print(f"  delete  {m['id']}  {url}")
    for url in urls:
        if url in keep:
            continue
        m = await context_dev.create_monitor(url, hook, f"inlook: {url}", EVERY_MINUTES)
        secret = (m.get("webhook") or {}).get("secret")
        if not secret:
            raise SystemExit(f"monitor {m.get('id')} came back without webhook.secret (API key needs monitors:write)")
        await db.save_monitor(m["id"], url, secret)
        print(f"  create  {m['id']}  {url}")
    print(f"{len(urls)} source page(s) watched, webhook {hook}")


async def status() -> None:
    for m in await ours():
        url = (m.get("target") or {}).get("url")
        print(f"  {m['id']}  {m.get('status')}  last run {m.get('last_run_at')}  "
              f"last change {m.get('last_change_at')}  {url}")
        if m.get("last_error"):
            print(f"      last error: {m['last_error']}")


async def run_all() -> None:
    for m in await ours():
        await context_dev.run_monitor(m["id"])
        print(f"  queued  {m['id']}  {(m.get('target') or {}).get('url')}")


async def peek() -> None:
    """What Context.dev reads on each source page: the lines that mention the fact. No webhook needed."""
    for fact in await db.list_facts():
        if not fact.get("sourceUrl"):
            continue
        print(f"{fact['_id']}  stored: {fact['value']}  {fact['sourceUrl']}")
        page = await context_dev.scrape(fact["sourceUrl"])
        words = {w.lower() for w in fact["label"].split() if len(w) > 3} | {"$", "€", "day"}
        lines = [ln.strip() for ln in page.splitlines() if any(w in ln.lower() for w in words)]
        for line in lines[:10]:
            print(f"    {line[:160]}")
        print(f"    ({len(page)} chars of markdown, {len(lines)} matching lines)")


COMMANDS = {"sync": sync, "status": status, "run": run_all, "peek": peek}


async def main(command: str) -> None:
    try:
        await COMMANDS[command]()
    finally:
        await db.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd not in COMMANDS:
        raise SystemExit(__doc__)
    asyncio.run(main(cmd))
