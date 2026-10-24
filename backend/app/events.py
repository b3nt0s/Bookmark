"""Flyer text + image -> structured calendar events, using Gemma's structured (JSON schema) output."""

import json
import logging
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from .errors import OcrError
from .ocr import generate

log = logging.getLogger("bookmark")

DEFAULT_DURATION = timedelta(hours=1)


# What we ask Gemma for. Dates come back as local wall-clock time; offsets are added in code.
class _Confidence(BaseModel):
    date: str
    location: str


class _Event(BaseModel):
    title: str
    start: str
    end: str
    location: str
    description: str
    confidence: _Confidence


class _Events(BaseModel):
    events: list[_Event]


PARSE_PROMPT = """You turn an event flyer into calendar events.

Today is {weekday}, {today}. The current local time is {now}. The user's timezone is {timezone}.

The next two weeks (use this to resolve words like "this Friday", "tomorrow" or "next Tuesday"):
{calendar}
Events on flyers are upcoming. "This Friday" means the first Friday on or after today, never one that has already passed.

You get the flyer image and a transcription of its text. Use the image to double-check the text.

Return every distinct event on the flyer (usually one). Rules:
- title: the event's name, as printed. Not a tagline, not the venue.
- start and end: local time at the venue, as "YYYY-MM-DDTHH:MM" (24-hour clock), with no timezone offset. If the flyer gives a date but no time, give just "YYYY-MM-DD". Resolve words like "this Friday" or "next Tuesday" from today's date above. Write dates like 11/4/26 as month/day/year (US) unless the flyer makes another order obvious. If a date has no year, use the next occurrence on or after today.
- If a flyer lists several times for one event (for example doors and show time), use the earliest as start and mention the others in the description.
- end: only if the flyer gives an end time or end date. Otherwise leave it as "".
- location: the venue and address as printed, in one line. "" if none.
- description: other useful details from the flyer (performers, price, age limit, RSVP or ticket info, food, contact), as short plain text. Do not repeat the title, date or location. "" if there is nothing else.
- Flyers can contain stray text from background art, collages, or neighboring flyers. Use the image to decide which date and time belong to the event, usually the most prominent ones.
- NEVER guess. If something is not on the flyer, use "". Do not invent times, places, or details.
- confidence.date: "high" only if a full date (and time, when given) is clearly printed and unambiguous. Otherwise "low" (missing year, relative wording, several conflicting dates, hard to read, or no date).
- confidence.location: "high" only if a venue or address is clearly printed. Otherwise "low" (partial, hard to read, or none).

Flyer text:
{text}"""

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?")


def _parse_local(value: str) -> tuple[datetime, bool] | None:
    """'2026-10-28T17:00' -> (naive datetime, has_time). '2026-10-28' -> (midnight, False)."""
    m = _DATE.match((value or "").strip())
    if not m:
        return None
    y, mo, d, hh, mm = m.groups()
    try:
        return datetime(int(y), int(mo), int(d), int(hh or 0), int(mm or 0)), hh is not None
    except ValueError:
        return None


def _confidence(value: str, present: bool) -> str:
    return "high" if present and (value or "").strip().lower() == "high" else "low"


def _clean_event(raw: _Event, tz: ZoneInfo, today: date) -> dict | None:
    title = raw.title.strip()
    location = raw.location.strip()
    start = _parse_local(raw.start)
    end = _parse_local(raw.end)
    if not (title or start or location):
        return None  # nothing usable

    start_out = end_out = ""
    end_defaulted = False
    start_conf = _confidence(raw.confidence.date, start is not None)  # the model's own view of the start date
    if start and start[0].date() < today:
        start_conf = "low"  # flyers advertise upcoming events, so a past date is probably a misread
    date_conf = start_conf

    if start:
        start_dt, start_has_time = start
        if start_has_time:
            start_out = start_dt.replace(tzinfo=tz).isoformat(timespec="seconds")
            if end and end[1] and end[0] > start_dt:
                end_out = end[0].replace(tzinfo=tz).isoformat(timespec="seconds")
            else:
                # No usable end time: default to one hour and flag it.
                end_out = (start_dt + DEFAULT_DURATION).replace(tzinfo=tz).isoformat(timespec="seconds")
                end_defaulted = True
                date_conf = "low"
        else:
            start_out = start_dt.date().isoformat()  # date only = all-day
            if end and end[0].date() > start_dt.date():
                end_out = end[0].date().isoformat()

    return {
        "title": title,
        "start": start_out,
        "end": end_out,
        "end_defaulted": end_defaulted,
        "location": location,
        "description": raw.description.strip(),
        "confidence": {"date": date_conf, "start": start_conf, "location": _confidence(raw.confidence.location, bool(location))},
    }


def _calendar(reference_datetime: datetime) -> str:
    """The next 14 days, one per line, so the model never has to do weekday math."""
    days = (reference_datetime + timedelta(days=n) for n in range(14))
    return "\n".join(f"- {d:%A} {d.date().isoformat()}" + (" (today)" if i == 0 else "") for i, d in enumerate(days))


def parse_events(text: str, image: bytes, reference_datetime: datetime, timezone: str) -> list[dict]:
    """Turn the flyer's text and image into a list of events.

    reference_datetime is "now" for the user (used to resolve words like "this Friday");
    timezone is their IANA name. Raises OcrError if the model call fails or returns junk.
    """
    tz = ZoneInfo(timezone)
    prompt = PARSE_PROMPT.format(
        weekday=reference_datetime.strftime("%A"),
        today=reference_datetime.date().isoformat(),
        calendar=_calendar(reference_datetime),
        now=reference_datetime.strftime("%H:%M"),
        timezone=timezone,
        text=text,
    )
    raw = generate(image, prompt, "parse", response_mime_type="application/json", response_schema=_Events)
    try:
        parsed = _Events.model_validate(json.loads(raw))
    except ValueError as e:
        log.error("parse_events: bad JSON from model: %s", raw[:300])
        raise OcrError("PARSE_FAILED", "Couldn't make sense of the model's answer. Try again.", 502) from e

    events = [e for e in (_clean_event(ev, tz, reference_datetime.date()) for ev in parsed.events) if e]
    log.info("parse_events: %d event(s)", len(events))
    return events
