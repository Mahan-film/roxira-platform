#!/usr/bin/env python3
"""Nightly hot replica: local Qdrant snapshot -> Qdrant Cloud, then verify.

Optional and inert: without QDRANT_CLOUD_URL it prints "inert" and exits 0.

Env (secrets come from the server .env only, never from code):
  QDRANT_CLOUD_URL            https://<cluster>.cloud.qdrant.io:6333   (https required)
  QDRANT_CLOUD_API_KEY        cloud api key (sent as the `api-key` header, never logged)
  QDRANT_LOCAL_URL            default http://roxira_qdrant_prod:6333  (host run: http://127.0.0.1:6333)
  QDRANT_LOCAL_API_KEY        optional, if the local Qdrant uses one
  QDRANT_REPLICA_COLLECTIONS  comma list; default LIGHTRAG_QDRANT_COLLECTION, else iran_laws_v3
  QDRANT_REPLICA_SAMPLES      sample vectors for the search check (default 20)

Flow per collection: create snapshot on local -> stream-download -> upload to the cloud
(`/snapshots/upload?priority=snapshot`, replaces the cloud collection) -> delete the local
snapshot -> verify exact point counts equal and that top-5 ids of SAMPLES stored vectors match
between local and cloud. Exit 0 only when every collection verifies.

Usage:
  python3 scripts/infra/qdrant_replica.py --dry-run     # read-only: shows plan + local counts
  python3 scripts/infra/qdrant_replica.py --apply
  python3 scripts/infra/qdrant_replica.py --verify-only
Stdlib only, so it runs in a plain python:3.12-slim container.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote, urlparse

DEFAULT_LOCAL = "http://roxira_qdrant_prod:6333"
DEFAULT_COLLECTION = "iran_laws_v3"
NAME_RE = re.compile(r"[A-Za-z0-9_.-]+")
SNAPSHOT_TIMEOUT = 1800
API_TIMEOUT = 60


class ReplicaError(RuntimeError):
    pass


class Endpoint:
    """A Qdrant base URL plus optional api-key. The key is never part of repr/str."""

    def __init__(self, base: str, api_key: str = "", *, require_https: bool = False):
        parsed = urlparse(base)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or not parsed.hostname:
            raise ReplicaError("unsupported Qdrant URL")
        if require_https and parsed.scheme != "https":
            raise ReplicaError("cloud URL must be https (the api-key would travel in clear text)")
        self.base = base.rstrip("/")
        self._key = api_key

    def headers(self) -> dict[str, str]:
        return {"api-key": self._key} if self._key else {}

    def __repr__(self) -> str:
        return f"Endpoint({urlparse(self.base).hostname})"


def _request(ep: Endpoint, method: str, path: str, body: Any = None, timeout: float = API_TIMEOUT) -> Any:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json", **ep.headers()}
    req = urllib.request.Request(ep.base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        raise ReplicaError(f"{method} {path} -> HTTP {exc.code}") from None
    except OSError as exc:
        raise ReplicaError(f"{method} {path} failed: {type(exc).__name__}") from None


# Indirection so tests can swap the whole transport.
Api = Callable[..., Any]


def count_points(api: Api, ep: Endpoint, coll: str) -> int:
    res = api(ep, "POST", f"/collections/{quote(coll, safe='')}/points/count", {"exact": True})
    return int(res["result"]["count"])


def sample_points(api: Api, ep: Endpoint, coll: str, n: int) -> list[dict]:
    res = api(ep, "POST", f"/collections/{quote(coll, safe='')}/points/scroll",
              {"limit": n, "with_payload": False, "with_vector": True})
    pts = res["result"]["points"]
    return [p for p in pts if isinstance(p.get("vector"), list)]


def top_ids(api: Api, ep: Endpoint, coll: str, vector: list[float], k: int = 5) -> list[str]:
    res = api(ep, "POST", f"/collections/{quote(coll, safe='')}/points/search",
              {"vector": vector, "limit": k, "with_payload": False})
    return [str(p["id"]) for p in res["result"]]


def verify(api: Api, local: Endpoint, cloud: Endpoint, coll: str, samples: int) -> dict:
    lc, cc = count_points(api, local, coll), count_points(api, cloud, coll)
    report = {"collection": coll, "local_count": lc, "cloud_count": cc, "count_ok": lc == cc,
              "samples": 0, "sample_mismatches": 0}
    if lc != cc:
        report["ok"] = False
        return report
    pts = sample_points(api, local, coll, samples)
    for p in pts:
        report["samples"] += 1
        if top_ids(api, local, coll, p["vector"]) != top_ids(api, cloud, coll, p["vector"]):
            report["sample_mismatches"] += 1
    report["ok"] = report["sample_mismatches"] == 0 and (report["samples"] > 0 or lc == 0)
    return report


# ---- snapshot transfer (streams to disk; collections can be hundreds of MB) -----------------

def download_snapshot(local: Endpoint, coll: str, name: str, dest: Path) -> int:
    path = f"/collections/{quote(coll, safe='')}/snapshots/{quote(name, safe='')}"
    req = urllib.request.Request(local.base + path, headers=local.headers())
    try:
        with urllib.request.urlopen(req, timeout=SNAPSHOT_TIMEOUT) as resp, dest.open("wb") as fh:
            shutil.copyfileobj(resp, fh, 1024 * 1024)
    except (OSError, urllib.error.HTTPError) as exc:
        raise ReplicaError(f"snapshot download failed: {type(exc).__name__}") from None
    return dest.stat().st_size


class _MultipartFile:
    """File-like body: multipart preamble + file + epilogue, with a known Content-Length."""

    def __init__(self, file_path: Path, boundary: str):
        self._pre = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"snapshot\"; "
                     f"filename=\"{file_path.name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode()
        self._post = f"\r\n--{boundary}--\r\n".encode()
        self._fh = file_path.open("rb")
        self.length = len(self._pre) + file_path.stat().st_size + len(self._post)
        self._stage = 0

    def read(self, n: int = -1) -> bytes:
        if self._stage == 0:
            self._stage = 1
            return self._pre
        if self._stage == 1:
            chunk = self._fh.read(1024 * 1024 if n is None or n < 0 else n)
            if chunk:
                return chunk
            self._stage = 2
        if self._stage == 2:
            self._stage = 3
            return self._post
        return b""

    def close(self) -> None:
        self._fh.close()


def upload_snapshot(cloud: Endpoint, coll: str, file_path: Path) -> None:
    boundary = "rx" + secrets.token_hex(12)
    body = _MultipartFile(file_path, boundary)
    path = f"/collections/{quote(coll, safe='')}/snapshots/upload?priority=snapshot&wait=true"
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}",
               "Content-Length": str(body.length), **cloud.headers()}
    req = urllib.request.Request(cloud.base + path, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=SNAPSHOT_TIMEOUT) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        raise ReplicaError(f"snapshot upload -> HTTP {exc.code}") from None
    except OSError as exc:
        raise ReplicaError(f"snapshot upload failed: {type(exc).__name__}") from None
    finally:
        body.close()


def replicate(api: Api, local: Endpoint, cloud: Endpoint, coll: str, samples: int,
              tmpdir: Path, *, download=download_snapshot, upload=upload_snapshot) -> dict:
    cpath = quote(coll, safe="")
    snap = api(local, "POST", f"/collections/{cpath}/snapshots?wait=true", None, SNAPSHOT_TIMEOUT)
    name = snap["result"]["name"]
    file_path = tmpdir / name
    try:
        size = download(local, coll, name, file_path)
        upload(cloud, coll, file_path)
    finally:
        file_path.unlink(missing_ok=True)
        try:
            api(local, "DELETE", f"/collections/{cpath}/snapshots/{quote(name, safe='')}?wait=true")
        except ReplicaError as exc:
            print(f"warn: could not delete local snapshot: {exc}", file=sys.stderr)
    report = verify(api, local, cloud, coll, samples)
    report["snapshot_bytes"] = size
    return report


def collections_from_env(env: dict[str, str]) -> list[str]:
    raw = env.get("QDRANT_REPLICA_COLLECTIONS") or env.get("LIGHTRAG_QDRANT_COLLECTION") or DEFAULT_COLLECTION
    names = [c.strip() for c in raw.split(",") if c.strip()]
    for c in names:
        if not NAME_RE.fullmatch(c):
            raise ReplicaError(f"invalid collection name {c!r}")
    return names


def main(argv: Optional[list[str]] = None, env: Optional[dict[str, str]] = None, api: Api = _request) -> int:
    env = dict(os.environ) if env is None else env
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="read-only plan (default when no mode is given)")
    mode.add_argument("--apply", action="store_true", help="snapshot, upload, verify")
    mode.add_argument("--verify-only", action="store_true", help="only compare counts + sample searches")
    args = ap.parse_args(argv)

    cloud_url = env.get("QDRANT_CLOUD_URL", "").strip()
    if not cloud_url:
        print("qdrant_replica: inert (QDRANT_CLOUD_URL not set)")
        return 0
    try:
        cloud = Endpoint(cloud_url, env.get("QDRANT_CLOUD_API_KEY", "").strip(), require_https=True)
        local = Endpoint(env.get("QDRANT_LOCAL_URL", DEFAULT_LOCAL), env.get("QDRANT_LOCAL_API_KEY", "").strip())
        colls = collections_from_env(env)
        samples = int(env.get("QDRANT_REPLICA_SAMPLES", "20"))
    except (ReplicaError, ValueError) as exc:
        print(f"qdrant_replica: config error: {exc}", file=sys.stderr)
        return 2

    ok = True
    try:
        if not (args.apply or args.verify_only):
            for c in colls:
                print(f"[dry-run] would snapshot {c} (local points: {count_points(api, local, c)}) -> {cloud!r}")
            print("[dry-run] nothing written; re-run with --apply")
            return 0
        with tempfile.TemporaryDirectory(prefix="qdrant_replica_") as td:
            for c in colls:
                rep = (verify(api, local, cloud, c, samples) if args.verify_only
                       else replicate(api, local, cloud, c, samples, Path(td)))
                print(json.dumps(rep, sort_keys=True))
                ok = ok and bool(rep.get("ok"))
    except ReplicaError as exc:
        print(f"qdrant_replica: FAILED: {exc}", file=sys.stderr)
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
