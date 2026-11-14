"""The fact-check flow behind POST /check (spec "Fact-check flow", shared/CONTRACT.md "Tier routing").

    selection / claim text or screenshot
      → claim.spotted ("checking…")
      → match a stored fact           (none: claim.unverified no_match)
      → re-check at the source page   (cannot fetch: claim.unverified unverifiable)
      → verdict + card                (claim.verdict)
      → if outdated, route by tier:
          low     new version saved at once                  fact.updated
          medium  review for the person who stated the fact  review.created
          high    review for the owners of dependent strategies, strategies flagged, owners messaged
                                                             review.created, strategy.flagged, message.created

Any failure after claim.spotted ends in claim.unverified, so the HUD card never hangs on "Checking…".
Single backend process assumed: `_route_lock` keeps two claims about one fact from opening two reviews.
"""
import asyncio
import base64
import logging
from typing import Any

from .contract import CheckRequest1, CheckRequest2
from .events import log
from .services import db, gemini, source

logger = logging.getLogger("inlook.check")

SHORT_SELECTION = 200  # a selection this short is one claim; longer ones go through the spot call
MAX_CLAIMS = 5  # per check

_route_lock = asyncio.Lock()
_tasks: set[asyncio.Task] = set()


def start(body: CheckRequest1 | CheckRequest2) -> str:
    """Run the check in the background and return its id; results arrive as events."""
    check_id = db.new_id("chk")
    task = asyncio.create_task(run(check_id, body), name=f"check-{check_id}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return check_id


async def run(check_id: str, body: CheckRequest1 | CheckRequest2) -> None:
    """Find the claims in the input, then check each one."""
    if body.kind == "text":
        origin, label = "selection", body.text.strip()
    else:
        origin, label = "screenshot", "Screenshot"
    try:
        if body.kind == "text":
            if body.source.value == "claim" or len(label) <= SHORT_SELECTION:
                claims = [{"text": label}]
            else:
                claims = await gemini.spot([{"text": label}])
        else:
            claims = await gemini.vision(base64.b64decode(body.dataBase64))
    except Exception:
        logger.exception("check %s: could not read claims", check_id)
        await _announce_and_close(label, origin, "unverifiable")
        return
    if not claims:
        await _announce_and_close(label, origin, "no_match")
        return
    await asyncio.gather(*(process_claim(c["text"], origin, c.get("lineId")) for c in claims[:MAX_CLAIMS]))


async def _announce_and_close(text: str, origin: str, reason: str) -> None:
    """For a check that produced no claim to follow: show one card and close it."""
    claim_id = db.new_id("c")
    await _spotted(claim_id, text, origin)
    await log.publish("claim.unverified", {"claimId": claim_id, "reason": reason})


async def _spotted(claim_id: str, text: str, origin: str, line_id: str | None = None) -> None:
    payload: dict[str, Any] = {"claimId": claim_id, "text": text, "source": origin}
    if line_id:
        payload["lineId"] = line_id
    await log.publish("claim.spotted", payload)


async def process_claim(text: str, origin: str, line_id: str | None = None) -> None:
    """One claim through match → source → verdict → routing. Never raises."""
    claim_id = db.new_id("c")
    try:
        await _spotted(claim_id, text, origin, line_id)
        await _check_claim(claim_id, text)
    except Exception:
        logger.exception("claim %s: check failed", claim_id)
        try:
            await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        except Exception:
            logger.exception("claim %s: could not close its HUD card", claim_id)


async def _check_claim(claim_id: str, text: str) -> None:
    facts = await db.list_facts()
    fact_id = await gemini.match(text, facts)
    fact = next((f for f in facts if f["_id"] == fact_id), None)
    if fact is None:
        await log.publish("claim.unverified", {"claimId": claim_id, "reason": "no_match"})
        return
    if not fact.get("sourceUrl"):  # no stored page; searching the web for the claim is not built
        await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        return
    page = await source.fetch_page(fact["sourceUrl"])
    result = await gemini.verdict_card(fact, page)
    tier = await db.fact_tier(fact)
    await log.publish("claim.verdict", {
        "claimId": claim_id, "factId": fact["_id"], "verdict": result["verdict"],
        "oldValue": fact["value"], "newValue": result["newValue"], "evidence": result["evidence"],
        "sourceUrl": fact["sourceUrl"], "card": _verdict_card(fact, result, tier),
    })
    if result["verdict"] == "outdated":
        await _route(fact["_id"], result["newValue"], result["evidence"], fact["sourceUrl"])


def _verdict_card(fact: dict, result: dict, tier: db.Tier) -> dict:
    """The HUD card for the verdict. Criticality is always the fact's tier, whatever Gemini wrote."""
    if result["verdict"] == "outdated":
        title = "Fact outdated"
        line = str(result["card"].get("fact") or "").strip() or f"{fact['label']}: {fact['value']} → {result['newValue']}"
    else:
        # The contract has no "still current" title yet, so this reuses "Fact updated" (decision: reuse for now).
        title = "Fact updated"
        line = f"{fact['label']}: {fact['value']} (still current)"
    return {"title": title, "criticality": tier, "fact": line}


async def _route(fact_id: str, new_value: str, evidence: str, source_url: str) -> None:
    """Act on an outdated verdict according to the fact's tier."""
    async with _route_lock:
        fact = await db.get_fact(fact_id)  # re-read: another claim may have handled it meanwhile
        if fact is None or fact["status"] == "pending_review" or fact["value"] == new_value:
            return
        tier = await db.fact_tier(fact)
        line = f"{fact['label']}: {fact['value']} → {new_value}"
        if tier == "low":
            version = await db.apply_version(fact_id, new_value, source_url, "inlook")
            await log.publish("fact.updated", {
                "factId": fact_id, "version": version,
                "card": {"title": "Fact updated", "criticality": tier, "fact": line},
            })
            return
        strategies = await db.strategies_using(fact_id)
        if tier == "medium" or not strategies:
            reviewers = [fact["statedBy"]] if fact.get("statedBy") else []
        else:
            reviewers = sorted({owner for s in strategies for owner in s["owners"]})
        review = await db.create_review(fact, new_value, evidence, tier, reviewers)
        await log.publish("review.created", {
            "reviewId": review["_id"], "factId": fact_id, "oldValue": fact["value"], "newValue": new_value,
            "evidence": evidence, "tier": tier, "reviewers": reviewers,
            "card": {"title": "Needs review", "criticality": tier, "fact": line},
        })
        if tier == "high":
            await _flag_and_notify(fact, new_value, strategies)


async def _flag_and_notify(fact: dict, new_value: str, strategies: list[dict]) -> None:
    """High tier: flag each dependent strategy, and tell its owners (only its owners)."""
    newly_flagged = {s["_id"] for s in await db.flag_strategies(fact["_id"])}
    for strategy in strategies:
        if strategy["_id"] in newly_flagged:
            await log.publish("strategy.flagged", {
                "strategyId": strategy["_id"], "name": strategy["name"], "factId": fact["_id"],
            })
        message = await db.create_message(
            strategy["owners"], strategy["_id"], fact["_id"],
            f"{fact['label']} changed: {fact['value']} → {new_value}. "
            f"{strategy['name']} relies on the old value and needs a look.",
        )
        await log.publish("message.created", {
            "messageId": message["_id"], "to": message["to"], "strategyId": message["strategyId"],
            "factId": message["factId"], "text": message["text"],
        })
