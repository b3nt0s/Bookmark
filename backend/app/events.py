from datetime import datetime


def parse_events(text: str, image: bytes, reference_datetime: datetime, timezone: str) -> dict:
    """Step 2 (not built yet): OCR text -> structured event data.

    Planned result: title, start, end, location, description, tags, each with a
    confidence. Gemma structured output for the shape, plus a function-calling tool
    for date resolution ("next Friday" relative to reference_datetime in timezone).
    `image` is the prepared JPEG bytes, so the model can check the text against the picture.

    /api/upload will call this right after extract_text (see main.py).
    """
    raise NotImplementedError("parse_events is not implemented yet")
