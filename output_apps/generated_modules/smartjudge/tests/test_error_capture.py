"""Unit tests for error_capture (no database, no network)."""
import asyncio

from output_apps.generated_modules.smartjudge import error_capture as ec


def _boom(n):
    raise ValueError(f"bad item {n} for a@b.com phone 09121234567")


def _exc(n):
    try:
        _boom(n)
    except ValueError as e:
        return e


def test_scrub_masks_pii_and_secrets():
    out = ec.scrub_text("a@b.com 09121234567 /x?token=abc Bearer abc.def key=SECRET " + "A" * 40)
    assert "a@b.com" not in out and "09121234567" not in out
    assert "token=abc" not in out and "SECRET" not in out and "AAAA" not in out


def test_fingerprint_stable_across_ids_and_differs_by_class():
    a = ec.build_event(_exc(1))
    b = ec.build_event(_exc(987654321))
    assert a["fingerprint"] == b["fingerprint"]
    assert ec.compute_fingerprint("KeyError", "x", "f@a.py") != ec.compute_fingerprint("ValueError", "x", "f@a.py")


def test_event_shape_truncation_and_tenant_check():
    e = ec.build_event(_exc(1), route="/api/items/42?token=zzz", method="post", tenant_id="nope")
    assert e["source"] == "ai-core" and e["http_method"] == "POST"
    assert e["route"] == "/api/items/:n"
    assert e["tenant_id"] is None
    assert len(e["sample_message"]) <= 300 and len(e["sample_stack"]) <= 2000
    assert "a@b.com" not in e["sample_message"] + e["sample_stack"]


def test_middleware_records_then_reraises(monkeypatch):
    seen = []
    monkeypatch.setattr(ec, "write_event", lambda ev: seen.append(ev))

    async def app(scope, receive, send):
        raise RuntimeError("kaboom 123456789")

    mw = ec.ErrorCaptureMiddleware(app)
    try:
        asyncio.run(mw({"type": "http", "path": "/api/x", "method": "GET"}, None, None))
        raised = False
    except RuntimeError:
        raised = True
    assert raised and len(seen) == 1 and seen[0]["error_class"] == "RuntimeError"


def test_capture_never_raises_when_db_fails(monkeypatch):
    def fail(_):
        raise OSError("db down")

    monkeypatch.setattr(ec, "write_event", fail)
    ec.capture_exception(_exc(1))  # must not raise
