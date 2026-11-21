#!/usr/bin/env python3
"""Safe Qdrant stale collection cleanup: snapshot -> download off container -> verify -> delete.

Dry-run by default. Pass ``--apply`` to execute snapshots, downloads, verification,
and deletion. Designed for the hub to run against local Qdrant (T213).

Stale collection lists (from docs/strategy/INFRA_TARGET_2026-11-17.md):
  Phase 1 (default):
    iran_laws_v8h (copy of v6), iran_laws_v7, iran_laws_v4, iran_laws_v5,
    mistral_v1, phase1_test
  Post-T212 (opt-in via --include-post-t212):
    iran_laws_v2, iran_laws_bge_m3

Safety guards:
  - Dry-run is the default; deletion never runs without --apply.
  - Refuses to delete any protected collection (LIGHTRAG_QDRANT_COLLECTION env var
    and default protected set: iran_laws_v6, iran_laws_v7b, iran_laws_v3).
  - Never deletes a collection unless the snapshot is downloaded to --backup-dir,
    non-empty, matches Qdrant's reported byte size (and checksum when provided),
    and passes tar archive validation.
  - Never logs or prints API keys or environment secrets.

Usage:
  python3 scripts/infra/qdrant_cleanup.py
  python3 scripts/infra/qdrant_cleanup.py --apply --backup-dir /var/backups/qdrant-cleanup
  python3 scripts/infra/qdrant_cleanup.py --apply --include-post-t212 --backup-dir /var/backups/qdrant-cleanup
  python3 scripts/infra/qdrant_cleanup.py --collections v8h,v7 --apply --backup-dir /tmp/qdrant-snaps

Stdlib only, so it runs in a plain python:3.11+ environment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tarfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional
from urllib.parse import quote, urlparse

DEFAULT_LOCAL_URL = "http://127.0.0.1:6333"
DEFAULT_BACKUP_DIR = "/var/backups/roxira/qdrant-cleanup"
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
API_TIMEOUT = 60
SNAPSHOT_TIMEOUT = 1800
DOWNLOAD_CHUNK_BYTES = 1024 * 1024

# Default stale collections per T213 / INFRA_TARGET_2026-11-17.md
PHASE1_STALE_COLLECTIONS: tuple[str, ...] = (
    "iran_laws_v8h",
    "iran_laws_v7",
    "iran_laws_v4",
    "iran_laws_v5",
    "mistral_v1",
    "phase1_test",
)

# Only remove after T212 law coverage switch is completed
POST_T212_STALE_COLLECTIONS: tuple[str, ...] = (
    "iran_laws_v2",
    "iran_laws_bge_m3",
)

DEFAULT_PROTECTED_COLLECTIONS: frozenset[str] = frozenset({
    "iran_laws_v6",
    "iran_laws_v7b",
    "iran_laws_v3",
})


class CleanupError(RuntimeError):
    """Raised when a Qdrant cleanup operation fails safely."""


class NotFoundError(CleanupError):
    """Raised when a Qdrant collection does not exist (HTTP 404)."""


class Endpoint:
    """A Qdrant base URL plus optional api-key. The key is never part of repr/str."""

    def __init__(self, base: str, api_key: str = ""):
        parsed = urlparse(base)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or not parsed.hostname:
            raise CleanupError("unsupported Qdrant URL")
        self.base = base.rstrip("/")
        self._key = api_key

    def headers(self) -> dict[str, str]:
        return {"api-key": self._key} if self._key else {}

    def __repr__(self) -> str:
        return f"Endpoint({urlparse(self.base).hostname})"

    __str__ = __repr__


ApiFunc = Callable[..., Any]
DownloadFunc = Callable[[Endpoint, str, Path, float], int]


def validate_name(name: str, kind: str = "name") -> str:
    if not name or not NAME_RE.fullmatch(name) or ".." in name:
        raise CleanupError(f"invalid {kind}: {name!r}")
    return name


def _request(
    ep: Endpoint,
    method: str,
    path: str,
    body: Any = None,
    timeout: float = API_TIMEOUT,
) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", **ep.headers()}
    req = urllib.request.Request(ep.base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise NotFoundError(f"{method} {path} -> HTTP 404") from None
        raise CleanupError(f"{method} {path} -> HTTP {exc.code}") from None
    except OSError as exc:
        raise CleanupError(f"{method} {path} failed: {type(exc).__name__}") from None


def _download_file(ep: Endpoint, path: str, dest: Path, timeout: float = SNAPSHOT_TIMEOUT) -> int:
    req = urllib.request.Request(ep.base + path, method="GET", headers=ep.headers())
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest.with_suffix(dest.suffix + ".part")
    total = 0
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, tmp_path.open("wb") as fh:
            while True:
                chunk = resp.read(DOWNLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                fh.write(chunk)
                total += len(chunk)
        os.replace(tmp_path, dest)
        return total
    except urllib.error.HTTPError as exc:
        tmp_path.unlink(missing_ok=True)
        raise CleanupError(f"GET {path} -> HTTP {exc.code}") from None
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        raise CleanupError(f"GET {path} failed: {type(exc).__name__}") from None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(DOWNLOAD_CHUNK_BYTES)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def verify_snapshot_file(
    path: Path,
    *,
    expected_size: Optional[int] = None,
    expected_checksum: Optional[str] = None,
    check_tar: bool = True,
) -> dict[str, Any]:
    """Verify a downloaded Qdrant snapshot file before allowing collection deletion."""
    if not path.is_file():
        raise CleanupError(f"snapshot file missing: {path}")
    actual_size = path.stat().st_size
    if actual_size <= 0:
        raise CleanupError(f"snapshot file is empty: {path}")
    if expected_size is not None and actual_size != expected_size:
        raise CleanupError(
            f"snapshot size mismatch for {path.name}: got {actual_size} bytes, expected {expected_size}"
        )
    digest = sha256_file(path)
    if expected_checksum:
        if digest.lower() != expected_checksum.lower():
            raise CleanupError(
                f"snapshot sha256 mismatch for {path.name}: got {digest}, expected {expected_checksum}"
            )
    if check_tar:
        if not tarfile.is_tarfile(path):
            raise CleanupError(f"snapshot file is not a valid tar archive: {path.name}")
        try:
            with tarfile.open(path, "r:*") as tf:
                members = tf.getnames()
                if not members:
                    raise CleanupError(f"snapshot tar archive has no entries: {path.name}")
        except tarfile.TarError as exc:
            raise CleanupError(f"corrupt snapshot tar archive {path.name}: {exc}") from None
    return {"size_bytes": actual_size, "sha256": digest, "verified": True}


def get_protected_collections(extra: Iterable[str] = ()) -> frozenset[str]:
    protected = set(DEFAULT_PROTECTED_COLLECTIONS)
    active_env = os.environ.get("LIGHTRAG_QDRANT_COLLECTION", "").strip()
    if active_env:
        protected.add(active_env)
    for item in extra:
        cleaned = item.strip()
        if cleaned:
            protected.add(cleaned)
    return frozenset(protected)


def cleanup_collection(
    ep: Endpoint,
    collection: str,
    backup_dir: Path,
    *,
    apply: bool = False,
    protected: frozenset[str] = DEFAULT_PROTECTED_COLLECTIONS,
    api: ApiFunc = _request,
    download: DownloadFunc = _download_file,
    check_tar: bool = True,
) -> dict[str, Any]:
    """Snapshot, download off container, verify, and (if apply=True) delete one collection."""
    validate_name(collection, "collection")
    if collection in protected:
        raise CleanupError(f"refusing to delete protected collection: {collection}")

    qname = quote(collection, safe="")
    try:
        api(ep, "GET", f"/collections/{qname}")
    except NotFoundError:
        return {"collection": collection, "status": "skipped_missing"}

    count_res = api(ep, "POST", f"/collections/{qname}/points/count", {"exact": True})
    point_count = int((count_res.get("result") or {}).get("count", 0))

    if not apply:
        return {
            "collection": collection,
            "status": "dry_run",
            "points": point_count,
            "planned_steps": [
                f"POST /collections/{collection}/snapshots?wait=true",
                f"GET /collections/{collection}/snapshots/<snap> -> {backup_dir / collection}",
                "verify size, sha256, and tar archive integrity",
                f"DELETE /collections/{collection}/snapshots/<snap>?wait=true",
                f"DELETE /collections/{collection}?timeout=60",
            ],
        }

    # 1. Create snapshot on Qdrant
    snap_res = api(ep, "POST", f"/collections/{qname}/snapshots?wait=true", None, SNAPSHOT_TIMEOUT)
    snap_info = snap_res.get("result") or {}
    snap_name = validate_name(str(snap_info.get("name") or ""), "snapshot")
    expected_size = snap_info.get("size")
    expected_checksum = snap_info.get("checksum")

    # Fetch snapshot metadata list if size/checksum wasn't in creation response
    if expected_size is None:
        list_res = api(ep, "GET", f"/collections/{qname}/snapshots")
        for item in list_res.get("result") or []:
            if item.get("name") == snap_name:
                expected_size = item.get("size")
                expected_checksum = expected_checksum or item.get("checksum")
                break

    # 2. Copy snapshot off the container
    dest_dir = backup_dir / collection
    dest_path = dest_dir / snap_name
    download(ep, f"/collections/{qname}/snapshots/{quote(snap_name, safe='')}", dest_path, SNAPSHOT_TIMEOUT)

    # 3. Verify downloaded snapshot before deleting anything
    verification = verify_snapshot_file(
        dest_path,
        expected_size=int(expected_size) if expected_size is not None else None,
        expected_checksum=str(expected_checksum) if expected_checksum else None,
        check_tar=check_tar,
    )

    manifest = {
        "collection": collection,
        "points": point_count,
        "snapshot_name": snap_name,
        "local_path": str(dest_path),
        "size_bytes": verification["size_bytes"],
        "sha256": verification["sha256"],
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = dest_path.with_suffix(dest_path.suffix + ".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # 4. Delete remote snapshot inside Qdrant container, then delete the collection
    api(ep, "DELETE", f"/collections/{qname}/snapshots/{quote(snap_name, safe='')}?wait=true")
    api(ep, "DELETE", f"/collections/{qname}?timeout=60")

    return {
        "collection": collection,
        "status": "deleted",
        "points": point_count,
        "snapshot_name": snap_name,
        "backup_path": str(dest_path),
        "manifest_path": str(manifest_path),
        "size_bytes": verification["size_bytes"],
        "sha256": verification["sha256"],
    }


def resolve_target_collections(
    explicit: Optional[str],
    *,
    include_post_t212: bool = False,
) -> list[str]:
    if explicit:
        items = [c.strip() for c in explicit.split(",") if c.strip()]
        if not items:
            raise CleanupError("--collections was provided but empty")
        return items
    targets = list(PHASE1_STALE_COLLECTIONS)
    if include_post_t212:
        targets.extend(POST_T212_STALE_COLLECTIONS)
    return targets


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Snapshot, download, verify, and delete stale Qdrant collections (dry-run by default)."
    )
    p.add_argument(
        "--qdrant-url",
        default=os.environ.get("QDRANT_LOCAL_URL", DEFAULT_LOCAL_URL),
        help=f"Qdrant base URL (default: env QDRANT_LOCAL_URL or {DEFAULT_LOCAL_URL})",
    )
    p.add_argument(
        "--backup-dir",
        default=DEFAULT_BACKUP_DIR,
        help=f"Host directory to store verified snapshots off-container (default: {DEFAULT_BACKUP_DIR})",
    )
    p.add_argument(
        "--collections",
        default=None,
        help="Comma-separated list of collections to clean (overrides default T213 list)",
    )
    p.add_argument(
        "--include-post-t212",
        action="store_true",
        help="Also include post-T212 collections (iran_laws_v2, iran_laws_bge_m3)",
    )
    p.add_argument(
        "--protect",
        default="",
        help="Comma-separated extra collection names to protect from deletion",
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Actually create snapshots, download, verify, and delete collections (default: dry-run)",
    )
    p.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue processing remaining collections if one fails",
    )
    p.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Emit machine-readable JSON report",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    api_key = os.environ.get("QDRANT_LOCAL_API_KEY", "")
    ep = Endpoint(args.qdrant_url, api_key)
    backup_dir = Path(args.backup_dir)
    extra_protect = [c.strip() for c in args.protect.split(",") if c.strip()]
    protected = get_protected_collections(extra_protect)
    targets = resolve_target_collections(args.collections, include_post_t212=args.include_post_t212)

    results: list[dict[str, Any]] = []
    errors = 0

    for coll in targets:
        try:
            res = cleanup_collection(
                ep,
                coll,
                backup_dir,
                apply=args.apply,
                protected=protected,
            )
            results.append(res)
        except CleanupError as exc:
            errors += 1
            results.append({"collection": coll, "status": "error", "error": str(exc)})
            if not args.continue_on_error:
                break

    summary = {
        "mode": "apply" if args.apply else "dry_run",
        "endpoint": str(ep),
        "backup_dir": str(backup_dir),
        "results": results,
        "errors": errors,
    }

    if args.json_output:
        print(json.dumps(summary, indent=2))
    else:
        print(f"Qdrant cleanup ({summary['mode']}) on {summary['endpoint']}:")
        for r in results:
            status = r["status"]
            coll = r["collection"]
            if status == "deleted":
                print(f"  [DELETED] {coll} (points={r['points']}, backup={r['backup_path']}, sha256={r['sha256'][:12]}...)")
            elif status == "dry_run":
                print(f"  [DRY-RUN] {coll} (points={r['points']}) -> would snapshot, download to {backup_dir / coll}, verify, delete")
            elif status == "skipped_missing":
                print(f"  [SKIP]    {coll} (not found)")
            else:
                print(f"  [ERROR]   {coll}: {r.get('error')}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
