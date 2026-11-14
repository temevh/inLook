"""Inlook backend. Endpoints: shared/CONTRACT.md.

Run: uvicorn app.main:app --env-file .env --reload
"""
import uuid

from fastapi import FastAPI, Header, HTTPException, WebSocket
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from . import config
from .contract import AcceptedResponse, CheckRequest, ReviewRequest, ReviewResponse
from .events import log

app = FastAPI(title="Inlook backend")


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
    """Selection text, a single claim, or a screenshot.

    TODO: text → claim.spotted; image → gemini.vision → claims. Then per claim:
    gemini.match → re-check the source → gemini.verdict_card → route by tier → events.
    """
    return AcceptedResponse(accepted=True, checkId=str(uuid.uuid4()))


@app.post("/reviews/{review_id}", response_model=ReviewResponse)
async def post_review(review_id: str, body: ReviewRequest) -> ReviewResponse:
    """Accept: append version, fact back to current, strategy healthy once no fact is pending.
    Reject: fact keeps its value, review closed. Publishes review.closed (+ fact.updated / strategy.healthy).

    TODO: needs fact storage.
    """
    raise HTTPException(501, "reviews not implemented (needs fact storage)")


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
        """Inject an event onto the stream (overlay development only)."""
        try:
            event = await log.publish(body.type, body.payload)
        except ValidationError as err:
            raise HTTPException(422, err.errors(include_url=False, include_context=False)) from None
        return event.model_dump(mode="json")


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
