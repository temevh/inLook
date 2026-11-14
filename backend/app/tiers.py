"""Criticality tiers (decided; shared/CONTRACT.md "Tier routing").

- The tier is mostly stored per fact.
- Floor: any fact a strategy relies on is at least medium.
- low → new version saved at once.
- medium → review by the person who stated the fact.
- high → review by the strategy owners, flag strategies that use the fact, Inlook message to those owners.
"""
from typing import Literal

from .contract import Tier

_ORDER: dict[Tier, int] = {"low": 0, "medium": 1, "high": 2}


def effective_tier(stored: Tier, used_by_strategy: bool) -> Tier:
    if used_by_strategy and _ORDER[stored] < _ORDER["medium"]:
        return "medium"
    return stored


Outcome = Literal["auto_update", "review_by_stater", "review_by_owners_flag_and_notify"]


def outcome(tier: Tier) -> Outcome:
    return {
        "low": "auto_update",
        "medium": "review_by_stater",
        "high": "review_by_owners_flag_and_notify",
    }[tier]  # type: ignore[return-value]
