"""Offline tests for prompt_library and its opt-in /consult wiring. Fakes only."""

import importlib

import pytest

URL = "/api/v1/apps/judge/chat"
MULTI = "شکایت کیفری کلاهبرداری و دادخواست مطالبه خسارت قرارداد و تخلف صنفی گران فروشی"
COMP = "صلاحیت دادگاه صلح در دعوای خرد چیست؟ کدام دادگاه صالح است؟"


@pytest.fixture
def pl():
    return importlib.import_module("output_apps.generated_modules.smartjudge.prompt_library")


@pytest.fixture
def env(monkeypatch):
    mod = importlib.import_module("output_apps.generated_modules.smartjudge.smartjudge_module")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    seen = {"queries": []}

    class Routed:
        content = "پاسخ"
        model = "fake"

    class FakeRouter:
        @staticmethod
        def router_enabled():
            return True

        @staticmethod
        async def complete(tier, messages, **kw):
            seen["system"] = messages[0]["content"]
            return Routed()

    async def fake_kg(query, limit=5, meta_out=None):
        seen["queries"].append(query)
        return mod._fallback_knowledge_graph(limit)

    async def fake_guard(text, *, use_qdrant=True):
        return {"validated_articles": []}

    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("no db")

    monkeypatch.setattr(mod, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(mod, "_llm_router", FakeRouter)
    monkeypatch.setattr(mod, "_use_llm_router", lambda: True)
    monkeypatch.setattr(mod, "_guard_citations", fake_guard)
    monkeypatch.setattr(mod.psycopg, "connect", Boom)
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app), seen, monkeypatch


def test_multi_domain_detection(pl):
    names = [d["domain"] for d in pl.detect_domains(MULTI)]
    assert {"criminal", "civil", "guild_violations"} <= set(names)
    assert pl.detect_domains("") == []


def test_competence_detected(pl):
    names = [d["domain"] for d in pl.detect_domains(COMP)]
    assert "competence_question" in names


def test_multi_domain_prompt_structure(pl):
    prompt = pl.build_system_prompt(pl.detect_domains(MULTI), True, MULTI)
    for section in (
        "وقایع مؤثر",
        "صلاحیت/مرجع صالح",
        "مستند قانونی (فقط از پایگاه)",
        "مهلت‌ها",
        "ادله",
        "ریسک‌ها",
        "گام بعدی",
        "ارتباط میان دعاوی",
        "اطلاعات ناقص",
    ):
        assert section in prompt
    assert "ماده [تأییدنشده]" in prompt
    assert "0-9" in prompt
    assert "مراجع احتمالی" in prompt
    assert "3 پرسش روشن‌کننده" in prompt


def test_single_domain_prompt_has_no_cross_section(pl):
    text = "مهریه و نفقه همسرم را می‌خواهم"
    prompt = pl.build_system_prompt(pl.detect_domains(text), True, text)
    assert "ارتباط میان دعاوی" not in prompt
    assert "خانواده" in prompt


def test_ungrounded_prompt_forbids_numbers(pl):
    prompt = pl.build_system_prompt(pl.detect_domains(MULTI), False, MULTI)
    assert "هیچ شماره‌ای" in prompt
    assert "فقط به موادی استناد کن" not in prompt


def test_competence_template(pl):
    prompt = pl.build_system_prompt(pl.detect_domains(COMP), True, COMP)
    assert prompt.index("قاعدهٔ حاکم") < prompt.index("انطباق با وقایع") < prompt.index("استثناها")


def test_query_expansion_cap_and_dedup(pl):
    out = pl.expand_competence_queries(COMP)
    assert 1 <= len(out) <= 3
    assert len(set(out)) == len(out)
    assert pl.expand_competence_queries("مهریه می‌خواهم") == []
    dup = pl.expand_competence_queries("صلاحیت دادگاه صلح")
    assert "صلاحیت دادگاه صلح" not in dup


def test_flag_off_unchanged_system_prompt(env):
    c, seen, mp = env
    mp.delenv("SMARTJUDGE_PROMPT_LIBRARY", raising=False)
    c.post(URL, json={"message": COMP, "conversation_id": "x"})
    assert "فوق‌العاده کوتاه" in seen["system"]
    assert seen["queries"] == [COMP]


def test_flag_on_uses_library_and_expands(env):
    c, seen, mp = env
    mp.setenv("SMARTJUDGE_PROMPT_LIBRARY", "1")
    c.post(URL, json={"message": COMP, "conversation_id": "x"})
    assert "فوق‌العاده کوتاه" not in seen["system"]
    assert "قاعدهٔ حاکم" in seen["system"]
    assert 2 <= len(seen["queries"]) <= 4
