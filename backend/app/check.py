"""The fact-check flow behind POST /check (spec "Fact-check flow", shared/CONTRACT.md "Tier routing").

    selection / claim text or screenshot
      → claim.spotted ("checking…")
      → match a stored fact           (none: claim.unverified no_match)
      → re-check at the source page   Context.dev scrape of the fact's sourceUrl, or a Context.dev
                                      search when it has none (fails: claim.unverified unverifiable)
      → verdict + card                (claim.verdict)
      → if outdated, route by tier:
          low     new version saved at once                  fact.updated
          medium  review for the person who stated the fact  review.created
          high    review for the owners of dependent strategies, strategies flagged, owners messaged
                                                             review.created, strategy.flagged, message.created

Entry points:
  check_claim(text, quote, source, speaker?, lineId?)   the agreed internal API (spec "Data model"): makes the
      claimId, publishes claim.spotted, checks in the background, returns the claimId at once. POST /check uses
      it, and so will the mic path. A fact already checked in the last REPEAT_WINDOW_S is not re-checked: the
      claim gets that fact's last verdict.
  recheck_fact(fact) / recheck_url(url)   a page re-check (Context.dev monitor webhook, or POST /recheck): skips
      the match and the repeat window, announced as claim.spotted with source "page".

Any failure after claim.spotted ends in claim.unverified, so the HUD card never hangs on "Checking…".
Single backend process assumed: `_route_lock` keeps two claims about one fact from opening two reviews.
"""
import asyncio
import base64
import logging
from typing import Any

from . import config
from .contract import CheckRequest1, CheckRequest2
from .events import log
from .services import context_dev, db, gemini

logger = logging.getLogger("inlook.check")

SHORT_SELECTION = 200  # a selection this short is one claim; longer ones go through the spot call
MAX_CLAIMS = 5  # per check
REPEAT_WINDOW_S = 5 * 60  # a fact checked this recently is not checked again for a new claim

_route_lock = asyncio.Lock()
_tasks: set[asyncio.Task] = set()
_recent: dict[str, tuple[float, dict]] = {}  # factId -> (monotonic time, last claim.verdict payload)


def start(body: CheckRequest1 | CheckRequest2) -> str:
    """Run the check in the background and return its id; results arrive as events."""
    check_id = db.new_id("chk")
    start_background(run(check_id, body))
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
                claims = [{"text": label, "quote": label}]
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
    await asyncio.gather(*(run_claim(db.new_id("c"), c["text"], c.get("quote") or c["text"], origin,
                                     line_id=c.get("lineId")) for c in claims[:MAX_CLAIMS]))


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


def check_claim(text: str, quote: str, source: str, speaker: str | None = None, line_id: str | None = None) -> str:
    """Fire and forget: check one claim in the background, return its claimId. Results arrive as events,
    possibly out of order across claims; the HUD keys cards by claimId."""
    claim_id = db.new_id("c")
    start_background(run_claim(claim_id, text, quote, source, speaker, line_id))
    return claim_id


async def run_claim(claim_id: str, text: str, quote: str, source: str,
                    speaker: str | None = None, line_id: str | None = None) -> None:
    """One claim through match → source → verdict → routing. Never raises.
    `text` (stand-alone claim) is what is shown and matched; `quote` and `speaker` are kept for the log."""
    logger.info("claim %s from %s%s: %r (quote %r)", claim_id, source, f" ({speaker})" if speaker else "", text, quote)
    try:
        await _spotted(claim_id, text, source, line_id)
        await _check_claim(claim_id, text)
    except Exception:
        logger.exception("claim %s: check failed", claim_id)
        try:
            await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        except Exception:
            logger.exception("claim %s: could not close its HUD card", claim_id)


async def _check_claim(claim_id: str, text: str) -> None:
    """Match, then look the fact up at its source, within CHECK_TIMEOUT_S; then publish and route."""
    try:
        outcome = await asyncio.wait_for(_match_and_lookup(text), config.CHECK_TIMEOUT_S)
    except TimeoutError:
        logger.warning("claim %s: no verdict within %ss", claim_id, config.CHECK_TIMEOUT_S)
        await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        return
    kind, fact, found = outcome
    if kind == "no_match":
        await log.publish("claim.unverified", {"claimId": claim_id, "reason": "no_match"})
    elif kind == "recent":
        await log.publish("claim.verdict", {**found, "claimId": claim_id})  # checked moments ago: same answer
    else:
        await _publish_and_route(claim_id, fact, found)


async def _match_and_lookup(text: str) -> tuple[str, dict | None, Any]:
    """("no_match", None, None) | ("recent", fact, last verdict payload) | ("found", fact, lookup result).
    Publishes nothing, so the claim deadline can cancel it at any point."""
    facts = await db.list_facts()
    fact_id = await gemini.match(text, facts)
    fact = next((f for f in facts if f["_id"] == fact_id), None)
    if fact is None:
        return "no_match", None, None
    recent = _recent.get(fact["_id"])
    if recent and asyncio.get_running_loop().time() - recent[0] < REPEAT_WINDOW_S:
        return "recent", fact, recent[1]
    return "found", fact, await _lookup(fact, text)


async def _lookup(fact: dict, query: str | None) -> tuple[dict, str] | None:
    """(verdict result, source url) from the fact's page, or None when no source page was found.

    With a sourceUrl the page is scraped fresh. Without one, Context.dev searches the web for `query`
    (the spoken claim, else the fact's label and value) and the top result with content is the source.
    """
    source_url = fact.get("sourceUrl")
    if source_url:
        page = await context_dev.scrape(source_url)
    else:
        results = await context_dev.search(query or f"{fact['label']} {fact['value']}")
        if not results:
            return None
        source_url, page = results[0]["url"], results[0]["markdown"]
    return await gemini.verdict_card(fact, page), source_url


async def check_fact(claim_id: str, fact: dict, query: str | None = None) -> None:
    """Re-check one stored fact at its source through Context.dev, publish the verdict, route it.
    The lookup has CHECK_TIMEOUT_S; publishing and routing are not cut off half-way."""
    try:
        found = await asyncio.wait_for(_lookup(fact, query), config.CHECK_TIMEOUT_S)
    except TimeoutError:
        logger.warning("claim %s: no verdict for %s within %ss", claim_id, fact["_id"], config.CHECK_TIMEOUT_S)
        await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        return
    await _publish_and_route(claim_id, fact, found)


async def _publish_and_route(claim_id: str, fact: dict, found: tuple[dict, str] | None) -> None:
    if found is None:
        await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        return
    result, source_url = found
    tier = await db.fact_tier(fact)
    verdict = {
        "claimId": claim_id, "factId": fact["_id"], "verdict": result["verdict"],
        "oldValue": fact["value"], "newValue": result["newValue"], "evidence": result["evidence"],
        "sourceUrl": source_url, "card": _verdict_card(fact, result, tier),
    }
    await log.publish("claim.verdict", verdict)
    _recent[fact["_id"]] = (asyncio.get_running_loop().time(), verdict)
    if result["verdict"] == "outdated":
        await _route(fact["_id"], result["newValue"], result["evidence"], source_url)


async def recheck_fact(fact: dict) -> None:
    """A re-check nobody said out loud (the page changed, or "re-check now"). Never raises."""
    claim_id = db.new_id("c")
    try:
        await _spotted(claim_id, f"Re-checking {fact['label']}: {fact['value']}", "page")
        await check_fact(claim_id, fact)
    except Exception:
        logger.exception("re-check of %s failed", fact.get("_id"))
        try:
            await log.publish("claim.unverified", {"claimId": claim_id, "reason": "unverifiable"})
        except Exception:
            logger.exception("claim %s: could not close its HUD card", claim_id)


async def recheck_url(url: str) -> int:
    """Re-check every fact whose source is `url` (a Context.dev change.detected). Returns how many."""
    facts = await db.facts_by_source(url)
    await asyncio.gather(*(recheck_fact(f) for f in facts))
    return len(facts)


def start_background(coro) -> None:
    """Run work after the HTTP response (Context.dev wants a webhook acknowledged within 15 s)."""
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_task_done)


def _task_done(task: asyncio.Task) -> None:
    """Background work must not fail silently."""
    _tasks.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.error("background task %s failed", task.get_name(), exc_info=task.exception())


def forget(fact_id: str) -> None:
    """The fact's value changed: the next claim about it is checked again, not answered from the cache."""
    _recent.pop(fact_id, None)


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
            forget(fact_id)
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
            "evidence": evidence, "tier": tier, "reviewers": await db.people(reviewers),
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
            "messageId": message["_id"], "to": await db.people(message["to"]), "strategyId": message["strategyId"],
            "factId": message["factId"], "text": message["text"],
        })
