"""B3: escalation triggers and the one-shot strong re-ask. Fake router/guard, no network."""
import asyncio
from types import SimpleNamespace

import pytest

from output_apps.generated_modules.smartjudge import answer_escalation as ae

LONG = "پاسخ " * 200
GOOD_REPORT = {"validated_articles": [{"article": "10"}], "flags": []}


def run(coro):
    return asyncio.run(coro)


def test_trigger_no_valid_citation_when_grounded():
    assert ae.triggers(LONG, grounded=True, guard_report={"validated_articles": [], "flags": []},
                       complex_question=False) == ["no_valid_citation"]
    assert ae.triggers(LONG, grounded=False, guard_report={"validated_articles": [], "flags": []},
                       complex_question=False) == []
    assert ae.triggers(LONG, grounded=True, guard_report=GOOD_REPORT, complex_question=True) == []


def test_trigger_invented_article_only_for_articles():
    rep = {"validated_articles": [{"article": "1"}], "flags": [{"kind": "article"}]}
    assert ae.triggers(LONG, grounded=True, guard_report=rep, complex_question=False) == ["invented_citation"]
    rep = {"validated_articles": [{"article": "1"}], "flags": [{"kind": "precedent"}]}
    assert ae.triggers(LONG, grounded=True, guard_report=rep, complex_question=False) == []


def test_trigger_too_short_only_for_complex(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION_MIN_ANSWER_CHARS", "100")
    assert ae.triggers("کوتاه", grounded=False, guard_report={}, complex_question=True) == ["too_short"]
    assert ae.triggers("کوتاه", grounded=False, guard_report={}, complex_question=False) == []
    assert ae.is_complex_question("x" * 500, False) and ae.is_complex_question("x", True)
    assert not ae.is_complex_question("سلام", False)


class FakeRouter:
    def __init__(self, content="پاسخ قوی"):
        self.calls = []
        self.content = content

    async def __call__(self, tier, messages, **kw):
        self.calls.append((tier, kw))
        return SimpleNamespace(content=self.content, model="strong-model", cost_usd=0.001)


def _args(fake, report=None, **over):
    async def guard(_t):
        return report if report is not None else {"validated_articles": [], "flags": []}

    base = dict(reply="کوتاه", messages=[{"role": "user", "content": "q"}], user_text="q", grounded=True,
                has_case_files=False, plan="VIP", first_tier="cheap", guard=guard, complete=fake,
                counter=lambda k, w: 1)
    base.update(over)
    return base


@pytest.fixture(autouse=True)
def _reg(monkeypatch):
    # resolve strong without reading real model ids from disk
    from src.ops_fallback import escalation as eng
    monkeypatch.setattr(eng, "_registry_resolver",
                        lambda t, roles: {"role": t, "ids": ["m/strong"], "free": False, "price": {}})
    monkeypatch.delenv("SMARTJUDGE_ESCALATION", raising=False)
    monkeypatch.delenv("SMARTJUDGE_ESCALATION_SCOPE", raising=False)


def test_flag_off_is_noop():
    fake = FakeRouter()
    out = run(ae.maybe_escalate(**_args(fake)))
    assert not out.escalated and out.reply == "کوتاه" and fake.calls == []


def test_vip_escalates_once_on_strong_sensitive(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION", "1")
    fake = FakeRouter()
    out = run(ae.maybe_escalate(**_args(fake)))
    assert out.escalated and out.reply == "پاسخ قوی" and out.model == "strong-model"
    assert out.triggers == ["no_valid_citation"]
    assert len(fake.calls) == 1
    tier, kw = fake.calls[0]
    assert tier == "strong" and kw["sensitive"] is True


def test_free_plan_skipped_in_vip_scope_but_allowed_with_cap(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION", "1")
    fake = FakeRouter()
    out = run(ae.maybe_escalate(**_args(fake, plan="FREE")))
    assert out.skipped == "scope" and fake.calls == []
    monkeypatch.setenv("SMARTJUDGE_ESCALATION_SCOPE", "all")
    monkeypatch.setenv("SMARTJUDGE_ESCALATION_DAILY_CAP", "2")
    assert run(ae.maybe_escalate(**_args(fake, plan="FREE", counter=lambda k, w: 2))).escalated
    capped = run(ae.maybe_escalate(**_args(fake, plan="FREE", counter=lambda k, w: 3)))
    assert capped.skipped == "daily_cap" and not capped.escalated and len(fake.calls) == 1


def test_good_answer_not_escalated(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION", "1")
    fake = FakeRouter()
    out = run(ae.maybe_escalate(**_args(fake, report=GOOD_REPORT, reply=LONG)))
    assert not out.escalated and fake.calls == []


def test_already_strong_and_failures_keep_original(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION", "1")
    fake = FakeRouter()
    assert run(ae.maybe_escalate(**_args(fake, first_tier="strong"))).skipped == "already_strong"

    async def boom(*a, **k):
        raise RuntimeError("provider down")

    out = run(ae.maybe_escalate(**_args(fake, complete=boom)))
    assert out.reply == "کوتاه" and not out.escalated and out.skipped == "error"
    empty = run(ae.maybe_escalate(**_args(FakeRouter(content="  "))))
    assert empty.reply == "کوتاه" and empty.skipped == "empty"


def test_precedent_only_or_case_ref_answer_does_not_fire_no_valid_citation():
    rep = {"validated_articles": [], "validated_precedents": [{"precedent": "800"}], "flags": [],
           "citations": [{"kind": "precedent"}]}
    assert ae.triggers(LONG, grounded=True, guard_report=rep, complex_question=False) == []
    empty = {"validated_articles": [], "flags": [], "citations": []}
    assert ae.triggers(LONG, grounded=True, guard_report=empty, complex_question=False,
                       has_case_refs=True) == []
    # no citation at all despite grounding -> fires
    assert ae.triggers(LONG, grounded=True, guard_report=empty, complex_question=False) == ["no_valid_citation"]
    # article-style citation that did not validate -> fires even with case refs
    assert "no_valid_citation" in ae.triggers("طبق ماده ۹۹۹ قانون " + LONG, grounded=True,
                                              guard_report=empty, complex_question=False, has_case_refs=True)


def test_case_ref_detected_from_records_in_maybe_escalate(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION", "1")
    fake = FakeRouter()
    rec = {"id": "f", "name": "n", "pages": 1, "text": "[صفحه 1]\nمتن", "status": "ready"}
    out = run(ae.maybe_escalate(**_args(fake, reply=LONG + " (فایل 1، صفحه 1)", case_records=[rec])))
    assert not out.escalated and fake.calls == []


def test_vip_already_strong_skips_and_free_cheap_reasks_under_cap(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_ESCALATION", "1")
    monkeypatch.setenv("SMARTJUDGE_ESCALATION_SCOPE", "all")
    monkeypatch.setenv("SMARTJUDGE_ESCALATION_DAILY_CAP", "5")
    fake = FakeRouter()
    vip = run(ae.maybe_escalate(**_args(fake, plan="VIP", first_tier="strong")))
    assert vip.skipped == "already_strong" and fake.calls == []
    free = run(ae.maybe_escalate(**_args(fake, plan="FREE", first_tier="cheap", counter=lambda k, w: 5)))
    assert free.escalated and len(fake.calls) == 1
    over = run(ae.maybe_escalate(**_args(fake, plan="FREE", first_tier="cheap", counter=lambda k, w: 6)))
    assert over.skipped == "daily_cap" and len(fake.calls) == 1
