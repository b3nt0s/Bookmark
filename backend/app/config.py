import os

from dotenv import load_dotenv

load_dotenv()

# Switch to "gemma-4-31b-it" here if the 26B model isn't accurate enough.
MODEL = "gemma-4-26b-a4b-it"

MAX_IMAGE_SIDE = 1600
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_S = 2.0

# Pillow format names we accept. HEIF is iPhone photos; MPO is a JPEG variant some phones write.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "HEIF"}

# Front ends allowed to call the API (CORS). Comma-separated in .env.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]

try:
    PORT = int(os.environ["PORT"])
except (KeyError, ValueError):
    raise RuntimeError("PORT is missing or not a number. Copy .env.example to .env and fill it in.")


def get_api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY")
