"""Creating events on the signed-in user's Google Calendar."""

import logging
import time
from datetime import date, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from pydantic import BaseModel

from .errors import AppError, BadRequest

log = logging.getLogger("bookmark")

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

# Access tokens by Google user id, kept in server memory only (never sent to the browser).
# A server restart clears them, and the user simply signs in again.
_tokens: dict[str, dict] = {}


def store_token(user_id: str, token_response: dict) -> None:
    _tokens[user_id] = {
        "access_token": token_response["access_token"],
        "expires_at": time.time() + int(token_response.get("expires_in", 3600)) - 30,
        "scopes": set((token_response.get("scope") or "").split()),
    }


def calendar_status(user_id: str | None) -> str:
    """'ready', or the reason the user can't add events yet."""
    token = _tokens.get(user_id or "")
    if not token:
        return "not_connected"
    if CALENDAR_SCOPE not in token["scopes"]:
        return "permission_missing"
    if token["expires_at"] <= time.time():
        return "expired"
    return "ready"


class EventIn(BaseModel):
    title: str
    all_day: bool = False
    start_date: str                  # YYYY-MM-DD
    start_time: str | None = None    # HH:MM
    end_date: str | None = None
    end_time: str | None = None
    location: str = ""
    description: str = ""
    reminder: Literal["10m", "30m", "1h", "1d", "none"] = "none"
    timezone: str


REMINDER_MINUTES = {"10m": 10, "30m": 30, "1h": 60, "1d": 1440}


def build_event(ev: EventIn) -> dict:
    """The confirmed fields -> a Google Calendar event body, in the user's timezone."""
    try:
        ZoneInfo(ev.timezone)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise BadRequest("BAD_TIMEZONE", f'Unknown timezone "{ev.timezone}".')
    title = ev.title.strip()
    if not title:
        raise BadRequest("BAD_EVENT", "The event needs a title.")
    try:
        start_day = date.fromisoformat(ev.start_date)
        end_day = date.fromisoformat(ev.end_date) if ev.end_date else start_day
    except ValueError:
        raise BadRequest("BAD_EVENT", "The event needs a valid start date.")

    if ev.all_day:
        # All-day events end on the day after their last day.
        start = {"date": start_day.isoformat()}
        end = {"date": (max(end_day, start_day) + timedelta(days=1)).isoformat()}
    else:
        if not ev.start_time:
            raise BadRequest("BAD_EVENT", "The event needs a start time (or mark it all-day).")
        end_time = ev.end_time or ev.start_time
        start = {"dateTime": f"{start_day.isoformat()}T{ev.start_time}:00", "timeZone": ev.timezone}
        end = {"dateTime": f"{end_day.isoformat()}T{end_time}:00", "timeZone": ev.timezone}
        if end["dateTime"] < start["dateTime"]:
            raise BadRequest("BAD_EVENT", "The event ends before it starts.")

    body = {"summary": title, "start": start, "end": end}
    if ev.location.strip():
        body["location"] = ev.location.strip()
    if ev.description.strip():
        body["description"] = ev.description.strip()
    minutes = REMINDER_MINUTES.get(ev.reminder)
    body["reminders"] = {
        "useDefault": False,
        "overrides": [{"method": "popup", "minutes": minutes}] if minutes else [],
    }
    return body


def _google_error(resp: httpx.Response) -> AppError:
    try:
        err = resp.json().get("error", {})
    except ValueError:
        err = {}
    reasons = {e.get("reason") for e in err.get("errors", []) if isinstance(e, dict)}
    log.error("Calendar API %s: %s", resp.status_code, str(err)[:400])
    if resp.status_code == 401:
        return AppError("TOKEN_EXPIRED", "Your Google session expired. Sign in again to keep going.", 401)
    if resp.status_code == 403 and (reasons & {"insufficientPermissions", "forbidden"} or "insufficient" in err.get("message", "").lower()):
        return AppError(
            "CALENDAR_PERMISSION_MISSING",
            "Bookmark doesn't have permission to add events to your calendar. Sign in again and allow calendar access.",
            403,
        )
    if resp.status_code == 403 and (reasons & {"accessNotConfigured"} or "has not been used" in err.get("message", "")):
        return AppError(
            "CALENDAR_API_DISABLED",
            "The Google Calendar API isn't turned on for this app's Google Cloud project yet.",
            502,
        )
    if resp.status_code == 429 or reasons & {"rateLimitExceeded", "userRateLimitExceeded"}:
        return AppError("CALENDAR_RATE_LIMITED", "Google Calendar is busy. Try again in a minute.", 429)
    return AppError("CALENDAR_ERROR", "Google Calendar couldn't create the event. Try again.", 502)


def create_event(user_id: str, ev: EventIn) -> dict:
    """Insert the event on the user's primary calendar. Returns {id, htmlLink, summary}."""
    status = calendar_status(user_id)
    if status == "not_connected":
        raise AppError(
            "CALENDAR_NOT_CONNECTED",
            "Bookmark needs your permission to add events. Sign in again and allow calendar access.",
            401,
        )
    if status == "permission_missing":
        raise AppError(
            "CALENDAR_PERMISSION_MISSING",
            "Bookmark doesn't have permission to add events to your calendar. Sign in again and allow calendar access.",
            403,
        )
    if status == "expired":
        raise AppError("TOKEN_EXPIRED", "Your Google session expired. Sign in again to keep going.", 401)

    body = build_event(ev)
    started = time.perf_counter()
    try:
        resp = httpx.post(
            EVENTS_URL,
            json=body,
            headers={"Authorization": f"Bearer {_tokens[user_id]['access_token']}"},
            timeout=15,
        )
    except httpx.HTTPError as e:
        log.error("Calendar API unreachable: %s", type(e).__name__)
        raise AppError("CALENDAR_ERROR", "Couldn't reach Google Calendar. Try again.", 502) from e
    log.info("Calendar insert took %.1fs (%s)", time.perf_counter() - started, resp.status_code)
    if resp.status_code >= 400:
        raise _google_error(resp)
    created = resp.json()
    return {"id": created.get("id"), "htmlLink": created.get("htmlLink"), "summary": created.get("summary", body["summary"])}
