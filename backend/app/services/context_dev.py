"""UNCONFIRMED: Context.dev integration. Nothing here is decided.

Unconfirmed parts (spec "Context.dev" and "Open items"):
- API surface, auth and rate limits.
- Re-fetch the fact's stored sourceUrl vs search the web for the claim when no URL is stored.
- Page watching: one watch per sourceUrl, Context.dev calls POST /webhooks/context
  on change. Needs a public backend URL during the demo.
- Polling fallback: the backend re-fetches every sourceUrl every N minutes.
"""


async def fetch_page(url: str) -> str:
    """UNCONFIRMED"""
    raise NotImplementedError


async def search(claim: str) -> str:
    """UNCONFIRMED"""
    raise NotImplementedError


async def watch(url: str) -> None:
    """UNCONFIRMED"""
    raise NotImplementedError
