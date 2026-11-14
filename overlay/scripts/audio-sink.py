"""Dev-only: stands in for the backend's WS /audio/stream. Saves each session
(one connection) as a 16 kHz mono s16le .wav in a temp dir and prints the path,
byte count and frame stats when the connection closes.

Run with the backend's venv (websockets comes with uvicorn[standard]):
  backend/.venv/bin/python overlay/scripts/audio-sink.py [port]
Then run the overlay with INLOOK_BACKEND_URL=http://127.0.0.1:<port>.
"""
import asyncio
import sys
import tempfile
import time
import wave
from pathlib import Path

from websockets.asyncio.server import serve

RATE = 16000
out = Path(tempfile.mkdtemp(prefix="inlook-audio-"))
sessions = 0


async def handler(ws):
    global sessions
    if ws.request.path != "/audio/stream":
        await ws.close(1008, "not found")
        return
    sessions += 1
    path = out / f"session-{sessions}.wav"
    frames = total = 0
    first = last = 0.0
    gaps = []
    print(f"session {sessions} open → {path}", flush=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        try:
            async for msg in ws:
                if not isinstance(msg, bytes):
                    continue
                now = time.monotonic()
                if frames:
                    gaps.append(now - last)
                else:
                    first = now
                last = now
                frames += 1
                total += len(msg)
                wav.writeframes(msg)
        except Exception as err:  # abrupt close
            print(f"session {sessions} ended: {err!r}", flush=True)
    secs = last - first
    print(
        f"session {sessions} closed: {path} {total} B PCM = {total / 2 / RATE:.2f} s audio; "
        f"{frames} frames over {secs:.2f} s wall ({frames / secs if secs else 0:.1f}/s), "
        f"max gap {max(gaps, default=0) * 1000:.0f} ms",
        flush=True,
    )


async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    async with serve(handler, "127.0.0.1", port):
        print(f"saving sessions to {out}; listening on ws://127.0.0.1:{port}/audio/stream", flush=True)
        await asyncio.Future()


asyncio.run(main())
