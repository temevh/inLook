import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_DIR = REPO_ROOT / "shared"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# UNCONFIRMED
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "inlook")
CONTEXT_DEV_API_KEY = os.getenv("CONTEXT_DEV_API_KEY", "")

DEV = os.getenv("INLOOK_DEV", "") == "1"
