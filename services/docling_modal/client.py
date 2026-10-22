"""Stdlib-only client for the Docling-on-Modal service (services/docling_modal/app.py).

The import pipeline will call :func:`extract` in step 2; this module is not wired in yet.
No third-party deps (urllib only). Config comes from the environment (names only):

    DOCLING_MODAL_URL    base URL of the deployed Modal endpoint (trailing slash optional)
    DOCLING_MODAL_TOKEN  shared secret, sent as the X-Docling-Token header

Every failure is a typed DoclingError subclass: DoclingConfigError, DoclingAuthError,
DoclingRequestError or DoclingTransportError.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DEFAULT_TIMEOUT_S = 120.0
DEFAULT_RETRIES = 1
ENV_URL = "DOCLING_MODAL_URL"
ENV_TOKEN = "DOCLING_MODAL_TOKEN"
TOKEN_HEADER = "X-Docling-Token"
EXTRACT_PATH = "/extract"

_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


class DoclingError(RuntimeError):
    """Base class for every Docling client failure."""


class DoclingConfigError(DoclingError):
    """DOCLING_MODAL_URL or DOCLING_MODAL_TOKEN is missing."""


class DoclingAuthError(DoclingError):
    """The service rejected our shared secret (HTTP 401/403)."""


class DoclingRequestError(DoclingError):
    """The service returned an error or an unreadable body (HTTP 4xx/5xx, bad JSON)."""


class DoclingTransportError(DoclingError):
    """The HTTP request failed at the transport level, even after the retry."""


def _content_type(filename: str) -> str:
    return _CONTENT_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")


def _multipart(data: bytes, filename: str, boundary: str) -> bytes:
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {_content_type(filename)}\r\n\r\n"
    ).encode()
    footer = f"\r\n--{boundary}--\r\n".encode()
    return header + data + footer


def _read(path: str | Path) -> tuple[bytes, str]:
    source = Path(path)
    return source.read_bytes(), source.name


def _post(endpoint: str, body: bytes, headers: dict[str, str], timeout: float) -> dict:
    request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise DoclingAuthError(f"docling auth failed (HTTP {exc.code})") from exc
        raise DoclingRequestError(f"docling service error (HTTP {exc.code})") from exc
    except OSError as exc:  # URLError, TimeoutError and socket errors all subclass OSError
        raise DoclingTransportError(f"docling request failed: {exc}") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except ValueError as exc:  # JSONDecodeError and UnicodeDecodeError both subclass ValueError
        raise DoclingRequestError("docling service returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise DoclingRequestError("docling service returned an unexpected payload")
    return payload


def extract(
    path: str | Path,
    *,
    url: str | None = None,
    token: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_S,
    retries: int = DEFAULT_RETRIES,
) -> dict:
    """Parse one PDF/image on the Docling service and return its JSON payload.

    Retries transport failures up to ``retries`` times (default: once). Raises a
    DoclingError subclass on any failure; never leaks a raw urllib error.
    """
    base = (url or os.environ.get(ENV_URL, "")).strip().rstrip("/")
    secret = token if token is not None else os.environ.get(ENV_TOKEN, "")
    if not base:
        raise DoclingConfigError(f"{ENV_URL} is not set")
    if not secret:
        raise DoclingConfigError(f"{ENV_TOKEN} is not set")

    data, filename = _read(path)
    boundary = uuid.uuid4().hex
    body = _multipart(data, filename, boundary)
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        TOKEN_HEADER: secret,
    }
    endpoint = base + EXTRACT_PATH

    last_error: DoclingTransportError | None = None
    for _ in range(max(0, retries) + 1):
        try:
            return _post(endpoint, body, headers, timeout)
        except DoclingTransportError as exc:
            last_error = exc
    assert last_error is not None  # the loop body runs at least once
    raise last_error
