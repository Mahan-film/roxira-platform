"""Unit tests for scripts/infra/qdrant_cleanup.py (T213)."""
from __future__ import annotations

import hashlib
import io
import json
import tarfile
from pathlib import Path
from typing import Any

import pytest

from scripts.infra import qdrant_cleanup as qc


def _make_valid_snapshot_bytes(payload: bytes = b"qdrant-segment-data") -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        info = tarfile.TarInfo(name="0/segments/seg.dat")
        info.size = len(payload)
        tf.addfile(info, io.BytesIO(payload))
    return buf.getvalue()


def test_dry_run_is_default_and_never_mutates(tmp_path: Path) -> None:
    calls: list[tuple[str, str]] = []

    def fake_api(ep: qc.Endpoint, method: str, path: str, body: Any = None, timeout: float = 60) -> Any:
        calls.append((method, path))
        if method == "GET" and path == "/collections/iran_laws_v7":
            return {"result": {"status": "green"}}
        if method == "POST" and path == "/collections/iran_laws_v7/points/count":
            return {"result": {"count": 1234}}
        raise AssertionError(f"unexpected call in dry-run: {method} {path}")

    def fail_download(*_args: Any, **_kwargs: Any) -> int:
        raise AssertionError("download must not run in dry-run")

    ep = qc.Endpoint("http://127.0.0.1:6333", "secret-token-never-logged")
    res = qc.cleanup_collection(ep, "iran_laws_v7", tmp_path, apply=False, api=fake_api, download=fail_download)

    assert res["status"] == "dry_run"
    assert res["points"] == 1234
    assert calls == [
        ("GET", "/collections/iran_laws_v7"),
        ("POST", "/collections/iran_laws_v7/points/count"),
    ]
    assert "secret-token-never-logged" not in repr(ep)
    assert "secret-token-never-logged" not in str(ep)


def test_apply_snapshots_downloads_verifies_then_deletes(tmp_path: Path) -> None:
    snap_bytes = _make_valid_snapshot_bytes()
    snap_sha = hashlib.sha256(snap_bytes).hexdigest()
    snap_name = "iran_laws_v8h-2026-11-21.snapshot"
    calls: list[tuple[str, str]] = []

    def fake_api(ep: qc.Endpoint, method: str, path: str, body: Any = None, timeout: float = 60) -> Any:
        calls.append((method, path))
        if method == "GET" and path == "/collections/iran_laws_v8h":
            return {"result": {"status": "green"}}
        if method == "POST" and path == "/collections/iran_laws_v8h/points/count":
            return {"result": {"count": 500}}
        if method == "POST" and path == "/collections/iran_laws_v8h/snapshots?wait=true":
            return {"result": {"name": snap_name, "size": len(snap_bytes), "checksum": snap_sha}}
        if method == "DELETE" and path == f"/collections/iran_laws_v8h/snapshots/{snap_name}?wait=true":
            return {"result": True}
        if method == "DELETE" and path == "/collections/iran_laws_v8h?timeout=60":
            return {"result": True}
        raise AssertionError(f"unexpected call: {method} {path}")

    def fake_download(ep: qc.Endpoint, path: str, dest: Path, timeout: float) -> int:
        assert path == f"/collections/iran_laws_v8h/snapshots/{snap_name}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(snap_bytes)
        return len(snap_bytes)

    ep = qc.Endpoint("http://127.0.0.1:6333")
    res = qc.cleanup_collection(ep, "iran_laws_v8h", tmp_path, apply=True, api=fake_api, download=fake_download)

    assert res["status"] == "deleted"
    assert res["points"] == 500
    assert res["sha256"] == snap_sha
    assert Path(res["backup_path"]).is_file()
    manifest = json.loads(Path(res["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["collection"] == "iran_laws_v8h"
    assert manifest["sha256"] == snap_sha
    assert calls[-2:] == [
        ("DELETE", f"/collections/iran_laws_v8h/snapshots/{snap_name}?wait=true"),
        ("DELETE", "/collections/iran_laws_v8h?timeout=60"),
    ]


def test_corrupt_snapshot_aborts_before_delete(tmp_path: Path) -> None:
    snap_name = "iran_laws_v4-bad.snapshot"
    deleted = False

    def fake_api(ep: qc.Endpoint, method: str, path: str, body: Any = None, timeout: float = 60) -> Any:
        nonlocal deleted
        if method == "DELETE":
            deleted = True
        if method == "GET" and path == "/collections/iran_laws_v4":
            return {"result": {"status": "green"}}
        if method == "POST" and path.endswith("/points/count"):
            return {"result": {"count": 10}}
        if method == "POST" and path.endswith("/snapshots?wait=true"):
            return {"result": {"name": snap_name, "size": 100}}
        return {}

    def fake_download(ep: qc.Endpoint, path: str, dest: Path, timeout: float) -> int:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"not-a-tar-and-wrong-size")
        return 24

    ep = qc.Endpoint("http://127.0.0.1:6333")
    with pytest.raises(qc.CleanupError, match="size mismatch"):
        qc.cleanup_collection(ep, "iran_laws_v4", tmp_path, apply=True, api=fake_api, download=fake_download)

    assert deleted is False


def test_protected_collection_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LIGHTRAG_QDRANT_COLLECTION", "iran_laws_v6")
    protected = qc.get_protected_collections()
    ep = qc.Endpoint("http://127.0.0.1:6333")

    with pytest.raises(qc.CleanupError, match="protected collection"):
        qc.cleanup_collection(ep, "iran_laws_v6", tmp_path, apply=True, protected=protected)


def test_missing_collection_is_skipped(tmp_path: Path) -> None:
    def fake_api(ep: qc.Endpoint, method: str, path: str, body: Any = None, timeout: float = 60) -> Any:
        raise qc.NotFoundError("HTTP 404")

    ep = qc.Endpoint("http://127.0.0.1:6333")
    res = qc.cleanup_collection(ep, "phase1_test", tmp_path, apply=True, api=fake_api)
    assert res == {"collection": "phase1_test", "status": "skipped_missing"}


def test_resolve_target_collections_phases() -> None:
    p1 = qc.resolve_target_collections(None, include_post_t212=False)
    assert p1 == list(qc.PHASE1_STALE_COLLECTIONS)
    assert "iran_laws_v2" not in p1

    both = qc.resolve_target_collections(None, include_post_t212=True)
    assert "iran_laws_v2" in both
    assert "iran_laws_bge_m3" in both

    custom = qc.resolve_target_collections("v8h, phase1_test")
    assert custom == ["v8h", "phase1_test"]
