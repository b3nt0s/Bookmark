from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import ALLOWED_ORIGINS, MAX_UPLOAD_BYTES, SITE_DIR
from .errors import AppError, BadRequest
from .images import prepare_image
from .ocr import extract_text

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
    return error_response(400, "BAD_REQUEST", 'Send multipart/form-data with an image in the "file" field.')


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


# Plain `def` (not async): FastAPI runs it in a worker thread, so the blocking
# Gemma call and its retry sleeps don't freeze the server.
@app.post("/api/upload")
def upload(
    file: UploadFile = File(...),
    timezone: str | None = Form(None),
    reference_datetime: str | None = Form(None),
):
    # Everything stays in memory; nothing is written to disk.
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise BadRequest("FILE_TOO_LARGE", f"File is over the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit.")
    if not data:
        raise BadRequest("EMPTY_FILE", "The uploaded file is empty.")

    reference, tz_name = resolve_time_context(timezone, reference_datetime)  # unused until parse_events
    jpeg = prepare_image(data)
    result = extract_text(jpeg)

    # Next step: events = parse_events(result["text"], jpeg, reference, tz_name)
    return result


@app.get("/test")
def test_page():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


# The Stitch screens, at /. Mounted last so the routes above take priority.
app.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")
