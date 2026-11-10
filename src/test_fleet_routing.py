"""Fake-clock tests for fleet.py reading task chains from models.yaml (issue #367).

Covers the acceptance criteria: a batch build job waits for the off-peak window and starts
when it opens, an interactive job never waits, and an identical prompt reuses the cached
review answer (zero model calls). No network, no keys, no git.

The fleet module is loaded by path inside a fixture so this file has no import-time side
effects (src/test_ci_quarantine_guard.py).
"""
from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

NOON = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
WINDOW_OPEN = datetime(2026, 11, 5, 16, 0, tzinfo=timezone.utc)
NEXT_DAY = datetime(2026, 11, 6, 16, 0, tzinfo=timezone.utc)


class _Proc:
    pid = 4242


@pytest.fixture(scope="module")
def fleet_mod():
    path = ROOT / "scripts" / "dev" / "fleet.py"
    spec = importlib.util.spec_from_file_location("fleet_routing_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _job(n, areas, **kw):
    return {"issue": n, "status": "queued", "created": float(n), "areas": areas, "lane_forced": None,
            "no_merge": False, "title": f"t{n}", "body": "b", "locked": False, "pid": None, **kw}


def test_offpeak_window_and_next_opening(fleet_mod):
    rp = fleet_mod.routing_policy
    assert rp.in_offpeak(WINDOW_OPEN)
    assert rp.in_offpeak(datetime(2026, 11, 5, 23, 59, tzinfo=timezone.utc))
    assert not rp.in_offpeak(NOON)
    assert rp.next_offpeak(NOON) == WINDOW_OPEN
    assert rp.next_offpeak(datetime(2026, 11, 5, 17, 0, tzinfo=timezone.utc)) == NEXT_DAY


def test_batch_job_is_deferred_then_starts_when_window_opens(fleet_mod, tmp_path, monkeypatch):
    store = fleet_mod.Store(tmp_path)
    started = []
    monkeypatch.setattr(fleet_mod.subprocess, "Popen", lambda cmd, **kw: started.append(cmd[-2:]) or _Proc())
    monkeypatch.setattr(fleet_mod, "alive", lambda pid: True)
    with store.txn() as d:
        d["jobs"] = {"1": _job(1, ["docs"], task="fleet")}
    f = fleet_mod.Fleet(fleet_mod.load_config(), store)
    f.tick(3, now=NOON.timestamp())
    j = store.read()["jobs"]["1"]
    assert j["status"] == "queued" and "off-peak" in j["note"]
    assert j["resume_at"] == WINDOW_OPEN.timestamp()
    f.tick(3, now=WINDOW_OPEN.timestamp())
    assert store.read()["jobs"]["1"]["status"] == "building"


def test_interactive_job_is_never_deferred(fleet_mod, tmp_path, monkeypatch):
    store = fleet_mod.Store(tmp_path)
    monkeypatch.setattr(fleet_mod.subprocess, "Popen", lambda cmd, **kw: _Proc())
    monkeypatch.setattr(fleet_mod, "alive", lambda pid: True)
    with store.txn() as d:
        d["jobs"] = {"2": _job(2, ["docs"], task="review_desk")}
    fleet_mod.Fleet(fleet_mod.load_config(), store).tick(3, now=NOON.timestamp())
    assert store.read()["jobs"]["2"]["status"] == "building"


def test_identical_prompt_reuses_cache_and_makes_zero_calls(fleet_mod, tmp_path, monkeypatch):
    store = fleet_mod.Store(tmp_path / "state")
    cache = tmp_path / "cache.json"
    cfg = fleet_mod.load_config()
    cfg["routing"] = {**cfg["routing"], "cache": True, "cache_path": str(cache)}
    f = fleet_mod.Fleet(cfg, store)

    def boom(*a, **k):
        raise AssertionError("llm_route.route must not be called on a cache hit")

    monkeypatch.setattr(fleet_mod.llm_route, "route", boom)
    prompt = "review this diff"
    fleet_mod.routing_policy.cache_put(fleet_mod.routing_policy.cache_key(prompt), '{"verdict":"pass","issues":[]}', cache)
    text, who = f.routed_review("review_desk", prompt)
    assert who == "cache" and "pass" in text


def test_review_answer_is_cached_after_one_call(fleet_mod, tmp_path, monkeypatch):
    store = fleet_mod.Store(tmp_path / "state")
    cache = tmp_path / "cache.json"
    cfg = fleet_mod.load_config()
    cfg["routing"] = {**cfg["routing"], "cache": True, "cache_path": str(cache)}
    f = fleet_mod.Fleet(cfg, store)
    calls = []

    class _Res:
        text = '{"verdict":"fail","issues":["x"]}'
        served = "openrouter/test"

    monkeypatch.setattr(fleet_mod.llm_route, "route", lambda *a, **k: calls.append(a) or _Res())
    text, who = f.routed_review("review_desk", "prompt")
    assert who == "openrouter/test" and text and calls
    text2, who2 = f.routed_review("review_desk", "prompt")
    assert who2 == "cache" and text2 == _Res.text and len(calls) == 1
