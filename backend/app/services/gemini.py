"""Gemini via google-genai. Structured JSON output (responseSchema) on every call.

Model: GEMINI_MODEL (default gemini-3.8-flash) for spot, match, verdict + card,
vision. GEMINI_EMBEDDING_MODEL (default gemini-embedding-2) for large fact sets.
Models may be swapped later.

PLACEHOLDER: no calls are made yet.
"""
import json
from functools import cache

from .. import config


@cache
def card_schema() -> dict:
    """shared/card.schema.json, sent as responseSchema in the verdict + card call."""
    schema = json.loads((config.SHARED_DIR / "card.schema.json").read_text())
    schema.pop("$comment", None)
    return schema


def client():
    from google import genai  # imported lazily so the skeleton runs without the SDK
    return genai.Client(api_key=config.GEMINI_API_KEY)


async def spot(lines: list[dict]) -> list[dict]:
    """Transcript lines → claims marked fact-checkable."""
    raise NotImplementedError


async def match(claim: str, facts: list[dict]) -> str | None:
    """Claim + stored facts (mock set is small: send all) → factId or None."""
    raise NotImplementedError


async def verdict_card(fact: dict, page_content: str) -> dict:
    """Stored fact (with tier) + Context.dev page content + card template →
    { verdict: current|outdated|unverifiable, newValue, evidence, card }.
    The caller checks card.criticality == fact.tier before publishing.
    """
    raise NotImplementedError


async def vision(png: bytes) -> list[dict]:
    """Screenshot → claims, same shape as spot."""
    raise NotImplementedError


async def embed(texts: list[str]) -> list[list[float]]:
    """Large fact sets only. UNCONFIRMED: embedding-first claim noticing (embed every
    transcript sentence + vector search) vs Gemini spotting claims first is not decided."""
    raise NotImplementedError
