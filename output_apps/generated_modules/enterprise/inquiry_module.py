"""Enterprise sales inquiry intake — Roxira OS.

Exposes a single, dependency-light endpoint consumed by the Enterprise Hub
landing page (``EnterpriseSalesForm``):

    POST /api/v1/enterprise/inquiry  ->  202 Accepted
    {"status": "received", "reference": "RQ-XXXXXX", "received_at": 1758027600.0}

Every accepted inquiry is appended as one JSON object per line (JSONL) to
``/opt/roxira_platform/data/inquiries.jsonl`` so sales can tail/import the file
without a database round-trip.

Design notes
------------
* No hard dependency beyond FastAPI + pydantic — the unified server imports
  every ``generated_modules`` file at boot, so an import error here would
  silently drop the route.  Format validation is therefore done inline instead
  of pulling in ``email-validator`` (``EmailStr``).
* The storage path is overridable via ``ROXIRA_INQUIRIES_PATH`` (full file) or
  ``ROXIRA_DATA_DIR`` (directory), mirroring the host ``/opt/roxira_platform``
  vs container ``/app`` split used by ``run_unified_server.py``.  If the
  configured location is not writable the record is still persisted to a local
  ``./data/inquiries.jsonl`` fallback so a lead is never lost.
* Appends are serialised by a lock and shipped to a worker thread, so a burst
  of concurrent submissions cannot interleave partial JSON lines or block the
  event loop.

The module exposes ``router``; ``run_unified_server.py`` discovers it
automatically (see the dynamic router loader there).
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import re
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

__all__ = ["router", "InquiryRequest", "append_inquiry", "inquiries_path", "fallback_path"]

router = APIRouter(prefix="/api/v1/enterprise", tags=["Enterprise Sales Inquiry"])

# ---------------------------------------------------------------------------
# Storage configuration
# ---------------------------------------------------------------------------

DEFAULT_INQUIRIES_PATH = "/opt/roxira_platform/data/inquiries.jsonl"
DEFAULT_TIER = "starter"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[0-9+\-\s()]{7,20}$")

_write_lock = threading.Lock()


def inquiries_path() -> pathlib.Path:
    """Primary JSONL sink (env-overridable for host / container parity)."""
    override = os.getenv("ROXIRA_INQUIRIES_PATH", "").strip()
    if override:
        return pathlib.Path(override)
    data_dir = os.getenv("ROXIRA_DATA_DIR", "").strip()
    if data_dir:
        return pathlib.Path(data_dir) / "inquiries.jsonl"
    return pathlib.Path(DEFAULT_INQUIRIES_PATH)


def fallback_path() -> pathlib.Path:
    """Last-resort sink next to the repo, used when the primary path is RO."""
    return pathlib.Path(__file__).resolve().parents[3] / "data" / "inquiries.jsonl"


def _write_line(path: pathlib.Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _write_lock:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()


def append_inquiry(record: dict[str, Any]) -> str:
    """Append ``record`` as a single JSONL line; return the file actually used.

    Blocking I/O — call via :func:`asyncio.to_thread`.  Never raises for a
    writable-but-not-primary location: only a total I/O failure propagates.
    """
    payload = json.dumps(record, ensure_ascii=False) + "\n"
    primary = inquiries_path()
    try:
        _write_line(primary, payload)
        return str(primary)
    except OSError as exc:
        fallback = fallback_path()
        try:
            _write_line(fallback, payload)
        except OSError:
            raise
        print(
            "[enterprise.inquiry] WARN primary sink unavailable (%s): %s -> fell back to %s"
            % (primary, exc, fallback),
            file=sys.stderr,
        )
        return str(fallback)


# ---------------------------------------------------------------------------
# Request / response contracts
# ---------------------------------------------------------------------------


class InquiryRequest(BaseModel):
    """Payload posted by the Enterprise Hub sales form."""

    company: str = Field(..., min_length=2, max_length=200)
    phone: str = Field(..., min_length=7, max_length=20)
    email: str = Field(..., min_length=5, max_length=200)
    tier: str = Field(default=DEFAULT_TIER, max_length=64)
    notes: Optional[str] = Field(default="", max_length=4000)
    source: Optional[str] = Field(default=None, max_length=64)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/inquiry", status_code=status.HTTP_202_ACCEPTED)
async def create_inquiry(payload: InquiryRequest, request: Request) -> dict[str, Any]:
    """Accept an enterprise sales inquiry and durably append it to the JSONL log."""
    company = payload.company.strip()
    phone = payload.phone.strip()
    email = payload.email.strip().lower()
    notes = (payload.notes or "").strip()

    if len(company) < 2:
        raise HTTPException(status_code=422, detail="company is required")
    if not PHONE_RE.match(phone):
        raise HTTPException(status_code=422, detail="phone must be a valid contact number")
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="email must be a valid address")

    reference = f"RQ-{uuid.uuid4().hex[:6].upper()}"
    received_at = time.time()
    record: dict[str, Any] = {
        "reference": reference,
        "company": company,
        "phone": phone,
        "email": email,
        "tier": (payload.tier or DEFAULT_TIER).strip(),
        "notes": notes,
        "source": (payload.source or "enterprise-hub").strip(),
        "client_ip": (request.client.host if request.client else None),
        "user_agent": request.headers.get("user-agent"),
        "received_at": received_at,
        "received_at_iso": datetime.fromtimestamp(received_at, tz=timezone.utc).isoformat(),
    }

    try:
        await asyncio.to_thread(append_inquiry, record)
    except OSError as exc:
        print("[enterprise.inquiry] ERROR persisting inquiry: %s" % exc, file=sys.stderr)
        raise HTTPException(status_code=503, detail="inquiry storage unavailable") from exc

    return {"status": "received", "reference": reference, "received_at": received_at}
