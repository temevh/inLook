"""Context.dev (docs.context.dev): re-check a fact's source page, search the web, and watch pages.

Every source read goes through here; there is no fallback fetcher. Any failure raises
`ContextDevError` (or an httpx error) and the check flow turns it into "unverifiable".

    scrape(url)         POST /v1/web/scrape   fresh Markdown of one page (maxAgeMs=0)
    search(query)       POST /v1/web/search   ranked results with each page's Markdown
    monitors            /v1/monitors          one page monitor per fact sourceUrl; a change calls
                                              POST /webhooks/context (see app/monitors.py)
    verify_webhook      X-Context-Signature   "t=<unix>,v1=<hex>", HMAC-SHA256 of "t.<raw body>"
"""
import hashlib
import hmac
import re
import time
from typing import Any

import httpx

from .. import config

BASE_URL = "https://api.context.dev/v1"
TIMEOUT_S = 30.0
SIGNATURE_TOLERANCE_S = 300


class ContextDevError(RuntimeError):
    pass


def _client() -> httpx.AsyncClient:
    if not config.CONTEXT_DEV_API_KEY:
        raise ContextDevError("CONTEXT_DEV_API_KEY is not set (backend/.env)")
    return httpx.AsyncClient(
        base_url=BASE_URL, timeout=TIMEOUT_S, transport=_transport,
        headers={"Authorization": f"Bearer {config.CONTEXT_DEV_API_KEY}"},
    )


_transport: httpx.AsyncBaseTransport | None = None  # tests swap in an httpx.MockTransport


async def _request(method: str, path: str, json: dict | None = None, params: dict | None = None) -> Any:
    async with _client() as client:
        response = await client.request(method, path, json=json, params=params)
    if response.status_code >= 400:
        raise ContextDevError(f"{method} {path} -> {response.status_code}: {response.text[:300]}")
    return response.json() if response.content else None


# --- pages ---------------------------------------------------------------------------------

async def scrape(url: str) -> str:
    """Fresh Markdown of the page's main content."""
    data = await _request("POST", "/web/scrape", json={
        "url": url,
        "formats": {"markdown": True},
        "sharedParams": {"mainContentOnly": True},
        "maxAgeMs": 0,  # a re-check must see the page as it is now, not a cached copy
    })
    markdown = (data or {}).get("markdown") or {}
    if not markdown.get("success") or not markdown.get("data"):
        raise ContextDevError(f"scrape of {url} returned no markdown: {markdown.get('error') or markdown}")
    return markdown["data"]


async def search(query: str, num_results: int = 3) -> list[dict]:
    """Web results for `query` as [{url, title, markdown}], best first, only those with page content."""
    data = await _request("POST", "/web/search", json={
        "query": query[:500],
        "numResults": num_results,
        "markdownOptions": {"enabled": True},
    })
    results = []
    for r in (data or {}).get("results") or []:
        markdown = (r.get("markdown") or {}).get("markdown")
        if r.get("url") and markdown:
            results.append({"url": r["url"], "title": r.get("title", ""), "markdown": markdown})
    return results


# --- monitors ------------------------------------------------------------------------------

async def create_monitor(url: str, webhook_url: str, name: str, every_minutes: int = 10) -> dict:
    """A page monitor (exact change detection) that calls `webhook_url` on change.detected.
    The response carries `webhook.secret`, which verifies the deliveries."""
    return await _request("POST", "/monitors", json={
        "name": name[:200],
        "target": {"type": "page", "url": url},
        "change_detection": {"type": "exact"},
        "schedule": {"type": "interval", "frequency": every_minutes, "unit": "minutes"},
        "webhook": {"url": webhook_url, "events": ["change.detected"], "retry": {}},
        "tags": ["inlook"],
    })


async def list_monitors() -> list[dict]:
    monitors, cursor = [], None
    while True:
        data = await _request("GET", "/monitors", params={"limit": 100, **({"cursor": cursor} if cursor else {})})
        monitors += data.get("data") or []
        cursor = data.get("next_cursor")
        if not cursor:
            return monitors


async def delete_monitor(monitor_id: str) -> None:
    await _request("DELETE", f"/monitors/{monitor_id}")


async def run_monitor(monitor_id: str) -> None:
    """Queue a run now, outside the schedule."""
    await _request("POST", f"/monitors/{monitor_id}/run")


# --- webhooks ------------------------------------------------------------------------------

_SIG_T = re.compile(r"^[0-9]{1,12}$")
_SIG_V1 = re.compile(r"^[a-fA-F0-9]{64}$")


def verify_webhook(raw_body: bytes, signature_header: str, secrets: list[str], now: float | None = None) -> bool:
    """True when `X-Context-Signature` matches the raw body under one of `secrets` (one per monitor)."""
    parts: dict[str, str] = {}
    for part in (signature_header or "").split(","):
        key, sep, value = part.strip().partition("=")
        if not sep or key in parts:
            return False
        parts[key] = value
    t, v1 = parts.get("t", ""), parts.get("v1", "")
    if not _SIG_T.match(t) or not _SIG_V1.match(v1):
        return False
    if abs((now if now is not None else time.time()) - int(t)) > SIGNATURE_TOLERANCE_S:
        return False
    signed = t.encode() + b"." + raw_body
    for secret in secrets:
        if secret:
            expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
            if hmac.compare_digest(expected, v1.lower()):
                return True
    return False


def sign(raw_body: bytes, secret: str, t: int | None = None) -> str:
    """The header Context.dev would send. For tests and local webhook replays."""
    t = int(time.time()) if t is None else t
    digest = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return f"t={t},v1={digest}"
