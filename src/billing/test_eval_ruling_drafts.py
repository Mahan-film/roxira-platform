"""Offline tests for the ruling-draft eval harness (issue #456).

``scripts/eval_ruling_drafts.py`` lives outside pytest's ``testpaths`` (``src``),
so it is loaded dynamically in a fixture -- the same pattern as
``src/test_eval_cheap_tier.py``. No network and no model call: the offline
generator is deterministic and the corpus is the tracked JSONL
``data/legal/dotic_articles_2026-09-22.jsonl``.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


# The only person/entity names allowed anywhere in cases.jsonl. Every name field
# must be a member of this list (the file is synthetic, no real person or case).
FICTIONAL_NAMES = {
    "علی رضایی",
    "سارا محمدی",
    "حسن کریمی",
    "مریم احمدی",
    "زهرا صادقی",
    "رضا نوری",
    "امیر حسینی",
    "نگار کاظمی",
    "شرکت آلفا",
    "شرکت بتا",
}


@pytest.fixture(scope="module")
def eval_mod():
    """Load the harness lazily so importing this test has no script side effects."""
    path = Path(__file__).resolve().parents[2] / "scripts" / "eval_ruling_drafts.py"
    spec = importlib.util.spec_from_file_location("eval_ruling_drafts", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def cases(eval_mod):
    return eval_mod.load_cases(eval_mod.DEFAULT_CASES)


@pytest.fixture(scope="module")
def corpus(eval_mod):
    return eval_mod.load_corpus(eval_mod.DEFAULT_CORPUS)


def _mini_corpus():
    active = {
        ("قانون مدنی", "10"): {"law_name": "قانون مدنی", "article_no": "10", "is_active": True},
    }
    known = {("قانون مدنی", "10"), ("قانون مدنی", "999")}
    return {"active": active, "known": known}


# ── the synthetic case file ──────────────────────────────────────────────────


def test_cases_file_has_six_civil_and_six_criminal(cases):
    assert len(cases) == 12
    assert len({c["id"] for c in cases}) == 12
    assert sum(1 for c in cases if c["court_type"] == "civil") == 6
    assert sum(1 for c in cases if c["court_type"] == "criminal") == 6


def test_every_expected_article_exists_and_is_active(cases, corpus):
    for case in cases:
        for article in case["expected_articles"]:
            key = (article["law_name"], str(article["article_no"]))
            assert key in corpus["active"], f"{case['id']}: {key} is not active in the corpus"


def test_two_must_refuse_cases_have_no_expected_articles(cases):
    must_refuse = [c for c in cases if c["must_refuse"]]
    assert len(must_refuse) == 2
    for case in must_refuse:
        assert case["expected_articles"] == []


def test_cases_file_uses_only_declared_fictional_names(cases, eval_mod):
    for case in cases:
        for field in eval_mod.NAME_FIELDS:
            if field in case:
                assert case[field] in FICTIONAL_NAMES, f"{case['id']}.{field}={case[field]!r}"


# ── scorer math on tiny inputs ────────────────────────────────────────────────


def test_citation_validity_accepts_active_and_rejects_unknown(eval_mod):
    corpus = _mini_corpus()
    good = [{"law_name": "قانون مدنی", "article_no": "10"}]
    bad = [{"law_name": "قانون مدنی", "article_no": "999"}]
    assert eval_mod.citation_is_valid(good, corpus) is True
    assert eval_mod.citation_is_valid(bad, corpus) is False
    assert eval_mod.invalid_citations(bad, corpus) == [
        {"law_name": "قانون مدنی", "article_no": "999"}
    ]


def test_inactive_article_is_not_a_valid_citation(eval_mod):
    corpus = {
        "active": {},
        "known": {("قانون مدنی", "10")},
    }
    cited = [{"law_name": "قانون مدنی", "article_no": "10"}]
    assert eval_mod.citation_is_valid(cited, corpus) is False


def test_expected_recall_math(eval_mod):
    a = {"law_name": "قانون مدنی", "article_no": "10"}
    b = {"law_name": "قانون مدنی", "article_no": "183"}
    assert eval_mod.expected_recall([a, b], [a, b]) == 1.0
    assert eval_mod.expected_recall([a, b], [a]) == 0.5
    assert eval_mod.expected_recall([a, b], []) == 0.0
    assert eval_mod.expected_recall([], []) == 1.0


def test_refusal_correctness_iff_must_refuse(eval_mod):
    assert eval_mod.refusal_correct(True, True) is True
    assert eval_mod.refusal_correct(False, False) is True
    assert eval_mod.refusal_correct(True, False) is False
    assert eval_mod.refusal_correct(False, True) is False


def test_summarize_refusal_accounting_uses_must_refuse_subset(eval_mod):
    per_case = [
        {
            "citation_valid": True,
            "expected_total": 1,
            "expected_hit": 1,
            "refusal_correct": True,
            "must_refuse": True,
            "banner_present": True,
            "no_forbidden_words": True,
        },
        {
            "citation_valid": True,
            "expected_total": 1,
            "expected_hit": 1,
            "refusal_correct": False,
            "must_refuse": False,
            "banner_present": True,
            "no_forbidden_words": True,
        },
    ]
    overall = eval_mod.summarize(per_case)
    assert overall["must_refuse_cases"] == 1
    assert overall["must_refuse_correct_cases"] == 1
    assert overall["must_refuse_correct_rate"] == 1.0
    assert overall["refusal_correct_cases"] == 1
    assert overall["refusal_correct_rate"] == pytest.approx(0.5)


# ── forbidden words and banner ────────────────────────────────────────────────


def test_detect_forbidden_words(eval_mod):
    assert eval_mod.detect_forbidden("approved final") == ["approved", "final"]
    assert eval_mod.detect_forbidden("قوه قضائیه") == ["header:قوه قضائیه"]


def test_mentioning_qove_is_not_a_header(eval_mod):
    assert eval_mod.detect_forbidden("شورا زیر نظر قوه قضائیه تشکیل می‌شود.") == []


def test_banner_detection_and_clean_draft(eval_mod):
    assert eval_mod.banner_present(eval_mod.BANNER_TEXT) is True
    assert eval_mod.banner_present("متن بدون بنر") is False
    offline_draft = eval_mod.offline_generator(
        {"expected_articles": [{"law_name": "قانون مدنی", "article_no": "10"}]}
    )
    assert eval_mod.detect_forbidden(offline_draft["text"]) == []


# ── end to end (offline, no model) ────────────────────────────────────────────


def test_offline_run_meets_all_thresholds(eval_mod, cases, corpus):
    report = eval_mod.run_eval(cases, corpus, eval_mod.offline_generator, "offline")
    overall = report["overall"]
    assert overall["cases_total"] == 12
    assert overall["citation_validity_rate"] == 1.0
    assert overall["expected_recall_overall"] >= 0.8
    assert overall["must_refuse_correct_rate"] == 1.0
    assert overall["banner_present_rate"] == 1.0
    assert overall["no_forbidden_words_rate"] == 1.0
    assert all(eval_mod.thresholds_met(overall).values())


def test_live_mode_requires_generator_module(eval_mod):
    with pytest.raises(SystemExit) as exc:
        eval_mod.main(["--mode", "live"])
    assert exc.value.code == 2


def test_load_generator_module_missing_file(eval_mod, tmp_path):
    with pytest.raises(FileNotFoundError):
        eval_mod.load_generator_module(tmp_path / "does_not_exist.py")


def test_main_offline_writes_json_report(eval_mod, tmp_path, capsys):
    out = tmp_path / "report.json"
    code = eval_mod.main(["--mode", "offline", "--out", str(out)])
    assert code == 0
    assert "citation_validity" in capsys.readouterr().out
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["cases_total"] == 12
    assert data["overall"]["citation_validity_rate"] == 1.0
    assert data["overall"]["must_refuse_correct_rate"] == 1.0
    assert data["thresholds_met"] == {
        "citation_validity": True,
        "expected_recall": True,
        "must_refuse": True,
    }
