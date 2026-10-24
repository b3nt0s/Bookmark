"""Flyer image -> text, using Gemma through the Gemini API. Python port of src/ocr.js."""

import logging
import time
from datetime import datetime, timezone

import httpx
from google import genai
from google.genai import errors, types

from .config import MAX_ATTEMPTS, MODEL, REQUEST_TIMEOUT_S, RETRY_BASE_DELAY_S, THINKING_LEVEL, get_api_key
from .errors import OcrError

# Gemma on the Gemini API doesn't accept a system instruction, so the whole
# prompt goes in the user turn.
OCR_PROMPT = """Transcribe ALL visible text on this event flyer exactly as written.

Rules:
- Read in natural order: the title first, then the details (date, time, place, price, etc.).
- Where text sits in columns or side-by-side blocks, finish one block before starting the next. Never join lines from different blocks into one line.
- Include small print, captions, and text in stylized, decorative, or handwritten fonts. Look closely at each letter shape.
- Keep the original line breaks.
- Transcribe verbatim: copy exactly what is printed, including odd spelling, capitalization, and punctuation. Do NOT correct, complete, or guess. Do not reformat dates or times. Do not add words that are not on the flyer.
- Ignore text that belongs to neighboring flyers, posters, or objects around the flyer.
- If a piece of text is unreadable, or you are not sure what it says, write [unclear] in its place instead of guessing.
- Transcribe text only. Do not describe or label images, logos, photos, or QR codes.
- Output only the transcription: no commentary, no markdown, no code fences."""

log = logging.getLogger("bookmark")

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
        _client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_S * 1000),  # milliseconds
        )
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
            log.warning("Rate limited (429). Retrying in %gs (attempt %d/%d)", delay, attempt + 1, MAX_ATTEMPTS)
            time.sleep(delay)


def extract_text(jpeg_bytes: bytes) -> dict:
    """Transcribe all text on a flyer. Expects JPEG bytes from images.prepare_image.

    Returns {"text", "model", "processed_at"}.
    """
    client = get_client()
    started = time.perf_counter()
    try:
        response = call_with_retry(
            lambda: client.models.generate_content(
                model=MODEL,
                contents=[
                    types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg"),
                    OCR_PROMPT,
                ],
                config=types.GenerateContentConfig(
                    temperature=0,
                    thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
                ),
            )
        )
    except OcrError:
        raise
    except errors.APIError as e:
        log.error("Gemma API error %s after %.1fs", e.code, time.perf_counter() - started)
        raise OcrError("GEMMA_ERROR", f"The model request failed ({e.code}). Try again.", 502) from e
    except httpx.TimeoutException as e:
        log.error("Gemma call timed out after %.1fs", time.perf_counter() - started)
        raise OcrError("GEMMA_TIMEOUT", "The model took too long to respond. Try again.", 504) from e
    except Exception as e:  # network problems, etc.
        log.error("Gemma call failed after %.1fs: %s", time.perf_counter() - started, type(e).__name__)
        raise OcrError("GEMMA_ERROR", "Could not reach the model. Try again.", 502) from e

    log.info("Gemma call took %.1fs", time.perf_counter() - started)
    text = (response.text or "").strip()
    if not text:
        raise OcrError("EMPTY_RESPONSE", "The model returned no text (the image may be blank or blocked).", 502)

    return {
        "text": text,
        "model": MODEL,
        "processed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
