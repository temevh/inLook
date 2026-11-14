import os
from pathlib import Path

SHARED_DIR = Path(__file__).resolve().parents[2] / "shared"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

DEV = os.getenv("INLOOK_DEV", "") == "1"
