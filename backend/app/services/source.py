"""Fetching a fact's source page for the verdict call.

STAND-IN: a plain GET with the HTML reduced to text. Context.dev (re-checks, page watching) is still
undecided; when it is, `fetch_page` is the one function to swap. Static pages only: no JavaScript rendering.
"""
import html
import re

import httpx

PAGE_TIMEOUT_S = 10.0
MAX_BYTES = 1_000_000


async def fetch_page(url: str) -> str:
    """Page text for `url`. Raises on a non-http(s) URL, a failed request or an error status; the
    check flow treats that as "unverifiable"."""
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"not an http(s) URL: {url!r}")
    async with httpx.AsyncClient(timeout=PAGE_TIMEOUT_S, follow_redirects=True) as client:
        async with client.stream("GET", url, headers={"User-Agent": "inlook-factcheck/0.1"}) as response:
            response.raise_for_status()
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) >= MAX_BYTES:
                    break
    return _to_text(body.decode(response.encoding or "utf-8", errors="replace"))


def _to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|noscript|svg)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?s)<!--.*?-->", " ", markup)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", markup))
    return re.sub(r"\s+", " ", text).strip()
