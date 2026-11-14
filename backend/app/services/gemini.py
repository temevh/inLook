"""Gemini via google-genai, structured JSON output (responseSchema) on every call.
Model: GEMINI_MODEL for spot, match, verdict + card and vision.

PLACEHOLDER: no calls are made yet.
"""
import json
from functools import cache

from .. import config


@cache
def card_schema() -> dict:
    """shared/card.schema.json, sent as responseSchema in the verdict + card call."""
    return json.loads((config.SHARED_DIR / "card.schema.json").read_text())


def client():
    from google import genai  # lazy, so the server starts without the SDK configured
    return genai.Client(api_key=config.GEMINI_API_KEY)


async def spot(lines: list[dict]) -> list[dict]:
    """Transcript lines → claims marked fact-checkable."""
    raise NotImplementedError


async def match(claim: str, facts: list[dict]) -> str | None:
    """Claim + stored facts (small set: send all) → factId or None."""
    raise NotImplementedError


async def verdict_card(fact: dict, page_content: str) -> dict:
    """Stored fact (with tier) + source page content + card template →
    { verdict: current|outdated|unverifiable, newValue, evidence, card }.
    The caller checks card.criticality == fact.tier before publishing.
    """
    raise NotImplementedError


async def vision(png: bytes) -> list[dict]:
    """Screenshot → claims, same shape as spot."""
    raise NotImplementedError
