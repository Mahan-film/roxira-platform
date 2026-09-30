"""Unit tests for scripts/eval_cheap_tier.py (issue #104).

scripts/eval_cheap_tier.py lives outside pytest's `testpaths = ["src"]`, so it
is loaded dynamically in a fixture -- same pattern as src/test_eval_coding_smoke.py
and src/test_check_models.py.

Fully offline: every test that reaches `call_model` swaps the HTTP layer
(`urllib.request.urlopen`) for a fake in-process responder, so no network call
and no OPENROUTER_API_KEY is ever read. `main()` tests set a dummy key purely so
the key-presence check passes.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

eval_cheap_tier = None  # populated by _load_module() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_module():
    global eval_cheap_tier
    if eval_cheap_tier is None:
        module_path = Path(__file__).resolve().parents[1] / "scripts" / "eval_cheap_tier.py"
        spec = importlib.util.spec_from_file_location("eval_cheap_tier", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["eval_cheap_tier"] = module
        spec.loader.exec_module(module)
        eval_cheap_tier = module


# ---------------------------------------------------------------------------
# Mocked HTTP layer
# ---------------------------------------------------------------------------


class _FakeHTTPResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _install_http(module, monkeypatch, handler):
    """Swap urllib.request.urlopen in the loaded module for an in-process fake.
    `handler(request_body_dict) -> response_body_dict`; raise to simulate a
    transport error."""

    def _urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        return _FakeHTTPResponse(handler(body))

    monkeypatch.setattr(module.urllib.request, "urlopen", _urlopen)


def _chat_payload(
    content: str, cost: float, prompt_tokens: int = 100, completion_tokens: int = 20
):
    return {
        "model": "vendor/model",
        "choices": [{"message": {"content": content}}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost": cost,
        },
    }


def _result(qid, cited, latency=100.0, cost=0.001):
    return eval_cheap_tier.AnswerResult(
        question_id=qid,
        cited=cited,
        latency_ms=latency,
        prompt_tokens=10,
        completion_tokens=5,
        cost_usd=cost,
    )


QUESTIONS = [
    {"id": "q1", "question": "مهلت تجدیدنظر چند روز است؟", "expected_article": 336},
    {"id": "q2", "question": "مهلت واخواهی چند روز است؟", "expected_article": 306},
]


# ---------------------------------------------------------------------------
# Answer grading
# ---------------------------------------------------------------------------


def test_answer_cites_article_persian_digits():
    assert eval_cheap_tier.answer_cites_article("طبق ماده ۳۳۶ این قانون...", 336) is True


def test_answer_cites_article_latin_digits():
    assert eval_cheap_tier.answer_cites_article("مطابق ماده 336", 336) is True


def test_answer_cites_article_wrong_article_is_false():
    assert eval_cheap_tier.answer_cites_article("مطابق ماده ۳۳۵", 336) is False


def test_answer_cites_article_bare_number_without_word_article_is_false():
    assert eval_cheap_tier.answer_cites_article("پاسخ 336 است", 336) is False


def test_answer_cites_article_empty_is_false():
    assert eval_cheap_tier.answer_cites_article(None, 336) is False
    assert eval_cheap_tier.answer_cites_article("", 336) is False


# ---------------------------------------------------------------------------
# Model call
# ---------------------------------------------------------------------------


def test_call_model_parses_content_and_usage(monkeypatch):
    captured = {}

    def handler(body):
        captured.update(body)
        return _chat_payload("ماده ۳۳۶", cost=0.0042, prompt_tokens=123, completion_tokens=45)

    _install_http(eval_cheap_tier, monkeypatch, handler)

    content, usage = eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model")
    assert content == "ماده ۳۳۶"
    assert usage["prompt_tokens"] == 123
    assert usage["completion_tokens"] == 45
    assert usage["cost_usd"] == pytest.approx(0.0042)
    assert usage["latency_ms"] >= 0
    # request shape is fixed by the issue
    assert captured["max_tokens"] == 800
    assert captured["model"] == "vendor/model"
    assert captured["temperature"] == 0
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][-1] == {"role": "user", "content": "سؤال"}


def test_call_model_returns_error_on_transport_failure(monkeypatch):
    def handler(body):
        raise urllib.error.URLError("connection refused")

    _install_http(eval_cheap_tier, monkeypatch, handler)

    content, usage = eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model")
    assert content is None
    assert "error" in usage
    assert usage["latency_ms"] >= 0


def test_call_model_handles_missing_content(monkeypatch):
    _install_http(eval_cheap_tier, monkeypatch, lambda body: {"usage": {}})
    content, usage = eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model")
    assert content is None
    assert "no message content" in usage["error"]


# ---------------------------------------------------------------------------
# issue #133 — reasoning flag
# ---------------------------------------------------------------------------


def test_call_model_reasoning_off_sends_enabled_false(monkeypatch):
    captured = {}

    def handler(body):
        captured.update(body)
        return _chat_payload("ماده ۳۳۶", cost=0.0)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model", reasoning="off")
    assert captured["reasoning"] == {"enabled": False}


def test_call_model_reasoning_low_sends_effort(monkeypatch):
    captured = {}

    def handler(body):
        captured.update(body)
        return _chat_payload("ماده ۳۳۶", cost=0.0)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model", reasoning="low")
    assert captured["reasoning"] == {"effort": "low"}


def test_call_model_reasoning_default_omits_field(monkeypatch):
    captured = {}

    def handler(body):
        captured.update(body)
        return _chat_payload("ماده ۳۳۶", cost=0.0)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model", reasoning="default")
    assert "reasoning" not in captured


def test_run_eval_passes_reasoning_to_every_call(monkeypatch):
    seen = []

    def handler(body):
        seen.append(body.get("reasoning"))
        return _chat_payload("ماده ۳۳۶", cost=0.0)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    eval_cheap_tier.run_eval(
        ["vendor/model"], QUESTIONS, "dummy-key", budget_usd=10.0, reasoning="low"
    )
    assert seen == [{"effort": "low"}, {"effort": "low"}]


# ---------------------------------------------------------------------------
# issue #133 — empty content + HTTP error body
# ---------------------------------------------------------------------------


def _empty_payload(finish_reason: str = "length", completion_tokens: int = 300):
    return {
        "model": "vendor/model",
        "choices": [
            {"message": {"content": None}, "finish_reason": finish_reason}
        ],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": completion_tokens,
            "cost": 0.0001,
        },
    }


def test_call_model_empty_content_is_recorded_as_empty(monkeypatch):
    _install_http(eval_cheap_tier, monkeypatch, lambda body: _empty_payload())
    content, usage = eval_cheap_tier.call_model(
        "سؤال", "dummy-key", "vendor/model", reasoning="default"
    )
    assert content is None
    assert usage["error"] == "EMPTY (finish_reason=length)"
    assert usage["empty"] is True
    # real usage is preserved so cost/budget accounting stays honest
    assert usage["completion_tokens"] == 300


def test_call_model_empty_content_empty_string_also_empty(monkeypatch):
    def handler(body):
        payload = _empty_payload(finish_reason="stop")
        payload["choices"][0]["message"]["content"] = ""
        return payload

    _install_http(eval_cheap_tier, monkeypatch, handler)
    content, usage = eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model")
    assert content is None
    assert usage["error"] == "EMPTY (finish_reason=stop)"
    assert usage["empty"] is True


def test_call_model_http_error_includes_body_not_key(monkeypatch):
    body = json.dumps({"error": {"message": "ZDR violation (account settings)"}}).encode()

    def handler(body_dict):
        raise urllib.error.HTTPError(
            "https://openrouter.ai/api/v1/chat/completions",
            404,
            "Not Found",
            {},
            io.BytesIO(body),
        )

    _install_http(eval_cheap_tier, monkeypatch, handler)
    content, usage = eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model")
    assert content is None
    assert "404" in usage["error"]
    assert "ZDR violation" in usage["error"]
    assert "dummy-key" not in usage["error"]


def test_http_error_body_is_truncated(monkeypatch):
    body = json.dumps({"error": {"message": "x" * 1000}}).encode()

    def handler(body_dict):
        raise urllib.error.HTTPError("https://x", 500, "Server Error", {}, io.BytesIO(body))

    _install_http(eval_cheap_tier, monkeypatch, handler)
    content, usage = eval_cheap_tier.call_model("سؤال", "dummy-key", "vendor/model")
    assert content is None
    # error prefix + at most 300 chars of body
    assert len(usage["error"]) <= len("HTTPError: 500 Server Error — ") + 300


def test_run_eval_counts_empty_answers_in_empty_column(monkeypatch):
    _install_http(eval_cheap_tier, monkeypatch, lambda body: _empty_payload())
    reports, spent, exceeded = eval_cheap_tier.run_eval(
        ["vendor/model"], QUESTIONS, "dummy-key", budget_usd=10.0, reasoning="default"
    )
    report = reports[0]
    assert report.n_empty == 2
    assert report.n_errors == 2
    assert report.n_ok == 0
    markdown = eval_cheap_tier.render_markdown(reports, spent, exceeded)
    assert "empty" in markdown
    assert "EMPTY (finish_reason=length)" in markdown


# ---------------------------------------------------------------------------
# Cost math
# ---------------------------------------------------------------------------


def test_estimate_cost_prefers_api_usage_cost(monkeypatch):
    monkeypatch.setattr(
        eval_cheap_tier, "price_for_model", lambda model_id: {"in": 1.0, "out": 2.0}
    )
    usage = {"cost_usd": 0.05, "prompt_tokens": 1_000_000, "completion_tokens": 1_000_000}
    assert eval_cheap_tier.estimate_cost_usd(usage, "vendor/model") == pytest.approx(0.05)


def test_estimate_cost_falls_back_to_registry(monkeypatch):
    monkeypatch.setattr(
        eval_cheap_tier, "price_for_model", lambda model_id: {"in": 1.0, "out": 2.0}
    )
    usage = {"cost_usd": None, "prompt_tokens": 1_000_000, "completion_tokens": 500_000}
    assert eval_cheap_tier.estimate_cost_usd(usage, "vendor/model") == pytest.approx(2.0)


def test_estimate_cost_unknown_model_is_zero(monkeypatch):
    monkeypatch.setattr(eval_cheap_tier, "price_for_model", lambda model_id: None)
    usage = {"cost_usd": None, "prompt_tokens": 1000, "completion_tokens": 1000}
    assert eval_cheap_tier.estimate_cost_usd(usage, "vendor/model") == 0.0


# ---------------------------------------------------------------------------
# Summary statistics
# ---------------------------------------------------------------------------


def test_summarize_model_hit_rate_median_and_cost_per_100():
    results = [
        _result("q1", True, latency=100.0, cost=0.001),
        _result("q2", True, latency=300.0, cost=0.001),
        _result("q3", False, latency=200.0, cost=0.001),
    ]
    report = eval_cheap_tier.summarize_model("vendor/model", results)
    assert report.n == 3
    assert report.n_cited == 2
    assert report.hit_rate == pytest.approx(2 / 3, abs=1e-4)
    assert report.median_latency_ms == 200.0
    assert report.total_cost_usd == pytest.approx(0.003)
    assert report.cost_per_100_answers == pytest.approx(0.1)


def test_summarize_model_empty_results():
    report = eval_cheap_tier.summarize_model("vendor/model", [])
    assert report.n == 0
    assert report.hit_rate == 0.0
    assert report.median_latency_ms == 0.0
    assert report.cost_per_100_answers == 0.0


def test_median_latency_ignores_failed_calls():
    results = [
        _result("q1", True, latency=100.0),
        _result("q2", True, latency=300.0),
        eval_cheap_tier.AnswerResult(
            question_id="q3",
            cited=False,
            latency_ms=0.0,
            prompt_tokens=0,
            completion_tokens=0,
            cost_usd=0.0,
            error="boom",
        ),
    ]
    report = eval_cheap_tier.summarize_model("vendor/model", results)
    assert report.median_latency_ms == 200.0


def test_summarize_model_records_errors_and_keeps_them_out_of_hit_rate():
    results = [
        _result("q1", True),
        _result("q2", False),
        eval_cheap_tier.AnswerResult(
            question_id="q3",
            cited=False,
            latency_ms=0.0,
            prompt_tokens=0,
            completion_tokens=0,
            cost_usd=0.0,
            error="URLError: CERTIFICATE_VERIFY_FAILED",
        ),
    ]
    report = eval_cheap_tier.summarize_model("vendor/model", results)
    assert report.n == 3
    assert report.n_errors == 1
    assert report.n_ok == 2
    assert report.first_error == "URLError: CERTIFICATE_VERIFY_FAILED"
    assert report.error_rate == pytest.approx(1 / 3, abs=1e-4)
    # hit-rate denominator excludes the errored answer: 1/2, not 1/3
    assert report.hit_rate == pytest.approx(0.5)


def test_summarize_model_all_errors_has_zero_hit_rate_but_records_error():
    results = [
        eval_cheap_tier.AnswerResult(
            question_id=f"q{i}",
            cited=False,
            latency_ms=0.0,
            prompt_tokens=0,
            completion_tokens=0,
            cost_usd=0.0,
            error="HTTPError: 402 Payment Required",
        )
        for i in range(3)
    ]
    report = eval_cheap_tier.summarize_model("vendor/model", results)
    assert report.n_errors == 3
    assert report.n_ok == 0
    assert report.hit_rate == 0.0
    assert report.error_rate == 1.0
    assert "402" in report.first_error


def test_is_ssl_cert_error_detects_and_ignores_other_errors():
    assert eval_cheap_tier.is_ssl_cert_error("URLError: CERTIFICATE_VERIFY_FAILED") is True
    assert eval_cheap_tier.is_ssl_cert_error("HTTPError: 402 Payment Required") is False
    assert eval_cheap_tier.is_ssl_cert_error(None) is False


# ---------------------------------------------------------------------------
# Cheapest-model decision
# ---------------------------------------------------------------------------


def test_cheapest_meeting_threshold_picks_cheapest_above_bar(monkeypatch):
    reports = [
        eval_cheap_tier.summarize_model("best", [_result("q", True)]),  # 100%
        eval_cheap_tier.summarize_model(
            "near", [_result("q", True), _result("q", False, cost=0.0)]
        ),  # 50% -> ineligible
        eval_cheap_tier.summarize_model(
            "mid", [_result("q", True), _result("q", True), _result("q", False)]
        ),  # 66.7% -> ineligible at ratio 0.9
    ]
    # best=1.0, bar=0.9 -> only "best" qualifies
    chosen = eval_cheap_tier.cheapest_meeting_threshold(reports)
    assert chosen.model == "best"

    # lower the bar and make the cheap high-hit model the winner
    reports[1].hit_rate = 0.95
    reports[1].cost_per_100_answers = 0.01
    reports[0].cost_per_100_answers = 0.5
    chosen = eval_cheap_tier.cheapest_meeting_threshold(reports)
    assert chosen.model == "near"


def test_cheapest_meeting_threshold_empty_is_none():
    assert eval_cheap_tier.cheapest_meeting_threshold([]) is None


# ---------------------------------------------------------------------------
# Eval run + budget fail-closed
# ---------------------------------------------------------------------------


def test_run_eval_computes_hit_rate(monkeypatch):
    def handler(body):
        article = "۳۳۶" if "تجدیدنظر" in body["messages"][-1]["content"] else "۹۹۹"
        return _chat_payload(f"ماده {article}", cost=0.001)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    reports, spent, exceeded = eval_cheap_tier.run_eval(
        ["vendor/model"], QUESTIONS, "dummy-key", budget_usd=10.0
    )
    assert exceeded is False
    assert len(reports) == 1
    assert reports[0].n == 2
    assert reports[0].n_cited == 1
    assert reports[0].hit_rate == pytest.approx(0.5)
    assert spent == pytest.approx(0.002)


def test_run_eval_counts_errors_when_every_call_fails(monkeypatch):
    def handler(body):
        raise urllib.error.URLError("CERTIFICATE_VERIFY_FAILED")

    _install_http(eval_cheap_tier, monkeypatch, handler)
    reports, spent, exceeded = eval_cheap_tier.run_eval(
        ["vendor/model"], QUESTIONS, "dummy-key", budget_usd=10.0
    )
    assert exceeded is False
    report = reports[0]
    assert report.n_errors == 2
    assert report.n_ok == 0
    assert report.hit_rate == 0.0
    assert report.error_rate == 1.0
    # the key is never part of the recorded error message
    assert "dummy-key" not in (report.first_error or "")
    markdown = eval_cheap_tier.render_markdown(reports, spent, exceeded)
    assert "ERRORS 2/2" in markdown
    # no model may be recommended from a run with errors
    assert "cheapest model reaching" in markdown
    assert "(none)" in markdown


def test_render_markdown_recommends_when_clean(monkeypatch):
    reports = [
        eval_cheap_tier.summarize_model("vendor/model", [_result("q1", True, cost=0.001)])
    ]
    markdown = eval_cheap_tier.render_markdown(reports, 0.001, False)
    assert "ERRORS" not in markdown
    assert "`vendor/model`" in markdown


def test_run_eval_budget_fail_closed_stops_calls(monkeypatch):
    calls = {"n": 0}

    def handler(body):
        calls["n"] += 1
        return _chat_payload("ماده ۳۳۶", cost=0.6)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    reports, spent, exceeded = eval_cheap_tier.run_eval(
        ["vendor/model"], QUESTIONS, "dummy-key", budget_usd=1.0
    )
    assert exceeded is True
    # first call -> 0.6 (<=1.0), second -> 1.2 (>1.0) then stop
    assert calls["n"] == 2
    assert reports[0].n == 2
    assert spent == pytest.approx(1.2)


# ---------------------------------------------------------------------------
# CLI / end to end (mocked HTTP, dummy key)
# ---------------------------------------------------------------------------


def _write_eval_set(tmp_path: Path) -> Path:
    path = tmp_path / "eval.jsonl"
    path.write_text(
        "\n".join(json.dumps(q, ensure_ascii=False) for q in QUESTIONS) + "\n",
        encoding="utf-8",
    )
    return path


def test_main_requires_openrouter_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    code = eval_cheap_tier.main(["--models", "vendor/model"])
    assert code == 2


def test_main_end_to_end_prints_markdown(monkeypatch, tmp_path, capsys):
    eval_path = _write_eval_set(tmp_path)

    def handler(body):
        article = "۳۳۶" if "تجدیدنظر" in body["messages"][-1]["content"] else "۳۰۶"
        return _chat_payload(f"طبق ماده {article}", cost=0.001)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    code = eval_cheap_tier.main(
        ["--models", "vendor/model-a,vendor/model-b", "--n", "2", "--eval-set", str(eval_path)]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "citation hit-rate" in out
    assert "median latency" in out
    assert "cost / 100 answers" in out
    assert "vendor/model-a" in out and "vendor/model-b" in out
    assert "cheapest model reaching" in out


def test_main_budget_exceeded_returns_nonzero(monkeypatch, tmp_path, capsys):
    eval_path = _write_eval_set(tmp_path)
    _install_http(
        eval_cheap_tier, monkeypatch, lambda body: _chat_payload("ماده ۳۳۶", cost=0.6)
    )
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    code = eval_cheap_tier.main(
        [
            "--models",
            "vendor/model",
            "--n",
            "2",
            "--budget-usd",
            "1.0",
            "--eval-set",
            str(eval_path),
        ]
    )
    assert code == 2
    err = capsys.readouterr().err
    assert "budget" in err.lower()


def test_main_all_calls_fail_exits_2_with_banner_and_ssl_hint(
    monkeypatch, tmp_path, capsys
):
    eval_path = _write_eval_set(tmp_path)

    def handler(body):
        raise urllib.error.URLError("CERTIFICATE_VERIFY_FAILED")

    _install_http(eval_cheap_tier, monkeypatch, handler)
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    code = eval_cheap_tier.main(
        ["--models", "vendor/model", "--n", "2", "--eval-set", str(eval_path)]
    )
    assert code == 2
    captured = capsys.readouterr()
    assert "ERRORS 2/2" in captured.out
    assert "(none)" in captured.out
    assert "fail loudly" in captured.err
    assert "SSL_CERT_FILE" in captured.err
    assert "certifi.where()" in captured.err
    # the key must never leak into output
    assert "dummy-key" not in captured.out
    assert "dummy-key" not in captured.err


def test_main_error_rate_below_threshold_still_exits_0(monkeypatch, tmp_path, capsys):
    eval_path = _write_eval_set(tmp_path)
    calls = {"n": 0}

    def handler(body):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.URLError("connection reset")
        return _chat_payload("ماده ۳۳۶", cost=0.001)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    # 1 failure out of 10 questions = 10% < 20%, so the exit code stays 0 even
    # though errors were recorded (and the model is still not recommended).
    questions = [
        {"id": f"q{i}", "question": f"سؤال {i}", "expected_article": 336}
        for i in range(10)
    ]
    eval_path.write_text(
        "\n".join(json.dumps(q, ensure_ascii=False) for q in questions) + "\n",
        encoding="utf-8",
    )
    code = eval_cheap_tier.main(
        ["--models", "vendor/model", "--n", "10", "--eval-set", str(eval_path)]
    )
    assert code == 0
    captured = capsys.readouterr()
    assert "ERRORS 1/10" in captured.out
    # a run with any errors still must not recommend a model
    assert "(none)" in captured.out


def test_main_http_error_prints_body_and_never_the_key(monkeypatch, tmp_path, capsys):
    eval_path = _write_eval_set(tmp_path)
    body = json.dumps({"error": {"message": "ZDR violation (account settings)"}}).encode()

    def handler(body_dict):
        raise urllib.error.HTTPError(
            "https://openrouter.ai/api/v1/chat/completions",
            404,
            "Not Found",
            {},
            io.BytesIO(body),
        )

    _install_http(eval_cheap_tier, monkeypatch, handler)
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    code = eval_cheap_tier.main(
        ["--models", "vendor/model", "--n", "2", "--eval-set", str(eval_path)]
    )
    assert code == 2
    captured = capsys.readouterr()
    assert "ZDR violation" in captured.err
    assert "dummy-key" not in captured.out
    assert "dummy-key" not in captured.err


def test_main_default_reasoning_is_off(monkeypatch, tmp_path, capsys):
    eval_path = _write_eval_set(tmp_path)
    seen = []

    def handler(body):
        seen.append(body.get("reasoning"))
        return _chat_payload("ماده ۳۳۶", cost=0.0)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    code = eval_cheap_tier.main(
        ["--models", "vendor/model", "--n", "2", "--eval-set", str(eval_path)]
    )
    assert code == 0
    # default is off -> every request carries {"enabled": false}
    assert seen == [{"enabled": False}, {"enabled": False}]


def test_main_reasoning_default_flag_omits_field(monkeypatch, tmp_path, capsys):
    eval_path = _write_eval_set(tmp_path)
    seen = []

    def handler(body):
        seen.append("reasoning" in body)
        return _chat_payload("ماده ۳۳۶", cost=0.0)

    _install_http(eval_cheap_tier, monkeypatch, handler)
    monkeypatch.setenv("OPENROUTER_API_KEY", "dummy-key")

    code = eval_cheap_tier.main(
        [
            "--models",
            "vendor/model",
            "--n",
            "2",
            "--reasoning",
            "default",
            "--eval-set",
            str(eval_path),
        ]
    )
    assert code == 0
    assert seen == [False, False]


# ---------------------------------------------------------------------------
# Shared eval set (reused from eval_legal_rag, no customer data)
# ---------------------------------------------------------------------------


def test_default_eval_set_is_the_shared_30_question_public_set():
    rows = eval_cheap_tier.load_eval_set(eval_cheap_tier.DEFAULT_EVAL_PATH)
    assert len(rows) == 30
    for row in rows:
        assert row["question"].strip()
        assert isinstance(row["expected_article"], int)
