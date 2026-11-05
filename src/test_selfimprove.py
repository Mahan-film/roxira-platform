"""Offline tests for scripts/ops/selfimprove (anonymiser, budget, regressions, clustering, report). No network."""
import importlib
import pathlib
import sys

import pytest

_DIR = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "ops" / "selfimprove"


def _mod(name):
    for p in (str(_DIR), str(_DIR.parents[1] / "monitor")):
        if p not in sys.path:
            sys.path.insert(0, p)
    return importlib.import_module(name)


def test_anonymise_phones_ids_names():
    a = _mod("anonymise").anonymise_text
    out = a("شماره من ۰۹۱۲۳۴۵۶۷۸۹ و کد ملی 0012345678 است، ایمیل x@y.com، حساب 6037991234567890")
    for leaked in ("09123456789", "0012345678", "x@y.com", "6037991234567890"):
        assert leaked not in out
    assert "[phone]" in out and "[id]" in out and "[email]" in out
    assert "[name]" in a("با آقای محمد رضایی صحبت کردم")
    assert "کریمی" not in a("نام من علی کریمی است")
    assert "912" not in a("call +98 912 345 6789")
    assert len(a("x" * 1000)) == 300


def test_budget_ledger(tmp_path):
    b = _mod("budget")
    led = b.Ledger(str(tmp_path / "l.jsonl"), cap_usd=0.01)
    led.charge(0.006, "a")
    assert led.can_afford(0.004) and not led.can_afford(0.005)
    with pytest.raises(b.BudgetExceeded):
        led.charge(0.005, "b")
    assert led.spent() == pytest.approx(0.006)  # refused charge recorded nothing
    assert b.Ledger(str(tmp_path / "l.jsonl"), cap_usd=0.01).spent() == pytest.approx(0.006)


def test_budget_cap_env(monkeypatch):
    b = _mod("budget")
    monkeypatch.delenv("SELFIMPROVE_DAILY_USD", raising=False)
    assert b.cap_from_env() == 0.30
    monkeypatch.setenv("SELFIMPROVE_DAILY_USD", "0.05")
    assert b.cap_from_env() == 0.05
    monkeypatch.setenv("SELFIMPROVE_DAILY_USD", "junk")
    assert b.cap_from_env() == 0.30


def _hist(key, vals, now):
    return [{"ts": now - 3600 * (i + 1), key: v} for i, v in enumerate(vals)]


def test_regression_detection():
    m = _mod("metrics")
    now = 1_000_000_000
    hist = _hist("recall", [0.9] * 8, now)
    assert m.detect_regressions({"recall": 0.9}, hist, now)["retrieval_recall"][0]
    assert not m.detect_regressions({"recall": 0.8}, hist, now)["retrieval_recall"][0]
    assert m.detect_regressions({"recall": 0.1}, hist[:2], now)["retrieval_recall"][0]  # no baseline yet
    ph = _hist("total_ms_p95", [4000] * 8, now)
    assert m.detect_regressions({"total_ms_p95": 5000, "chats": 9}, ph, now)["chat_p95"][0]
    assert not m.detect_regressions({"total_ms_p95": 5300, "chats": 9}, ph, now)["chat_p95"][0]
    assert "chat_p95" not in m.detect_regressions({"total_ms_p95": 9000, "chats": 2}, ph, now)
    old = [{"ts": now - 20 * 86400, "recall": 1.0}] * 8
    assert m.detect_regressions({"recall": 0.5}, old, now)["retrieval_recall"][0]  # old data ignored


def test_topic_clustering_synthetic():
    t = _mod("topics")
    docs = ["مجازات کلاهبرداری چیست", "کلاهبرداری اینترنتی مجازات دارد؟", "چک برگشتی چه مجازاتی دارد",
            "چک برگشتی و ممنوعیت دسته چک", "مهریه عندالمطالبه چگونه وصول می‌شود"]
    cl = t.cluster(docs)
    groups = [sorted(c["members"]) for c in cl]
    assert [2, 3] in groups and [4] in groups
    assert any(g[:2] == [0, 1] for g in groups) or [0] in groups  # fraud pair clusters unless only 'مجازات' is shared
    assert t.cluster([]) == []


def test_analysis_and_report():
    an, rp = _mod("analysis"), _mod("report")
    turns = [{"q": "کلاهبرداری اینترنتی", "sources": 0, "not_found": True, "answer_len": 50, "laws": 0},
             {"q": "کلاهبرداری اینترنتی چیست", "sources": 0, "not_found": False, "answer_len": 300, "laws": 0},
             {"q": "مهریه", "sources": 2, "not_found": True, "answer_len": 300, "laws": 2}]
    res = an.analyse(turns)
    assert res["total"] == 3 and res["no_source"] == 2 and res["not_found"] == 2
    assert res["missing"] and res["prompt_issues"]
    text = rp.render("2026-10-11", {"run": 2, "passed": 1, "failed": [{"id": "x", "missing": ["f"], "forbidden": []}]},
                     res, {"chats": 3, "total_ms_p95": 4000}, {}, 0.01, 0.30)
    assert "2026-10-11" in text and "TO-VERIFY" in text and "گزارش" in text and "0.0100 / 0.30" in text
    items = rp.actionable_items(res, {"failed": [{"id": "x", "missing": [], "forbidden": []}]})
    assert items and all("کلاهبرداری اینترنتی چیست" not in b for _, b in items)  # no question text in issues


def test_logstats():
    ls = _mod("logstats")
    lines = ["[CHAT-TIMING] request_id=- embed_ms=100 qdrant_ms=200 sql_ms=50 retrieval_ms=210 ttft_ms=900 llm_ms=3000 total_ms=4000 tier=FREE",
             "[CHAT-TIMING] request_id=- embed_ms=0 qdrant_ms=0 sql_ms=0 retrieval_ms=0 ttft_ms=0 llm_ms=0 total_ms=1 tier=FREE",
             "[LLM-UNAVAILABLE] provider=router status=429 model=x kind=rate_limit",
             "[CLIENT-ERROR] ip=\"1.2.3.4\" message=\"x\" kind=fetch_failed"]
    r = ls.parse(lines)
    assert r["chats"] == 1 and r["total_ms_p95"] == 4000 and r["llm_unavailable"] == 1
    assert r["client_errors"] == {"fetch_failed": 1}


def test_llm_policy(monkeypatch, tmp_path):
    monkeypatch.setenv("ROXIRA_LLM_COST_LOG", str(tmp_path / "cost.jsonl"))
    llm = _mod("llm")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert llm.pick_model() == "deepseek/deepseek-v4.1-flash"
    b = _mod("budget")
    assert llm.ask(b.Ledger("/nonexistent/x", 0.3), "p", "t") is None  # no key -> no call


def test_llm_ask_routes_free_first_and_charges_ledger(monkeypatch, tmp_path):
    monkeypatch.setenv("ROXIRA_LLM_COST_LOG", str(tmp_path / "cost.jsonl"))
    llm = _mod("llm")
    lr = llm.llm_route
    seen = []

    def call(messages, max_tokens):
        seen.append(messages)
        return "answer", 1000, 500
    atts = [lr.Attempt("fake/free", "free", False, call, price=(0.0, 0.0), public_only=True)]
    b = _mod("budget")
    led = b.Ledger(str(tmp_path / "l.jsonl"), cap_usd=0.3)
    assert llm.ask(led, "prompt", "what", system="sys", attempts=atts) == "answer"
    assert seen and seen[0][0] == {"role": "system", "content": "sys"}
    assert led.spent() == 0.0  # a free attempt costs nothing


def test_llm_ask_falls_back_and_charges_paid_cost(monkeypatch, tmp_path):
    monkeypatch.setenv("ROXIRA_LLM_COST_LOG", str(tmp_path / "cost.jsonl"))
    llm = _mod("llm")
    lr = llm.llm_route

    def bad(messages, max_tokens):
        raise lr.AttemptError("http429")

    def good(messages, max_tokens):
        return "ok", 1000, 500
    atts = [lr.Attempt("fake/free", "free", False, bad, public_only=True),
            lr.Attempt("fake/paid", "cheap_agent", True, good, price=(0.0, 2.0))]
    b = _mod("budget")
    led = b.Ledger(str(tmp_path / "l.jsonl"), cap_usd=0.3)
    assert llm.ask(led, "p", "w", attempts=atts) == "ok"
    assert led.spent() == pytest.approx(0.001)  # 500 out * 2.0 / 1e6
