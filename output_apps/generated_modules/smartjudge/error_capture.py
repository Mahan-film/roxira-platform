"""Error capture for the Python AI core (T199): same table and shape as the NestJS backend.

The AI core already has a direct Postgres path (psycopg, same database as the backend), so an
unhandled exception is upserted straight into ``ops_error_events`` (one row per fingerprint per UTC
day). There is no internal HTTP endpoint and therefore no shared token to manage. Alerts (Telegram,
daily digest) are produced by the backend worker from that table.

Scrubbing mirrors ``enterprise_hub/modules/ops_errors/ops-errors.util.ts``: no request body, headers
or query string is ever read; e-mails, tokens and digit runs longer than 6 are masked.

Install once on the FastAPI app: ``install_error_capture(app)``. Capture never raises.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import traceback
from typing import Any, Optional

log = logging.getLogger("smartjudge.error_capture")

SOURCE = "ai-core"
MAX_MESSAGE = 300
MAX_STACK = 2000
MAX_ROUTE = 200

_JWT = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*")
_BEARER = re.compile(r"bearer\s+[A-Za-z0-9._~+/=-]+", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_KV_SECRET = re.compile(r"\b(token|key|secret|password|pass|otp|code|authorization|apikey|api_key)=\S+", re.I)
_URL_QUERY = re.compile(r"\?[^\s\"'<>)]*")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_LONG_TOKEN = re.compile(r"[A-Za-z0-9_-]{32,}")
_LONG_DIGITS = re.compile(r"\d{7,}")
_PLACEHOLDER = re.compile(r"\[(?:uuid|token|num|email|jwt|bearer)\]")
_HEXISH = re.compile(r"\b[0-9a-f]{8,}\b", re.I)
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def scrub_text(text: str) -> str:
    text = _JWT.sub("[jwt]", text)
    text = _BEARER.sub("[bearer]", text)
    text = _KV_SECRET.sub(lambda m: f"{m.group(1)}=[x]", text)
    text = _URL_QUERY.sub("", text)
    text = _EMAIL.sub("[email]", text)
    text = _UUID.sub("[uuid]", text)
    text = _LONG_TOKEN.sub("[token]", text)
    return _LONG_DIGITS.sub("[num]", text)


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def normalize_message(message: str) -> str:
    text = _PLACEHOLDER.sub("#", scrub_text(message))
    text = _HEXISH.sub("#", text)
    text = re.sub(r"\d+", "#", text)
    return re.sub(r"\s+", " ", text).strip()[:200]


def top_app_frame(exc: BaseException) -> str:
    """Innermost frame that is not site-packages/stdlib, as ``function@file`` (no line numbers)."""
    frames = traceback.extract_tb(exc.__traceback__)
    for fr in reversed(frames):
        path = fr.filename.replace("\\", "/")
        if "site-packages" in path or "/lib/python" in path or "<frozen" in path:
            continue
        return f"{fr.name}@{path.rsplit('/', 1)[-1]}"
    return "no-app-frame"


def compute_fingerprint(error_class: str, message: str, frame: str) -> str:
    return hashlib.sha256(f"{error_class}\n{normalize_message(message)}\n{frame}".encode()).hexdigest()


def current_release() -> Optional[str]:
    value = os.environ.get("GIT_SHA") or os.environ.get("RELEASE")
    return value[:12] if value and value != "unknown" else None


def safe_route(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    path = path.split("?", 1)[0].split("#", 1)[0]
    return truncate(re.sub(r"/\d+(?=/|$)", "/:n", scrub_text(path)), MAX_ROUTE)


def build_event(
    exc: BaseException,
    *,
    route: Optional[str] = None,
    method: Optional[str] = None,
    status: Optional[int] = 500,
    tenant_id: Optional[str] = None,
) -> dict[str, Any]:
    error_class = truncate(type(exc).__name__, 120)
    message = str(exc)
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return {
        "fingerprint": compute_fingerprint(error_class, message, top_app_frame(exc)),
        "source": SOURCE,
        "error_class": error_class,
        "route": safe_route(route),
        "http_method": method.upper()[:10] if method else None,
        "status": status,
        "release": current_release(),
        "tenant_id": tenant_id if tenant_id and _UUID_RE.match(tenant_id) else None,
        "sample_message": truncate(scrub_text(message), MAX_MESSAGE),
        "sample_stack": truncate(scrub_text(stack), MAX_STACK),
    }


# Keep identical to OpsErrorEventsRepository.upsert (enterprise_hub).
UPSERT_SQL = """
INSERT INTO ops_error_events
  (fingerprint, day, source, error_class, route, http_method, status, release, tenant_id,
   sample_message, sample_stack)
VALUES (%(fingerprint)s, (now() AT TIME ZONE 'UTC')::date, %(source)s, %(error_class)s, %(route)s,
        %(http_method)s, %(status)s, %(release)s, %(tenant_id)s, %(sample_message)s, %(sample_stack)s)
ON CONFLICT (fingerprint, day) DO UPDATE SET
  last_seen = now(),
  count = ops_error_events.count + 1,
  prev_hour_count = CASE
    WHEN ops_error_events.hour_start = date_trunc('hour', now()) THEN ops_error_events.prev_hour_count
    WHEN ops_error_events.hour_start = date_trunc('hour', now()) - interval '1 hour' THEN ops_error_events.hour_count
    ELSE 0 END,
  hour_count = CASE
    WHEN ops_error_events.hour_start = date_trunc('hour', now()) THEN ops_error_events.hour_count + 1
    ELSE 1 END,
  hour_start = date_trunc('hour', now()),
  route = COALESCE(EXCLUDED.route, ops_error_events.route),
  status = COALESCE(EXCLUDED.status, ops_error_events.status),
  release = COALESCE(EXCLUDED.release, ops_error_events.release)
"""


def _dsn() -> str:
    # Same database and role the rest of the AI core uses (smartjudge_module.POSTGRES_DSN).
    return os.environ.get("OPS_ERRORS_DSN") or (
        "postgresql://enterprise_admin:"
        f"{os.environ.get('POSTGRES_PASSWORD', '')}@roxira_postgres_prod:5432/enterprise_db"
    )


def write_event(event: dict[str, Any]) -> None:
    import psycopg  # imported lazily so a missing driver never breaks app start

    with psycopg.connect(_dsn(), connect_timeout=3, autocommit=True) as conn:
        conn.execute(UPSERT_SQL, event)


def capture_exception(exc: BaseException, **ctx: Any) -> None:
    """Best effort: scrub, fingerprint and upsert. Never raises."""
    try:
        write_event(build_event(exc, **ctx))
    except Exception as err:  # noqa: BLE001 - capture must never break a request
        log.warning("error capture failed: %s", type(err).__name__)


class ErrorCaptureMiddleware:
    """Pure ASGI middleware: records unhandled exceptions, then re-raises so the response is unchanged."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        except Exception as exc:  # noqa: BLE001
            route = getattr(scope.get("route"), "path", None) or scope.get("path")
            # Off the event loop; failures are swallowed inside capture_exception.
            await asyncio.to_thread(
                capture_exception, exc, route=route, method=scope.get("method"), status=500
            )
            raise


def install_error_capture(app) -> None:
    app.add_middleware(ErrorCaptureMiddleware)
