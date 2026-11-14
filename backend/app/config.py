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
# Each Gemini call: seconds per attempt, and attempts (a timeout, 429, 5xx or unreadable JSON is retried).
GEMINI_TIMEOUT_S = float(os.getenv("GEMINI_TIMEOUT_S", "20"))
GEMINI_ATTEMPTS = int(os.getenv("GEMINI_ATTEMPTS", "2"))
# Deadline for one claim to reach a verdict (match + source page + verdict). Past it the HUD card closes as
# "unverifiable". Publishing the verdict and tier routing are not cut off by it.
CHECK_TIMEOUT_S = float(os.getenv("CHECK_TIMEOUT_S", "45"))
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# MongoDB Atlas. Without MONGODB_URI the backend runs on the in-memory event log and /check and
# /reviews answer 503 (they need the stored facts).
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "inlook")
# How long a MongoDB call waits for Atlas before failing (connect + server selection), instead of pymongo's
# default 30 s. Not shorter: on a slow network (a phone hotspot) reaching the Atlas primary can take over 5 s.
MONGODB_TIMEOUT_MS = int(os.getenv("MONGODB_TIMEOUT_MS", "15000"))
# The one check at startup: if Atlas does not answer within this, the run uses the in-memory event log.
MONGODB_STARTUP_TIMEOUT_S = float(os.getenv("MONGODB_STARTUP_TIMEOUT_S", "10"))

# Where the SSE event log lives: "mongo" (events collection + change stream) or "memory".
# Default: mongo when MONGODB_URI is set. INLOOK_EVENTS=memory forces the in-memory log.
EVENTS = os.getenv("INLOOK_EVENTS") or ("mongo" if MONGODB_URI else "memory")
if EVENTS not in ("mongo", "memory"):
    raise RuntimeError(f"INLOOK_EVENTS must be 'mongo' or 'memory', got {EVENTS!r}")

DEV = os.getenv("INLOOK_DEV", "") == "1"

# Context.dev: reads every source page (scrape), searches when a fact has no page, and watches pages
# (monitors). PUBLIC_BASE_URL is where Context.dev can reach this backend for the monitor webhook
# (a tunnel during the demo, e.g. `cloudflared tunnel --url http://localhost:8000`).
CONTEXT_DEV_API_KEY = os.getenv("CONTEXT_DEV_API_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
