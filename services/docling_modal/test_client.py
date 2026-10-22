"""Offline tests for services/docling_modal/client.py (no network to Modal).

A local http.server stands in for the Modal endpoint. Run only this file:
    python3 -m pytest services/docling_modal/test_client.py -q
"""
from __future__ import annotations

import importlib.util
import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

_CLIENT_PATH = Path(__file__).resolve().parent / "client.py"
_spec = importlib.util.spec_from_file_location("docling_modal_client", _CLIENT_PATH)
assert _spec and _spec.loader
cli = importlib.util.module_from_spec(_spec)
sys.modules["docling_modal_client"] = cli
_spec.loader.exec_module(cli)

_DEFAULT_PAYLOAD = {"markdown": "# hi", "tables": [["a", "b"]], "pages": 1}


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        state = self.server.state
        state["count"] += 1
        length = int(self.headers.get("Content-Length", "0"))
        state["body"] = self.rfile.read(length)
        state["token"] = self.headers.get("X-Docling-Token")
        state["content_type"] = self.headers.get("Content-Type")

        if state.get("fail_first") and state["count"] == 1:
            self.connection.close()
            return

        if state["expected_token"] and state["token"] != state["expected_token"]:
            self._json(401, {"error": "unauthorized"})
            return

        self._json(state.get("status", 200), state.get("payload", _DEFAULT_PAYLOAD))

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args) -> None:
        pass


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, state: dict) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.state = state

    def handle_error(self, request, client_address) -> None:
        pass


@pytest.fixture
def fake_server():
    state = {
        "count": 0,
        "expected_token": "s3cret",
        "status": 200,
        "payload": _DEFAULT_PAYLOAD,
    }
    server = _Server(state)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield base, state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def sample_pdf(tmp_path):
    path = tmp_path / "contract.pdf"
    path.write_bytes(b"%PDF-1.4\nfake body\n")
    return path


def test_extract_happy_path(fake_server, sample_pdf):
    base, state = fake_server
    result = cli.extract(sample_pdf, url=base, token="s3cret")

    assert result == _DEFAULT_PAYLOAD
    assert state["count"] == 1
    assert state["token"] == "s3cret"
    assert state["content_type"].startswith("multipart/form-data; boundary=")
    assert b'filename="contract.pdf"' in state["body"]
    assert b"%PDF-1.4" in state["body"]


def test_extract_reads_environment(monkeypatch, fake_server, sample_pdf):
    base, _ = fake_server
    monkeypatch.setenv(cli.ENV_URL, base)
    monkeypatch.setenv(cli.ENV_TOKEN, "s3cret")

    assert cli.extract(sample_pdf)["pages"] == 1


def test_extract_missing_config(sample_pdf, monkeypatch):
    monkeypatch.delenv(cli.ENV_URL, raising=False)
    monkeypatch.delenv(cli.ENV_TOKEN, raising=False)

    with pytest.raises(cli.DoclingConfigError):
        cli.extract(sample_pdf)
    with pytest.raises(cli.DoclingConfigError):
        cli.extract(sample_pdf, url="http://127.0.0.1:1")


def test_extract_bad_token_raises_auth_error(fake_server, sample_pdf):
    base, _ = fake_server
    with pytest.raises(cli.DoclingAuthError):
        cli.extract(sample_pdf, url=base, token="wrong")


def test_extract_http_error_raises_request_error(fake_server, sample_pdf):
    base, state = fake_server
    state["status"] = 413
    with pytest.raises(cli.DoclingRequestError):
        cli.extract(sample_pdf, url=base, token="s3cret")


def test_extract_retries_once_on_transport_failure(fake_server, sample_pdf):
    base, state = fake_server
    state["fail_first"] = True

    result = cli.extract(sample_pdf, url=base, token="s3cret")

    assert result["pages"] == 1
    assert state["count"] == 2


def test_extract_transport_error_after_retry(sample_pdf):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    with pytest.raises(cli.DoclingTransportError):
        cli.extract(sample_pdf, url=f"http://127.0.0.1:{port}", token="s3cret", timeout=1.0)
