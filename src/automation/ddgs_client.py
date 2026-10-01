"""Rate-limited, keyless fallback client for ddgs search."""

import importlib.util
import time


_sleep = time.sleep


class DdgsSearchClient:
    """Search ddgs safely; provider failures are returned, never raised."""

    def __init__(self, backend=None, min_interval_s=2.0):
        self.backend = backend
        self.min_interval_s = min_interval_s
        self._last_call = None

    @property
    def configured(self):
        return self.backend is not None or importlib.util.find_spec("ddgs") is not None

    def search(self, query, count=8):
        try:
            now = time.monotonic()
            if self._last_call is not None:
                wait = self.min_interval_s - (now - self._last_call)
                if wait > 0:
                    _sleep(wait)
            self._last_call = time.monotonic()
            if self.backend is not None:
                raw_results = self.backend(query, count)
            else:
                from ddgs import DDGS

                raw_results = DDGS().text(query, max_results=count)
            results = [
                {
                    "title": item.get("title", ""),
                    "url": item.get("href", ""),
                    "content": item.get("body", ""),
                    "score": item.get("score", 0),
                    "provider": "ddgs",
                }
                for item in raw_results[:count]
            ]
            return {"status": "SUCCESS", "provider": "ddgs", "results": results}
        except Exception as exc:
            return {
                "status": "ERROR",
                "provider": "ddgs",
                "error": str(exc),
                "results": [],
            }
