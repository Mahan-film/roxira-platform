from __future__ import annotations

from datetime import datetime, timezone

import pytest

from output_apps.generated_modules.smartjudge import routing_policy as rp

U = timezone.utc


def test_cache_key_ignores_whitespace_and_digit_script_but_not_tenant():
    a = rp.cache_key("t", [{"role": "user", "content": "مبلغ  ۱۲۳ ریال"}], "x")
    b = rp.cache_key("t", [{"role": "user", "content": "مبلغ 123 ریال "}], "x")
    assert a == b
    assert a != rp.cache_key("t", [{"role": "user", "content": "مبلغ 123 ریال"}], "y")


def test_cache_expires_evicts_and_skips_empty():
    now = [0.0]
    c = rp.ResponseCache(ttl_hours=1, max_entries=2, clock=lambda: now[0])
    c.put("a", "1"); c.put("b", "2"); c.put("c", "3")
    assert c.get("a") is None and c.get("b") == "2"
    c.put("e", "  ")
    assert c.get("e") is None
    now[0] = 3601
    assert c.get("b") is None


def test_escalate_threshold():
    assert rp.escalate(0.79) and not rp.escalate(0.80) and rp.escalate(None)


def test_micro_batches_25_to_50():
    sizes = [len(b) for b in rp.micro_batches(list(range(130)))]
    assert sum(sizes) == 130 and all(25 <= s <= 50 for s in sizes), sizes
    assert [len(b) for b in rp.micro_batches(list(range(3)))] == [3]


def test_offpeak_window_is_1930_to_0330_tehran():
    assert rp.is_offpeak(datetime(2026, 11, 4, 16, 30, tzinfo=U))      # 20:00 Tehran
    assert not rp.is_offpeak(datetime(2026, 11, 4, 12, 0, tzinfo=U))   # 15:30 Tehran
    assert rp.next_offpeak(datetime(2026, 11, 4, 12, 0, tzinfo=U)) == datetime(2026, 11, 4, 16, 0, tzinfo=U)
    assert rp.should_defer("recon_classify", datetime(2026, 11, 4, 12, 0, tzinfo=U))
    assert not rp.should_defer("assistant_chat", datetime(2026, 11, 4, 12, 0, tzinfo=U))


def test_token_budget_per_tenant_and_task_and_day_rollover():
    now = [datetime(2026, 11, 4, 1, tzinfo=U).timestamp()]
    b = rp.TokenBudget(clock=lambda: now[0])
    b.charge("t1", "invoice_capture", 190000)
    with pytest.raises(rp.BudgetExceeded):
        b.charge("t1", "invoice_capture", 20000)       # task cap 200000
    b.charge("t2", "invoice_capture", 5000)            # other tenant fine
    b.charge("t3", "assistant_chat", 190000)
    with pytest.raises(rp.BudgetExceeded):
        b.charge("t3", "assistant_chat", 20000)        # tenant cap 200000
    now[0] += 86400
    b.charge("t3", "assistant_chat", 20000)
