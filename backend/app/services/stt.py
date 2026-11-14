"""ElevenLabs realtime speech-to-text (Scribe) over a WebSocket.

One `Session` per transcribing run. The backend relays the overlay's mic frames (raw PCM s16le, mono,
16 kHz, 100 ms each) as base64 JSON chunks and reads transcripts back. Docs:
https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime

Settings (backend/.env): ELEVENLABS_MODEL (default scribe_v3_live: the only realtime model with speaker
labels), STT_LANGUAGE, STT_VAD_SILENCE_S. Lines are committed by voice-activity detection: a pause of
STT_VAD_SILENCE_S ends a line. With diarize=true every `committed_transcript` is followed by a
`diarized_transcript` whose words carry a `speaker_id` ("speaker_0", "speaker_1", ...).

Server limits worth knowing: the server closes a session after 15 s without client messages (the overlay
streams continuously, silence included), and every second of audio sent is billed.
"""
import base64
import json
import logging
import urllib.parse
from collections.abc import AsyncIterator

from .. import config

logger = logging.getLogger("inlook.stt")

URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
SAMPLE_RATE = 16000
DIARIZING_MODELS = ("scribe_v3_live",)

# Server message types that report a problem. The ones in NOT_FATAL are logged and the session goes on;
# FATAL ones mean another connection would fail the same way (bad key, no credits, bad settings).
ERRORS = {
    "error", "auth_error", "quota_exceeded", "commit_throttled", "unaccepted_terms", "rate_limited",
    "queue_overflow", "resource_exhausted", "session_time_limit_exceeded", "input_error", "invalid_request",
    "chunk_size_exceeded", "insufficient_audio_activity", "transcriber_error",
}
NOT_FATAL = {"commit_throttled", "insufficient_audio_activity"}
FATAL = {"auth_error", "quota_exceeded", "unaccepted_terms", "invalid_request", "no_key"}


class SttError(Exception):
    def __init__(self, kind: str, message: str = "") -> None:
        super().__init__(f"{kind}: {message}" if message else kind)
        self.kind = kind

    @property
    def fatal(self) -> bool:
        return self.kind in FATAL


def diarizing() -> bool:
    return config.ELEVENLABS_MODEL in DIARIZING_MODELS


def url() -> str:
    query = {
        "model_id": config.ELEVENLABS_MODEL,
        "audio_format": f"pcm_{SAMPLE_RATE}",
        "commit_strategy": "vad",
        "vad_silence_threshold_secs": f"{config.STT_VAD_SILENCE_S:g}",
    }
    if config.STT_LANGUAGE:
        query["language_code"] = config.STT_LANGUAGE
    if diarizing():
        query["diarize"] = "true"
    return f"{URL}?{urllib.parse.urlencode(query)}"


class Session:
    def __init__(self, ws) -> None:
        self._ws = ws

    async def send(self, pcm: bytes) -> None:
        """One chunk of raw PCM s16le mono 16 kHz (0.1-1 s recommended)."""
        await self._ws.send(json.dumps({
            "message_type": "input_audio_chunk",
            "audio_base_64": base64.b64encode(pcm).decode("ascii"),
            "commit": False,
            "sample_rate": SAMPLE_RATE,
        }))

    async def messages(self) -> AsyncIterator[dict]:
        """Server messages until the server closes the session. Raises SttError on an error message."""
        import websockets
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                msg = json.loads(raw)
                kind = msg.get("message_type", "")
                if kind in ERRORS:
                    text = str(msg.get("error") or msg.get("message") or "")
                    if kind in NOT_FATAL:
                        logger.warning("elevenlabs %s: %s", kind, text)
                        continue
                    raise SttError(kind, text)
                yield msg
        except websockets.ConnectionClosedError as exc:
            close = exc.rcvd
            raise SttError("closed", f"code {close.code} {close.reason}".strip() if close else "no close frame") from exc

    async def close(self) -> None:
        await self._ws.close()


async def connect(open_timeout: float = 10) -> Session:
    """Open a realtime session. Raises SttError("no_key") without ELEVENLABS_API_KEY, and the websockets
    error (e.g. InvalidStatus for a rejected key) or OSError if the connection fails."""
    import websockets
    if not config.ELEVENLABS_API_KEY:
        raise SttError("no_key", "ELEVENLABS_API_KEY is not set (backend/.env)")
    ws = await websockets.connect(
        url(), additional_headers={"xi-api-key": config.ELEVENLABS_API_KEY}, open_timeout=open_timeout,
    )
    return Session(ws)
