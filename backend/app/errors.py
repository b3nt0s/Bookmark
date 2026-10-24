class AppError(Exception):
    """An error we can show the caller as clean JSON: {"error": {"code", "message"}}."""

    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class BadRequest(AppError):
    def __init__(self, code: str, message: str):
        super().__init__(code, message, 400)


class OcrError(AppError):
    """Failure talking to Gemma (not the caller's fault, unless rate limited)."""
