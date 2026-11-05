"""Fake-clock tests for routing_policy.py: off-peak window and prompt cache (issue #367)."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "output_apps" / "generated_modules" / "smartjudge"))

import routing_policy  # noqa: E402


def test_window_is_1600_to_0000_utc():
    assert routing_policy.in_offpeak(datetime(2026, 11, 5, 16, 0, tzinfo=timezone.utc))
    assert routing_policy.in_offpeak(datetime(2026, 11, 5, 23, 59, tzinfo=timezone.utc))
    assert not routing_policy.in_offpeak(datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc))
    assert not routing_policy.in_offpeak(datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc))  # 03:30 Tehran closes it


def test_should_defer_before_the_window_only():
    assert routing_policy.should_defer(datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc))
    assert not routing_policy.should_defer(datetime(2026, 11, 5, 16, 0, tzinfo=timezone.utc))


def test_next_offpeak_is_1600_utc_same_day_before_it_opens():
    nxt = routing_policy.next_offpeak(datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc))
    assert nxt == datetime(2026, 11, 5, 16, 0, tzinfo=timezone.utc)


def test_next_offpeak_rolls_to_the_next_day_once_open():
    nxt = routing_policy.next_offpeak(datetime(2026, 11, 5, 17, 0, tzinfo=timezone.utc))
    assert nxt == datetime(2026, 11, 6, 16, 0, tzinfo=timezone.utc)


def test_cache_key_is_stable_and_prompt_specific():
    assert routing_policy.cache_key("a") == routing_policy.cache_key("a")
    assert routing_policy.cache_key("a") != routing_policy.cache_key("b")


def test_cache_roundtrip_and_miss(tmp_path):
    path = tmp_path / "c.json"
    key = routing_policy.cache_key("hello")
    assert routing_policy.cache_get(key, path) is None
    routing_policy.cache_put(key, "answer", path)
    assert routing_policy.cache_get(key, path) == "answer"
