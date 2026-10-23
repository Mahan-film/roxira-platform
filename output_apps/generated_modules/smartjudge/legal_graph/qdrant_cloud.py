"""Optional read-only Qdrant Cloud replica used only when the local Qdrant is unreachable.

Inert unless QDRANT_CLOUD_URL is set. The API key (QDRANT_CLOUD_API_KEY) is read from the
environment at call time and is never logged. Spare accounts are read from QDRANT_CLOUD_URL_2..4 /
QDRANT_CLOUD_API_KEY_2..4 and are tried in order after the first cluster: on a connection error
or a non-200 answer (401, 404 collection missing, 429, 5xx) the read moves on to the next cluster.
Only read calls (search / scroll / collection info) go through the targets returned here; nothing
in the app writes to the replica.

Health per cluster: every read records its outcome (``record`` / ``skip_cloud_response``) and
``cloud_health()`` reports, per label, the last success / failure and the failure streak, without
URL or key. ``probe_clusters()`` actively checks each cluster (GET /collections) on demand.

Pure stdlib, no imports from the rest of the package (no circular imports).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger("smartjudge.qdrant_cloud")

CLOUD_URL_ENV = "QDRANT_CLOUD_URL"
CLOUD_KEY_ENV = "QDRANT_CLOUD_API_KEY"
MAX_CLOUD_CLUSTERS = 4
LOG_INTERVAL_SECONDS = 60.0

# (label, base_url, extra_headers)
Target = Tuple[str, str, Dict[str, str]]

_last_log_at: float = 0.0
_log_lock = threading.Lock()

# label -> {"ok_at", "fail_at", "error", "streak", "requests"} (monotonic times, no URL, no key)
_health: Dict[str, Dict[str, object]] = {}
_health_lock = threading.Lock()
PROBE_TIMEOUT_SECONDS = 3.0


def _env_names(index: int) -> Tuple[str, str]:
    if index == 1:
        return CLOUD_URL_ENV, CLOUD_KEY_ENV
    return f"{CLOUD_URL_ENV}_{index}", f"{CLOUD_KEY_ENV}_{index}"


def _cloud_target(index: int) -> Optional[Target]:
    url_env, key_env = _env_names(index)
    url = os.environ.get(url_env, "").strip().rstrip("/")
    if not url or not url.lower().startswith("https://"):
        return None  # plain http would send the api-key in clear text
    headers: Dict[str, str] = {}
    key = os.environ.get(key_env, "").strip()
    if key:
        headers["api-key"] = key
    label = "qdrant-cloud" if index == 1 else f"qdrant-cloud-{index}"
    return (label, url, headers)


def cloud_target() -> Optional[Target]:
    """The first configured cloud replica as a request target, or None when it is not set."""
    return _cloud_target(1)


def cloud_targets() -> List[Target]:
    """Every configured cloud replica, in order (base, then _2.._4). Missing ones are skipped."""
    out: List[Target] = []
    for index in range(1, MAX_CLOUD_CLUSTERS + 1):
        target = _cloud_target(index)
        if target is not None:
            out.append(target)
    return out


def targets(local_hosts: Sequence[str], port: str) -> List[Target]:
    """Local candidates first (unchanged behaviour), the configured cloud replicas appended last."""
    out: List[Target] = [(h, f"http://{h}:{port}", {}) for h in local_hosts]
    out.extend(cloud_targets())
    return out


def note_failover(label: str, now: Optional[float] = None) -> bool:
    """Log (at most once per minute) that a request is being served by a cloud replica.

    Returns True when a log line was emitted. Never logs URLs or keys. All cloud clusters share
    the one-per-minute throttle; local hosts never log.
    """
    global _last_log_at
    if not label.startswith("qdrant-cloud"):
        return False
    t = time.monotonic() if now is None else now
    with _log_lock:
        if _last_log_at and (t - _last_log_at) < LOG_INTERVAL_SECONDS:
            return False
        _last_log_at = t
    logger.warning("local Qdrant unreachable; serving reads from the Qdrant Cloud replica")
    return True


def is_cloud(label: str) -> bool:
    return label.startswith("qdrant-cloud")


def record(label: str, ok: bool, error: str = "", now: Optional[float] = None) -> None:
    """Remember one read outcome for a cloud cluster (local hosts are ignored)."""
    if not is_cloud(label):
        return
    t = time.monotonic() if now is None else now
    with _health_lock:
        row = _health.setdefault(label, {"ok_at": None, "fail_at": None, "error": "", "streak": 0, "requests": 0})
        row["requests"] = int(row["requests"]) + 1  # type: ignore[call-overload]
        if ok:
            row["ok_at"], row["streak"], row["error"] = t, 0, ""
        else:
            row["fail_at"], row["error"] = t, error[:80]
            row["streak"] = int(row["streak"]) + 1  # type: ignore[call-overload]
        first_failure = not ok and row["streak"] == 1
    if first_failure:  # once per failure streak, not per request
        logger.warning("Qdrant Cloud cluster %s failed: %s", label, error[:80])


def skip_cloud_response(label: str, status: int) -> bool:
    """Record a cloud cluster's HTTP answer; True when it failed and the next target should be tried.

    Local hosts always return False, so their behaviour (a non-200 ends the read) is unchanged.
    """
    if not is_cloud(label):
        return False
    ok = status == 200
    record(label, ok, "" if ok else f"HTTP {status}")
    return not ok


def cloud_health(now: Optional[float] = None) -> List[Dict[str, object]]:
    """One row per configured cluster: ``status`` is ok / failing / unused. No URL, no key."""
    t = time.monotonic() if now is None else now
    rows: List[Dict[str, object]] = []
    for label, _url, headers in cloud_targets():
        with _health_lock:
            row = dict(_health.get(label) or {})
        ok_at, fail_at = row.get("ok_at"), row.get("fail_at")
        if ok_at is None and fail_at is None:
            status = "unused"
        elif fail_at is not None and (ok_at is None or fail_at > ok_at):  # type: ignore[operator]
            status = "failing"
        else:
            status = "ok"
        rows.append({
            "label": label,
            "api_key_set": bool(headers.get("api-key")),
            "status": status,
            "last_ok_age_seconds": round(t - ok_at, 1) if ok_at is not None else None,  # type: ignore[operator]
            "last_failure_age_seconds": round(t - fail_at, 1) if fail_at is not None else None,  # type: ignore[operator]
            "last_error": row.get("error") or "",
            "failure_streak": row.get("streak") or 0,
            "requests": row.get("requests") or 0,
        })
    return rows


def probe_clusters(timeout: float = PROBE_TIMEOUT_SECONDS) -> List[Dict[str, object]]:
    """Actively check every configured cluster (GET /collections, read-only) and return ``cloud_health()``.

    Network I/O: call it from an admin/ops path or a worker thread, not per user request.
    """
    import urllib.error
    import urllib.request

    for label, url, headers in cloud_targets():
        request = urllib.request.Request(f"{url}/collections", headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = int(getattr(response, "status", 200) or 200)
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
        except Exception as exc:  # noqa: BLE001
            record(label, False, type(exc).__name__)
            continue
        skip_cloud_response(label, status)
    return cloud_health()


def _reset_for_tests() -> None:
    global _last_log_at
    _last_log_at = 0.0
    with _health_lock:
        _health.clear()
