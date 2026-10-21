"""Optional read-only Qdrant Cloud replica used only when the local Qdrant is unreachable.

Inert unless QDRANT_CLOUD_URL is set. The API key (QDRANT_CLOUD_API_KEY) is read from the
environment at call time and is never logged. Spare accounts are read from QDRANT_CLOUD_URL_2..4 /
QDRANT_CLOUD_API_KEY_2..4 and are tried in order after the first cluster. Only read calls
(search / scroll / collection info) go through the targets returned here; nothing in the app
writes to the replica.

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


def _reset_for_tests() -> None:
    global _last_log_at
    _last_log_at = 0.0
