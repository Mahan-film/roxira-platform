"""Tests for Redis L2 query-embedding cache (Persian normalisation, 7d TTL, size cap)."""
from __future__ import annotations

import json

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng


class _FakeSyncRedis:
    def __init__(self) -> None:
        self.kv: dict[str, tuple[str, int | None]] = {}
        self.zsets: dict[str, dict[str, float]] = {}

    def get(self, key: str):
        item = self.kv.get(key)
        return item[0].encode("utf-8") if item else None

    def set(self, key: str, val: str, ex: int | None = None):
        self.kv[key] = (val, ex)

    def zadd(self, key: str, mapping: dict[str, float]):
        z = self.zsets.setdefault(key, {})
        z.update(mapping)

    def zcard(self, key: str) -> int:
        return len(self.zsets.get(key, {}))

    def zrange(self, key: str, start: int, stop: int):
        items = sorted(self.zsets.get(key, {}).items(), key=lambda kv: kv[1])
        end = len(items) if stop < 0 else stop + 1
        return [k.encode("utf-8") for k, _ in items[start:end]]

    def delete(self, *keys: str):
        for k in keys:
            self.kv.pop(k, None)

    def zrem(self, key: str, *members: str):
        z = self.zsets.get(key, {})
        for m in members:
            z.pop(m, None)


def test_persian_normalisation_in_embed_cache_key():
    # Arabic ي/ك and Persian digits and extra whitespace must normalise to the same key.
    k1 = eng._embed_cache_key("ماده ۱۰   قانون مدني")
    k2 = eng._embed_cache_key("ماده 10 قانون مدنی")
    assert k1 == k2


def test_redis_embed_cache_hit_ttl_and_size_cap(monkeypatch):
    fake = _FakeSyncRedis()
    monkeypatch.setattr(eng, "_embed_cache", None)
    monkeypatch.setattr(eng, "_EMBED_CACHE_MAX_ENTRIES", 2)
    eng.set_embed_redis_client(fake)
    try:
        calls = []

        def fake_http(texts):
            calls.append(list(texts))
            return [[0.1, 0.2, 0.3]]

        monkeypatch.setattr(eng, "embed_backend", lambda: "tei")
        monkeypatch.setattr(eng, "embedding_url", lambda: "http://tei.local:80")
        monkeypatch.setattr(eng, "_embed_texts_http", fake_http)

        # First call misses Redis and calls TEI; second call with Arabic ي/ك hits Redis!
        v1 = eng._embed_query_sync("چك برگشتي")
        v2 = eng._embed_query_sync("چک   برگشتی")
        assert v1 == [0.1, 0.2, 0.3]
        assert v2 == [0.1, 0.2, 0.3]
        assert len(calls) == 1

        # Verify 7-day TTL (604800 s) was passed to Redis set.
        ttls = [ex for _, ex in fake.kv.values()]
        assert all(ttl == 7 * 86400 for ttl in ttls)

        # Size cap = 2: adding two more distinct queries evicts the oldest entry.
        eng._embed_query_sync("پرسش دوم")
        eng._embed_query_sync("پرسش سوم")
        assert fake.zcard(eng._EMBED_REDIS_INDEX_KEY) == 2
        assert len(fake.kv) == 2
        assert json.loads(next(iter(fake.kv.values()))[0]) == [0.1, 0.2, 0.3]
    finally:
        eng.set_embed_redis_client(None)
