"""Optional read-only Qdrant Cloud replica used only when the local Qdrant is unreachable.

Inert unless QDRANT_CLOUD_URL is set. The API key (QDRANT_CLOUD_API_KEY) is read from the
environment at call time and is never logged. Only read calls (search / scroll / collection
info) go through the targets returned here; nothing in the app writes to the replica.

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
LOG_INTERVAL_SECONDS = 60.0

# (label, base_url, extra_headers)
Target = Tuple[str, str, Dict[str, str]]

_last_log_at: float = 0.0
_log_lock = threading.Lock()


def cloud_target() -> Optional[Target]:
    """The cloud replica as a request target, or None when it is not configured."""
    url = os.environ.get(CLOUD_URL_ENV, "").strip().rstrip("/")
    if not url or not url.lower().startswith("https://"):
        return None  # plain http would send the api-key in clear text
    headers: Dict[str, str] = {}
    key = os.environ.get(CLOUD_KEY_ENV, "").strip()
    if key:
        headers["api-key"] = key
    return ("qdrant-cloud", url, headers)


def targets(local_hosts: Sequence[str], port: str) -> List[Target]:
    """Local candidates first (unchanged behaviour), the cloud replica appended last."""
    out: List[Target] = [(h, f"http://{h}:{port}", {}) for h in local_hosts]
    cloud = cloud_target()
    if cloud is not None:
        out.append(cloud)
    return out


def note_failover(label: str, now: Optional[float] = None) -> bool:
    """Log (at most once per minute) that a request is being served by the cloud replica.

    Returns True when a log line was emitted. Never logs URLs or keys.
    """
    global _last_log_at
    if label != "qdrant-cloud":
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
