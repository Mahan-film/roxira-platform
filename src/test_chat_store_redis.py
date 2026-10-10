"""Offline tests: chat store shared across workers via Redis, memory fallback. No network."""

import asyncio

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import smartjudge_module as mod


class FakeRedis:
    """Minimal redis-py subset used by chat_auth; one instance = one shared server."""

    def __init__(self):
        self.data = {}

    def ping(self):
        return True

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    def get(self, key):
        return self.data.get(key)

    def delete(self, *keys):
        for k in keys:
            self.data.pop(k, None)

    def ttl(self, key):
        return 100 if key in self.data else -2

    def expire(self, key, s):
        return True

    def pipeline(self):
        return self

    def incr(self, key):
        self.data[key] = int(self.data.get(key, 0)) + 1
        return self

    def execute(self):
        return [int(next(iter(self.data.values()))), 100]


def _as_worker(server):
    """Simulate a fresh worker process: empty memory, own client onto the shared server."""
    chat_auth.reset_for_tests()
    chat_auth.set_redis_client(server)


def test_idem_result_visible_to_other_worker():
    server = FakeRedis()
    _as_worker(server)
    res_key, _ = chat_auth.idem_keys("3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23", "ip:1.2.3.4", "hi")
    chat_auth.idem_store(res_key, {"status": "SUCCESS", "reply": "x"})
    _as_worker(server)  # second worker: memory wiped, same Redis
    assert chat_auth.idem_get(res_key) == {"status": "SUCCESS", "reply": "x"}


def test_otp_store_and_verify_on_different_workers():
    server = FakeRedis()
    _as_worker(server)
    mod._otp_store("09120000011", "123456")
    _as_worker(server)
    assert chat_auth.kv_get("otp:code:09120000011") is not None


def test_unreachable_redis_falls_back_to_memory(monkeypatch):
    chat_auth.reset_for_tests()
    chat_auth._redis_checked = False
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setattr(chat_auth, "_backend_logged", False)
    assert chat_auth.store_backend() == "memory"
    chat_auth.kv_set("k", {"a": 1}, 10)
    assert chat_auth.kv_get("k") == {"a": 1}


def test_health_exposes_backend():
    chat_auth.reset_for_tests()
    assert asyncio.run(mod.health_check())["chat_store"] == "memory"
    chat_auth.set_redis_client(FakeRedis())
    assert asyncio.run(mod.health_check())["chat_store"] == "redis"
