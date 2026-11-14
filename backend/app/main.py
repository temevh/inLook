"""Inlook backend. Endpoints: shared/CONTRACT.md.

Run: uvicorn app.main:app --env-file .env --reload
"""
from contextlib import asynccontextmanager

import json
import logging

from fastapi import FastAPI, Header, HTTPException, Request, Response, WebSocket
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from . import check, config
from .contract import AcceptedResponse, CheckRequest, ReviewRequest, ReviewResponse
from .events import log
from .services import context_dev, db

logger = logging.getLogger("inlook.main")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await log.start()  # Mongo log: indexes + the events change stream
    yield
    await log.stop()
    if config.MONGODB_URI:
        await db.close()


app = FastAPI(title="Inlook backend", lifespan=lifespan)


@app.websocket("/audio/stream")
async def audio_stream(ws: WebSocket) -> None:
    """Mic stream: one connection = one transcribing session. Binary frames of raw PCM,
    s16le, mono, 16 kHz, ~100 ms (3200 B) each. Results arrive over SSE.

    TODO: relay the frames to ElevenLabs realtime STT
    (wss://api.elevenlabs.io/v1/speech-to-text/realtime, audio_format=pcm_16000,
    diarize=true), map speaker labels to names, publish transcript.line, then spot
    claims with Gemini. For now frames are discarded.
    """
    await ws.accept()
    while (await ws.receive())["type"] != "websocket.disconnect":
        pass


@app.post("/check", status_code=202, response_model=AcceptedResponse)
async def post_check(body: CheckRequest) -> AcceptedResponse:
    """Selection text, a single claim, or a screenshot. Returns 202 at once; the check runs in the
    background and its results arrive as events (app/check.py has the flow).

    503 without a database: matching needs the stored facts.
    """
    if not config.MONGODB_URI:
        raise HTTPException(503, "checks need the database (MONGODB_URI is not set)")
    return AcceptedResponse(accepted=True, checkId=check.start(body.root))


@app.post("/reviews/{review_id}", response_model=ReviewResponse)
async def post_review(review_id: str, body: ReviewRequest) -> ReviewResponse:
    """Accept: append version, fact back to current, strategy healthy once no fact is pending.
    Reject: fact keeps its value, review closed.

    Publishes review.closed, then fact.updated (accept only), then strategy.healthy per healed strategy.
    404 unknown review, 409 already closed, 503 no database configured.
    """
    if not config.MONGODB_URI:
        raise HTTPException(503, "reviews need the database (MONGODB_URI is not set)")
    result = await db.resolve_review(review_id, body.decision.value)
    if result is None:
        exists = await db.get_review(review_id) is not None
        raise HTTPException(409 if exists else 404, "review already closed" if exists else "unknown review")
    review, healed = result
    await log.publish("review.closed", {
        "reviewId": review_id, "factId": review["factId"], "status": review["status"],
    })
    if review["status"] == "accepted":
        check.forget(review["factId"])
        fact = await db.get_fact(review["factId"])
        version = fact["versions"][-1]
        await log.publish("fact.updated", {
            "factId": fact["_id"],
            "version": {"value": version["value"], "source": version["source"] or "",
                        "at": version["at"], "by": version["by"]},
            "card": {"title": "Fact updated", "criticality": await db.fact_tier(fact),
                     "fact": f"{fact['label']}: {review['oldValue']} → {review['newValue']}"},
        })
    for strategy in healed:
        await log.publish("strategy.healthy", {"strategyId": strategy["_id"], "name": strategy["name"]})
    return ReviewResponse(id=review_id, status=review["status"])


class RecheckRequest(BaseModel):
    """Exactly one of factId (one fact) or url (every fact whose source is that page)."""
    factId: str | None = None
    url: str | None = None


@app.post("/recheck", status_code=202)
async def post_recheck(body: RecheckRequest) -> dict:
    """Re-check now, without a spoken claim: Context.dev scrapes the source page and the verdict is
    routed by tier like any claim. Monitors only run every 10 min or more, so the demo uses this.
    Results arrive as events (claim.spotted with source "page", then claim.verdict, ...).
    """
    if not config.MONGODB_URI:
        raise HTTPException(503, "re-checks need the database (MONGODB_URI is not set)")
    if (body.factId is None) == (body.url is None):
        raise HTTPException(422, "give exactly one of factId or url")
    if body.factId:
        fact = await db.get_fact(body.factId)
        if fact is None:
            raise HTTPException(404, "unknown fact")
        check.start_background(check.recheck_fact(fact))
        return {"accepted": True, "facts": 1}
    facts = await db.facts_by_source(body.url)
    if not facts:
        raise HTTPException(404, "no fact uses that url")
    check.start_background(check.recheck_url(body.url))
    return {"accepted": True, "facts": len(facts)}


@app.post("/webhooks/context", status_code=204)
async def context_webhook(request: Request) -> Response:
    """Context.dev monitor delivery. Verify the signature on the raw body first (401 is final, so a bad
    secret shows up in Context.dev's delivery log), then re-check every fact on the changed page in the
    background and acknowledge at once (Context.dev wants a 2xx within 15 s)."""
    raw = await request.body()
    secrets = await db.monitor_secrets() if config.MONGODB_URI else []
    if not context_dev.verify_webhook(raw, request.headers.get("x-context-signature", ""), secrets):
        raise HTTPException(401, "invalid webhook signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "invalid JSON") from None
    if not isinstance(event, dict) or event.get("id") != request.headers.get("x-context-id"):
        raise HTTPException(400, "invalid event envelope")
    if event.get("event") != "change.detected":
        return Response(status_code=204)  # run.completed and others: nothing to do
    if not await db.claim_webhook_event(event["id"]):
        return Response(status_code=204)  # a retry or replay of an event already handled
    url = ((event.get("data") or {}).get("change") or {}).get("url")
    if not url:
        raise HTTPException(400, "change.detected without data.change.url")
    logger.info("context.dev: %s changed, re-checking its facts", url)
    check.start_background(check.recheck_url(url))
    return Response(status_code=204)


@app.get("/stream")
async def stream(last_event_id: str | None = Header(default=None)) -> StreamingResponse:
    """SSE. Every event has a seq id; replay after Last-Event-ID, then follow."""
    return StreamingResponse(
        log.follow(log.resume_cursor(last_event_id)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if config.DEV:
    class DevEvent(BaseModel):
        type: str
        payload: dict

    @app.post("/dev/events", status_code=201)
    async def dev_event(body: DevEvent) -> dict:
        """Inject an event onto the stream (overlay development only). With a database,
        review.created and strategy.flagged also change the seeded data, so Accept / Reject on
        the mock cards works."""
        try:
            event = await log.publish(body.type, body.payload)
        except ValidationError as err:
            raise HTTPException(422, err.errors(include_url=False, include_context=False)) from None
        if config.MONGODB_URI:
            await db.mirror_dev_event(body.type, body.payload)
        return event.model_dump(mode="json")


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
