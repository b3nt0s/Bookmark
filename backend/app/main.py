import base64
import hashlib
import hmac
import json
import logging
import secrets
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import certifi
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.formparsers import MultiPartParser

from .config import (
    AFTER_LOGIN_PATH,
    ALLOWED_ORIGINS,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    MAX_UPLOAD_BYTES,
    SESSION_SECRET,
    SITE_DIR,
)
from .errors import AppError, BadRequest
from .images import prepare_image
from .events import parse_events
from .gcal import CALENDAR_SCOPE, EventIn, calendar_status, create_event, store_token
from .ocr import extract_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bookmark")

# Starlette keeps uploads over 1MB in a temp file on disk. Raise the limit above our
# max upload size so photos stay in memory and are never written to disk.
MultiPartParser.spool_max_size = MAX_UPLOAD_BYTES + 1024 * 1024

app = FastAPI(title="Bookmark")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.exception_handler(AppError)
async def handle_app_error(request: Request, exc: AppError):
    return error_response(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    if request.url.path == "/api/upload":
        return error_response(400, "BAD_REQUEST", 'Send multipart/form-data with an image in the "file" field.')
    return error_response(400, "BAD_REQUEST", "Some event details are missing or invalid.")


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, exc: Exception):
    return error_response(500, "INTERNAL_ERROR", "Something went wrong on the server.")


def resolve_time_context(timezone: str | None, reference_datetime: str | None) -> tuple[datetime, str]:
    """Validate the optional date-parsing inputs. Defaults: UTC, and 'now' in that timezone."""
    try:
        tz = ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise BadRequest("BAD_TIMEZONE", f'Unknown timezone "{timezone}". Use an IANA name like America/New_York.')
    if reference_datetime:
        try:
            ref = datetime.fromisoformat(reference_datetime.replace("Z", "+00:00"))
        except ValueError:
            raise BadRequest("BAD_REFERENCE_DATETIME", "reference_datetime must be an ISO 8601 timestamp.")
        ref = ref.astimezone(tz) if ref.tzinfo else ref.replace(tzinfo=tz)
    else:
        ref = datetime.now(tz)
    return ref, tz.key


def _decode_jwt_payload(token: str) -> dict:
    payload_segment = token.split(".", 2)[1]
    padded = payload_segment + "=" * (-len(payload_segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))


# python.org builds of Python on macOS don't use the system certificates, so calls to
# Google fail with CERTIFICATE_VERIFY_FAILED unless we bring our own.
HTTPS_CONTEXT = ssl.create_default_context(cafile=certifi.where())

SESSION_COOKIE = "bookmark_session"
SESSION_MAX_AGE_S = 7 * 24 * 3600


def _sign(data: str) -> str:
    return hmac.new(SESSION_SECRET.encode(), data.encode(), hashlib.sha256).hexdigest()


def make_session(user: dict) -> str:
    """Cookie value: the user as base64 JSON plus an HMAC, so the browser can't edit it."""
    body = base64.urlsafe_b64encode(json.dumps({**user, "exp": int(time.time()) + SESSION_MAX_AGE_S}).encode()).decode()
    return f"{body}.{_sign(body)}"


def read_session(request: Request) -> dict | None:
    value = request.cookies.get(SESSION_COOKIE, "")
    body, _, signature = value.rpartition(".")
    if not body or not hmac.compare_digest(signature, _sign(body)):
        return None
    try:
        user = json.loads(base64.urlsafe_b64decode(body.encode()))
    except ValueError:
        return None
    if user.pop("exp", 0) < time.time():
        return None
    return user


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = read_session(request)
    if not user:
        raise AppError("NOT_SIGNED_IN", "Sign in with Google first.", 401)
    return {"authenticated": True, "user": user, "calendar": calendar_status(user.get("googleUserId"))}


@app.post("/api/auth/logout")
def auth_logout():
    response = JSONResponse({"authenticated": False})
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.get("/api/auth/google/config")
def google_auth_config():
    return {
        "clientId": GOOGLE_CLIENT_ID,
        "redirectUri": GOOGLE_REDIRECT_URI,
        "enabled": bool(GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI),
    }


@app.get("/api/auth/google/login")
def google_login(request: Request, next: str | None = None):
    if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
        raise BadRequest("GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth is not configured in the environment.")

    # Cookies are per host, so start on the same host Google will send the user back to
    # (e.g. localhost, not 127.0.0.1); otherwise the state and session cookies get lost.
    redirect_host = urllib.parse.urlsplit(GOOGLE_REDIRECT_URI).netloc
    if request.url.netloc != redirect_host:
        return RedirectResponse(f"{urllib.parse.urlsplit(GOOGLE_REDIRECT_URI).scheme}://{redirect_host}{request.url.path}")

    state = secrets.token_urlsafe(32)
    params = urllib.parse.urlencode(
        {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": f"openid email profile {CALENDAR_SCOPE}",
            "access_type": "online",
            "prompt": "select_account",
            "state": state,
        }
    )
    response = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
    response.set_cookie("google_oauth_state", state, httponly=True, samesite="lax")
    # Where to land after sign-in. Only paths on this site are allowed.
    if next and next.startswith("/") and not next.startswith("//"):
        response.set_cookie("google_oauth_next", next, httponly=True, samesite="lax", max_age=600)
    return response


@app.get("/api/auth/google/callback")
# GOOGLE_REDIRECT_URI may end in a slash; the static site mounted at / would 404 it otherwise.
@app.get("/api/auth/google/callback/", include_in_schema=False)
def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        raise BadRequest("GOOGLE_AUTH_ERROR", f"Google login failed: {error}.")
    if not code:
        raise BadRequest("MISSING_AUTH_CODE", "Google OAuth did not return an authorization code.")

    cookie_state = request.cookies.get("google_oauth_state")
    if not state or not cookie_state or not hmac.compare_digest(state, cookie_state):
        raise BadRequest("INVALID_STATE", "The Google OAuth state value did not match the request.")

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET or not GOOGLE_REDIRECT_URI:
        raise BadRequest("GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth credentials are not fully configured.")

    token_payload = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")
    token_request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(token_request, timeout=15, context=HTTPS_CONTEXT) as resp:
        token_response = json.loads(resp.read().decode("utf-8"))

    access_token = token_response.get("access_token")
    if not access_token:
        raise BadRequest("TOKEN_EXCHANGE_FAILED", "Google did not return an access token.")

    user_request = urllib.request.Request(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(user_request, timeout=15, context=HTTPS_CONTEXT) as resp:
        profile = json.loads(resp.read().decode("utf-8"))

    user = {
        "email": profile.get("email"),
        "name": profile.get("name") or profile.get("email") or "Google user",
        "picture": profile.get("picture"),
        "googleUserId": profile.get("sub"),
    }
    if user["googleUserId"]:
        store_token(user["googleUserId"], token_response)
    after = request.cookies.get("google_oauth_next", "")
    if not after.startswith("/") or after.startswith("//"):
        after = AFTER_LOGIN_PATH
    response = RedirectResponse(after, status_code=303)
    response.set_cookie(SESSION_COOKIE, make_session(user), max_age=SESSION_MAX_AGE_S, httponly=True, samesite="lax")
    response.delete_cookie("google_oauth_state")
    response.delete_cookie("google_oauth_next")
    return response


@app.post("/api/auth/google/session")
def google_session(payload: dict):
    credential = payload.get("credential")
    if not credential:
        raise BadRequest("MISSING_CREDENTIAL", "Google credential is missing.")

    try:
        header_segment, body_segment, _ = credential.split(".", 2)
    except ValueError:
        raise BadRequest("BAD_CREDENTIAL", "Google credential is malformed.")

    if not header_segment or not body_segment:
        raise BadRequest("BAD_CREDENTIAL", "Google credential is malformed.")

    claims = _decode_jwt_payload(credential)
    now = int(time.time())

    if claims.get("aud") != GOOGLE_CLIENT_ID:
        raise BadRequest("INVALID_CREDENTIAL", "The Google credential audience does not match this app.")
    if claims.get("exp", 0) < now:
        raise BadRequest("EXPIRED_CREDENTIAL", "The Google credential has expired.")
    if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise BadRequest("INVALID_CREDENTIAL", "The Google credential issuer is not valid.")

    return {
        "authenticated": True,
        "user": {
            "email": claims.get("email"),
            "name": claims.get("name") or claims.get("email") or "Google user",
            "picture": claims.get("picture"),
            "googleUserId": claims.get("sub"),
        },
    }


# Plain `def` (not async): FastAPI runs it in a worker thread, so the blocking
# Gemma call and its retry sleeps don't freeze the server.
@app.post("/api/upload")
def upload(
    file: UploadFile = File(...),
    timezone: str | None = Form(None),
    reference_datetime: str | None = Form(None),
):
    # Everything stays in memory; nothing is written to disk.
    started = time.perf_counter()
    outcome = "error"
    size = 0
    try:
        data = file.file.read(MAX_UPLOAD_BYTES + 1)
        size = len(data)
        if size > MAX_UPLOAD_BYTES:
            raise BadRequest("FILE_TOO_LARGE", f"File is over the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit.")
        if not data:
            raise BadRequest("EMPTY_FILE", "The uploaded file is empty.")

        reference, tz_name = resolve_time_context(timezone, reference_datetime)
        prepared_at = time.perf_counter()
        jpeg = prepare_image(data)
        prep_s = time.perf_counter() - prepared_at
        result = extract_text(jpeg)
        outcome = "ok"
        log.info("upload ok: received %.0fKB, resized to %.0fKB in %.2fs", size / 1024, len(jpeg) / 1024, prep_s)

        # Second step: pull structured events out of the text. If it fails, still return the
        # text so the user can fill the event in by hand.
        try:
            result["events"] = parse_events(result["text"], jpeg, reference, tz_name)
        except AppError as e:
            log.warning("parse_events failed: %s", e.message)
            result["events"] = []
            result["parse_error"] = e.message
        return result
    finally:
        log.info("upload %s: received %.0fKB, total %.1fs", outcome, size / 1024, time.perf_counter() - started)


@app.post("/api/events")
def add_event(event: EventIn, request: Request):
    """Create the confirmed event on the signed-in user's primary Google Calendar."""
    user = read_session(request)
    if not user or not user.get("googleUserId"):
        raise AppError("NOT_SIGNED_IN", "Sign in with Google first.", 401)
    created = create_event(user["googleUserId"], event)
    log.info("event created for %s", user.get("email"))
    return created


@app.get("/test")
def test_page():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


# The Stitch screens, at /. Mounted last so the routes above take priority.
app.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")
