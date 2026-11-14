"""ElevenLabs STT with speaker labels.

Input: one ~10 s webm/Opus chunk with ~1 s overlap with the previous one.
Output: transcript lines { lineId, speaker, text }. Speaker labels are mapped
to names by a fixed list for the demo.

Open (spec): latency, and whether the realtime mode returns speaker labels.
PLACEHOLDER: no calls are made yet.
"""

SPEAKER_NAMES: dict[str, str] = {}  # e.g. {"speaker_0": "Maija"}


async def transcribe(chunk: bytes, mime: str) -> list[dict]:
    raise NotImplementedError
