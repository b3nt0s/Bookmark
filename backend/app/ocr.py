"""Flyer image -> text, using Gemma through the Gemini API. Python port of src/ocr.js."""

import time
from datetime import datetime, timezone

from google import genai
from google.genai import errors, types

from .config import MAX_ATTEMPTS, MODEL, RETRY_BASE_DELAY_S, get_api_key
from .errors import OcrError

# Gemma on the Gemini API doesn't accept a system instruction, so the whole
# prompt goes in the user turn.
OCR_PROMPT = """Transcribe ALL visible text on this event flyer exactly as written.

Rules:
- Read in natural order: the title first, then the details (date, time, place, price, etc.).
- Keep the original line breaks.
- Transcribe verbatim. Do NOT correct spelling, fix grammar, reformat dates, or add anything that is not on the flyer.
- If a piece of text is unreadable, write [unclear] in its place.
- Output only the transcription: no commentary, no markdown, no code fences."""

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    api_key = get_api_key()
    if not api_key:
        raise OcrError(
            "MISSING_API_KEY",
            "Server is missing GEMINI_API_KEY. Copy .env.example to .env and add a key.",
            500,
        )
    if _client is None:
        _client = genai.Client(api_key=api_key)
    return _client


def call_with_retry(fn):
    """Call fn(), retrying on 429 with exponential backoff (2s, 4s), MAX_ATTEMPTS tries total."""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return fn()
        except errors.APIError as e:
            if e.code != 429:
                raise
            if attempt == MAX_ATTEMPTS:
                raise OcrError(
                    "RATE_LIMITED",
                    f"Rate limited by the Gemini API after {MAX_ATTEMPTS} attempts. Wait a minute and try again.",
                    429,
                ) from e
            delay = RETRY_BASE_DELAY_S * 2 ** (attempt - 1)
            print(f"Rate limited (429). Retrying in {delay:g}s (attempt {attempt + 1}/{MAX_ATTEMPTS})...")
            time.sleep(delay)


def extract_text(jpeg_bytes: bytes) -> dict:
    """Transcribe all text on a flyer. Expects JPEG bytes from images.prepare_image.

    Returns {"text", "model", "processed_at"}.
    """
    client = get_client()
    try:
        response = call_with_retry(
            lambda: client.models.generate_content(
                model=MODEL,
                contents=[
                    types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg"),
                    OCR_PROMPT,
                ],
                config=types.GenerateContentConfig(temperature=0),
            )
        )
    except OcrError:
        raise
    except errors.APIError as e:
        raise OcrError("GEMMA_ERROR", f"The model request failed ({e.code}). Try again.", 502) from e
    except Exception as e:  # network problems, timeouts, etc.
        raise OcrError("GEMMA_ERROR", "Could not reach the model. Try again.", 502) from e

    text = (response.text or "").strip()
    if not text:
        raise OcrError("EMPTY_RESPONSE", "The model returned no text (the image may be blank or blocked).", 502)

    return {
        "text": text,
        "model": MODEL,
        "processed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
