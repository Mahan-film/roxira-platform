"""Docling document extraction on Modal (step 1: service only; flag OFF).

Heavy PDF/Word/image parsing runs off srv1: a Modal CPU container scales to zero and is
called over HTTP by our servers (``services/docling_modal/client.py``). The import pipeline
will call it in step 2; nothing is wired in yet, so this is inert until deployed.

Deploy (from a machine with the Modal token, never from an agent):
    modal deploy services/docling_modal/app.py

Env / Secret (names only; values live in the Modal Secret, never in code):
    DOCLING_SHARED_SECRET   shared secret; the client sends it as X-Docling-Token
See services/docling_modal/README.md for the cost model and the client contract.
"""
from __future__ import annotations

import io
import os
import secrets
from typing import Annotated, Any

import modal
from fastapi import FastAPI, File, Header, UploadFile
from fastapi.responses import JSONResponse

DOCLING_VERSION = "2.5.0"  # pinned: Docling moves fast (docs/research/TECH_AUDIT_2026-10-14.md)
APP_NAME = "roxira-docling"
SECRET_NAME = "docling-modal"  # Modal Secret holding the env vars below
SECRET_ENV = "DOCLING_SHARED_SECRET"
TOKEN_HEADER = "X-Docling-Token"
MAX_BYTES = 50 * 1024 * 1024  # 50 MB per file
TIMEOUT_S = 120
MAX_CONTAINERS = 2
CPU = 2.0
MEMORY_MIB = 4096

app = modal.App(APP_NAME)
web = FastAPI(title=APP_NAME, version="0.1.0")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        f"docling=={DOCLING_VERSION}",
        "fastapi>=0.115",
        "python-multipart>=0.0.12",
    )
)

_converter: Any = None


def _get_converter() -> Any:
    """Build the Docling converter once per container (the model load is expensive)."""
    global _converter
    if _converter is None:
        from docling.document_converter import DocumentConverter

        _converter = DocumentConverter()
    return _converter


def _convert(data: bytes, filename: str) -> dict[str, Any]:
    """Run Docling on the uploaded bytes and return markdown + tables + page count."""
    from docling.datamodel.document import DocumentStream

    source = DocumentStream(name=filename, stream=io.BytesIO(data))
    document = _get_converter().convert(source).document

    tables: list[list[list[str]]] = []
    for table in document.tables:
        grid = getattr(table.data, "grid", None) or []
        tables.append([[cell.text for cell in row] for row in grid])

    return {
        "markdown": document.export_to_markdown(),
        "tables": tables,
        "pages": len(document.pages),
    }


def _authorized(token: str | None) -> bool:
    expected = os.environ.get(SECRET_ENV, "")
    if not expected or not token:
        return False  # fail closed: no secret configured means no access
    return secrets.compare_digest(token, expected)


@web.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@web.post("/extract")
def extract(
    file: Annotated[UploadFile, File()],
    x_docling_token: Annotated[str | None, Header(alias=TOKEN_HEADER)] = None,
) -> JSONResponse:
    if not _authorized(x_docling_token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    data = file.file.read()
    if not data:
        return JSONResponse({"error": "empty file"}, status_code=400)
    if len(data) > MAX_BYTES:
        return JSONResponse({"error": "file too large"}, status_code=413)

    try:
        payload = _convert(data, file.filename or "upload")
    except Exception as exc:
        return JSONResponse({"error": f"conversion failed: {type(exc).__name__}"}, status_code=502)
    return JSONResponse(payload)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name(SECRET_NAME)],
    timeout=TIMEOUT_S,
    max_containers=MAX_CONTAINERS,
    cpu=CPU,
    memory=MEMORY_MIB,
    scaledown_window=60,
)
@modal.asgi_app()
def fastapi_app() -> FastAPI:
    return web
