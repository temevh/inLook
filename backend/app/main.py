"""Inlook backend skeleton. Endpoints from shared/CONTRACT.md.

Run: uvicorn app.main:app --reload
"""
import uuid

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from . import config
from .contract import Accepted, CheckImage, CheckText, DevEvent, ReviewDecision, ReviewResult
from .events import log

app = FastAPI(title="Inlook backend")


@app.post("/audio", status_code=202, response_model=Accepted)
async def post_audio(
    chunk: UploadFile = File(...),
    startedAt: str = Form(...),
    seqNo: int = Form(...),
) -> Accepted:
    """~10 s Opus chunk (1 s overlap) → ElevenLabs STT → transcript.line events
    → Gemini spot → claim.spotted events → check flow.

    TODO: services.stt.transcribe, de-duplicate the overlap, services.gemini.spot,
    then run the check flow per claim.
    """
    await chunk.read()
    return Accepted()


@app.post("/check", status_code=202, response_model=Accepted)
async def post_check(body: CheckText | CheckImage) -> Accepted:
    """Selection text, a single claim, or a screenshot.

    TODO: text → claim.spotted directly (or Gemini spot for longer selections);
    image → services.gemini.vision → claims. Then per claim:
    match (gemini.match) → re-check (context_dev, UNCONFIRMED) → gemini.verdict_card
    → tiers.route → events.
    """
    return Accepted(checkId=str(uuid.uuid4()))


@app.post("/reviews/{review_id}", response_model=ReviewResult)
async def post_review(review_id: str, body: ReviewDecision) -> ReviewResult:
    """Accept: append version, fact back to current, strategy healthy once no fact is pending.
    Reject: fact keeps its value, review closed. Publishes review.closed (+ fact.updated / strategy.healthy).

    TODO: needs db (UNCONFIRMED).
    """
    raise HTTPException(501, "reviews not implemented (needs db, UNCONFIRMED)")


@app.post("/webhooks/context", status_code=202)
async def context_webhook(request: Request) -> dict:
    """UNCONFIRMED: Context.dev page-change notification. Payload shape unknown.
    Intended: find every fact with that sourceUrl and run verdict + card.
    Fallback if Context.dev cannot watch pages: re-fetch every sourceUrl every N minutes.
    """
    raise HTTPException(501, "UNCONFIRMED: Context.dev page watching")


@app.get("/stream")
async def stream(last_event_id: str | None = Header(default=None)) -> StreamingResponse:
    """SSE. Every event has a seq id; replay after Last-Event-ID, then follow."""
    after = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    return StreamingResponse(
        log.follow(after),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


if config.DEV:
    @app.post("/dev/events", status_code=201)
    async def dev_event(body: DevEvent) -> dict:
        """Inject an event onto the stream (overlay development only)."""
        event = await log.publish(body.type, body.payload)
        return event.model_dump()


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
