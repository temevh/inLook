"""Play a recording into WS /audio/stream exactly like the overlay's mic: 100 ms frames of PCM s16le,
mono, 16 kHz, in real time, then a little silence, then close (code 1000). For rehearsing the mic path
without speaking; watch the HUD (or GET /stream) for transcript lines and claim cards.

Run from backend/:
    uv run python -m app.replay fixtures/mic-demo.wav
    uv run python -m app.replay talk.pcm --url ws://127.0.0.1:8000/audio/stream --speed 2

Input: a .wav that is 16 kHz, mono, 16-bit, or raw .pcm in that format.
"""
import argparse
import asyncio
import time
import wave

FRAME_BYTES = 3200  # 100 ms
RATE = 16000


def read_pcm(path: str) -> bytes:
    if not path.lower().endswith(".wav"):
        return open(path, "rb").read()
    with wave.open(path, "rb") as w:
        got = (w.getframerate(), w.getnchannels(), w.getsampwidth())
        if got != (RATE, 1, 2):
            raise SystemExit(f"{path}: need 16000 Hz, mono, 16-bit; got {got[0]} Hz, {got[1]} channel(s), "
                             f"{got[2] * 8}-bit")
        return w.readframes(w.getnframes())


async def play(pcm: bytes, url: str, speed: float, tail_s: float) -> None:
    import websockets
    pcm += bytes(int(tail_s * RATE) * 2)
    frames = [pcm[i:i + FRAME_BYTES] for i in range(0, len(pcm), FRAME_BYTES)]
    print(f"{len(frames) / 10:.1f} s of audio → {url}")
    async with websockets.connect(url) as ws:
        start = time.monotonic()
        for i, frame in enumerate(frames):
            await ws.send(frame)
            await asyncio.sleep(max(0.0, start + (i + 1) * 0.1 / speed - time.monotonic()))
    print("done")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("file", help=".wav (16 kHz mono 16-bit) or raw .pcm")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/audio/stream")
    parser.add_argument("--speed", type=float, default=1.0, help="1 = real time, like the mic")
    parser.add_argument("--tail", type=float, default=2.0, help="seconds of silence after the recording")
    args = parser.parse_args()
    asyncio.run(play(read_pcm(args.file), args.url, args.speed, args.tail))


if __name__ == "__main__":
    main()
