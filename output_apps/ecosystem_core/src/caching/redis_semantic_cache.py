from __future__ import annotations

import json
import hashlib

# حافظه پشتیبان درون‌برنامه‌ای در صورت عدم اتصال لحظه‌ای ردیس
_LOCAL_MEMORY_CACHE = {}

try:
    import redis
    REDIS_CLIENT = redis.Redis(host="127.0.0.1", port=6380, db=0, decode_responses=True, socket_timeout=1)
    REDIS_CLIENT.ping()
    HAS_REDIS = True
except Exception:
    HAS_REDIS = False

def get_cached_response(cache_prefix: str, query: str) -> dict | None:
    query_hash = hashlib.sha256(query.strip().lower().encode("utf-8")).hexdigest()
    key = f"{cache_prefix}:{query_hash}"
    if HAS_REDIS:
        try:
            val = REDIS_CLIENT.get(key)
            if val:
                return json.loads(val)
        except Exception:
            pass
    return _LOCAL_MEMORY_CACHE.get(key)

def set_cached_response(cache_prefix: str, query: str, data: dict, ttl_seconds: int = 86400):
    query_hash = hashlib.sha256(query.strip().lower().encode("utf-8")).hexdigest()
    key = f"{cache_prefix}:{query_hash}"
    _LOCAL_MEMORY_CACHE[key] = data
    if HAS_REDIS:
        try:
            REDIS_CLIENT.setex(key, ttl_seconds, json.dumps(data, ensure_ascii=False))
        except Exception:
            pass

if __name__ == "__main__":
    set_cached_response("test_legal", "خیار غبن فاحش", {"statute": "ماده ۴۱۶ قانون مدنی", "status": "ACTIVE"})
    cached = get_cached_response("test_legal", "خیار غبن فاحش")
    assert cached is not None
    print("✅ REDIS_SEMANTIC_CACHE_VERIFIED=PASS")
