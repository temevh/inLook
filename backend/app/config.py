import os
from pathlib import Path

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"
BACKEND_DIR = Path(__file__).resolve().parents[1]


def _load_dotenv(path: Path) -> None:
    """Read KEY=VALUE lines from `path` into os.environ. The real environment wins over the file.

    uvicorn --env-file already does this for the server; this covers `python -m app.seed` and the tests.
    """
    try:
        text = path.read_text()
    except FileNotFoundError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


_load_dotenv(BACKEND_DIR / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# MongoDB Atlas. Without MONGODB_URI the backend runs on the in-memory event log and /check and
# /reviews answer 503 (they need the stored facts).
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "inlook")

# Where the SSE event log lives: "mongo" (events collection + change stream) or "memory".
# Default: mongo when MONGODB_URI is set. INLOOK_EVENTS=memory forces the in-memory log.
EVENTS = os.getenv("INLOOK_EVENTS") or ("mongo" if MONGODB_URI else "memory")
if EVENTS not in ("mongo", "memory"):
    raise RuntimeError(f"INLOOK_EVENTS must be 'mongo' or 'memory', got {EVENTS!r}")

DEV = os.getenv("INLOOK_DEV", "") == "1"
