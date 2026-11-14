"""Inlook backend. Endpoints: shared/CONTRACT.md.

Run: uvicorn app.main:app --env-file .env --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, WebSocket
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from . import check, config
from .contract import AcceptedResponse, CheckRequest, ReviewRequest, ReviewResponse
from .events import log
from .services import db


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
