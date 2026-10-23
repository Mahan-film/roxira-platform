"""Thread-safety of the in-process chat_auth store and event-loop safety of the async handlers. Offline."""

import asyncio
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

BASE = "/api/v1/apps/judge"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    chat_auth.reset_for_tests()
    yield
    chat_auth.reset_for_tests()


def test_inprocess_store_survives_20_threads_hammering():
    errors: list = []
    incr_calls = [0] * 20
    nx_wins = []
    stop = time.monotonic() + 1.0
    # make pruning scan constantly instead of only above 20000 keys
    barrier = threading.Barrier(20)

    def worker(n: int) -> None:
        try:
            barrier.wait()
            i = 0
            while time.monotonic() < stop:
                chat_auth.incr("shared-counter", 3600)
                incr_calls[n] += 1
                if chat_auth.set_nx(f"nx:{i % 50}", 3600):
                    nx_wins.append(f"nx:{i % 50}")
                chat_auth.kv_set(f"kv:{n}:{i % 200}", {"n": n, "i": i}, 3600)
                chat_auth.kv_get(f"kv:{n}:{i % 200}")
                chat_auth.ttl("shared-counter")
                chat_auth._mem_prune()
                chat_auth.idem_store(f"idem:{n}:{i}", {"ok": True})
                if i % 7 == 0:
                    chat_auth.kv_delete(f"kv:{n}:{i % 200}")
                i += 1
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(repr(exc))

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert not errors, errors[:3]
    assert chat_auth._mem["shared-counter"][0] == sum(incr_calls)
    assert len(nx_wins) == len(set(nx_wins)) == 50  # each set_nx key won exactly once
    assert len(chat_auth._idem_keys) <= chat_auth.IDEM_MAX_ENTRIES


def test_prune_does_not_break_on_concurrent_mutation(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(chat_auth, "_now", lambda: clock["t"])
    for i in range(20050):
        chat_auth._mem[f"k{i}"] = ["1", 1500.0]
    errors = []

    def writer():
        try:
            for i in range(3000):
                chat_auth.kv_set(f"w{i}", 1, 3600)
        except Exception as exc:  # pragma: no cover
            errors.append(repr(exc))

    t = threading.Thread(target=writer)
    t.start()
    clock["t"] = 2000.0  # everything seeded is now expired
    for _ in range(20):
        chat_auth._mem_prune()
    t.join(timeout=30)
    assert not errors


class _SlowStore:
    """Replaces the blocking store primitives with ones that sleep (like a stalled Redis)."""

    def __init__(self, monkeypatch, delay=0.4):
        self.threads = set()
        self.delay = delay
        monkeypatch.setattr(chat_auth, "incr", self._wrap(chat_auth.incr))
        monkeypatch.setattr(chat_auth, "set_nx", self._wrap(chat_auth.set_nx))
        monkeypatch.setattr(chat_auth, "kv_get", self._wrap(chat_auth.kv_get))
        monkeypatch.setattr(chat_auth, "kv_set", self._wrap(chat_auth.kv_set))
        monkeypatch.setattr(chat_auth, "kv_delete", self._wrap(chat_auth.kv_delete))
        monkeypatch.setattr(chat_auth, "ttl", self._wrap(chat_auth.ttl))

    def _wrap(self, fn):
        def inner(*a, **k):
            self.threads.add(threading.current_thread())
            time.sleep(self.delay)
            return fn(*a, **k)
        return inner


def test_async_helpers_run_store_off_the_event_loop(monkeypatch):
    store = _SlowStore(monkeypatch)
    main_thread = threading.current_thread()

    async def scenario():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        task = asyncio.create_task(ticker())
        await asyncio.gather(
            chat_auth.acheck_limit("s", "k", 5),
            chat_auth.aset_nx("a", 10),
            chat_auth.akv_get("b"),
            chat_auth.aincr("c", 10),
        )
        task.cancel()
        return ticks

    ticks = asyncio.run(scenario())
    assert main_thread not in store.threads
    assert ticks >= 8  # loop kept turning while the 0.4s store calls ran in parallel


def test_otp_handlers_do_not_block_event_loop(monkeypatch):
    store = _SlowStore(monkeypatch, delay=0.3)
    monkeypatch.setattr(mod, "normalize_phone", lambda p: p)
    monkeypatch.setattr(mod, "_is_valid_phone", lambda p: True)
    main_thread = threading.current_thread()
    app = FastAPI()
    app.include_router(mod.router)

    class Req:
        headers = {}
        client = None

    async def scenario():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        task = asyncio.create_task(ticker())
        resp = await mod.verify_auth_otp({"phone": "09120000033", "code": "123456"}, Req())
        task.cancel()
        return resp, ticks

    resp, ticks = asyncio.run(scenario())
    assert resp.status_code == 400  # no code was issued
    assert main_thread not in store.threads
    assert ticks >= 5  # >= 2 sequential 0.3s store calls, loop ticking throughout


def test_conversation_messages_db_calls_are_offloaded(monkeypatch):
    seen = []
    main_thread = threading.current_thread()

    def fake_owned(conv_id, phone):
        seen.append(threading.current_thread())
        time.sleep(0.2)
        return False

    monkeypatch.setattr(mod, "_conversation_owned_by", fake_owned)
    user = chat_auth.CurrentUser(phone="09120000044", tier="FREE", authenticated=True)

    async def scenario():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        task = asyncio.create_task(ticker())
        resp = await mod.get_conversation_messages("11111111-1111-4111-8111-111111111111", user)
        task.cancel()
        return resp, ticks

    resp, ticks = asyncio.run(scenario())
    assert resp.status_code == 404
    assert seen and main_thread not in seen
    assert ticks >= 5
