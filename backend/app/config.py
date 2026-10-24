import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _first_env(*keys: str) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value not in (None, ""):
            return value
    return None


GOOGLE_CLIENT_ID = _first_env("GOOGLE_CLIENT_ID", "Google_Client_ID")
GOOGLE_CLIENT_SECRET = _first_env("GOOGLE_CLIENT_SECRET", "Google_Client_Secret")
GOOGLE_REDIRECT_URI = _first_env("GOOGLE_REDIRECT_URI", "Google_Redirect_URI", "Google_Redirect_Uri")

# Switch to "gemma-4-31b-it" here if the 26B model isn't accurate enough.
MODEL = "gemma-4-26b-a4b-it"

# Stitch screens in the repo's frontend/ folder, served at /.
SITE_DIR = Path(__file__).resolve().parents[2] / "frontend"

MAX_IMAGE_SIDE = 1600
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_S = 2.0

# Pillow format names we accept. HEIF is iPhone photos; MPO is a JPEG variant some phones write.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "HEIF"}

# Front ends allowed to call the API (CORS). Comma-separated in .env.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]

PORT = int(os.getenv("PORT", "8000"))


def get_api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY")
