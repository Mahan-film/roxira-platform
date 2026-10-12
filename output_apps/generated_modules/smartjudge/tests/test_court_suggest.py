"""Jurisdiction rules wiring: rules load, monetary edges, draft-assist chip, chat helper."""

import asyncio
import json

import pytest

from output_apps.generated_modules.smartjudge import draft_assistant as da
from output_apps.generated_modules.smartjudge import jurisdiction_rules as jr

LIMIT = 1_000_000_000  # value of peace_court_monetary in the YAML, asserted below


def rule(rule_id):
    return next(r for r in jr.load_rules() if r["id"] == rule_id)


def test_rules_load_and_peace_limit_comes_from_yaml():
    assert rule("peace_court_monetary")["threshold_rials"] == LIMIT
    assert rule("peace_court_monetary")["court_key"] == "peace"
    assert any(r["status"] == "needs_lawyer" for r in jr.load_rules())


def test_every_rule_with_court_key_has_basis_article():
    for r in jr.load_rules():
        if r.get("court_key"):
            assert r.get("basis_article")


@pytest.mark.parametrize(
    "rials,court",
    [
        (LIMIT - 1, "peace"),
        (LIMIT, "peace"),  # "تا نصاب": inclusive
        (LIMIT + 1, "general_civil"),
        (1, "peace"),
    ],
)
def test_monetary_threshold_edges(rials, court):
    out = jr.suggest_court(claims=f"مطالبه وجه {rials} ریال")["court_suggestion"]
    assert out["court_key"] == court
    assert out["basis_article"]
    assert out["amount_rials"] == rials


def test_toman_is_converted_to_rials():
    # 100 million toman == 1 billion rials == exactly the limit -> peace
    assert jr.suggest_court(claims="مطالبه ۱۰۰ میلیون تومان")["court_suggestion"]["court_key"] == "peace"
    assert jr.suggest_court(claims="مطالبه ۵۰۰ میلیون تومان")["court_suggestion"]["court_key"] == "general_civil"


def test_threshold_is_data_driven(tmp_path, monkeypatch):
    path = tmp_path / "rules.yaml"
    path.write_text(
        """rules:
  - {id: peace_court_monetary, forum: f, matter: m, threshold_rials: 100, legal_basis: b, basis_article: "ماده تست",
     court_key: peace, above_court_key: general_civil, confidence: high, source_url: null, status: confirmed, note: n}
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(jr, "_DEFAULT_RULES_PATH", path)
    assert jr.suggest_court(claims="مطالبه ۲۰۰ ریال")["court_suggestion"]["court_key"] == "general_civil"
    assert jr.suggest_court(claims="مطالبه ۱۰۰ ریال")["court_suggestion"]["basis_article"] == "ماده تست"


def test_unknown_amount_or_type_gives_no_suggestion():
    out = jr.suggest_court(claims="از من طلب دارد")
    assert out == {"court_suggestion": None, "missing": "amount"}
    assert jr.suggest_court(claims="سلام") == {"court_suggestion": None, "missing": "type"}
    # a bare number without unit is never guessed
    assert jr.extract_amount_rials("مبلغ 5000000") is None


def test_subject_courts_use_rules_not_amount():
    out = jr.suggest_court(facts="درخواست مهریه و نفقه")["court_suggestion"]
    assert out["court_key"] == "family"
    out = jr.suggest_court(facts="جرم قاچاق مواد مخدر")["court_suggestion"]
    assert out["court_key"] == "revolution" and "۳۰۳" in out["basis_article"]


def test_court_question_detection():
    assert jr.is_court_question("کجا شکایت کنم؟")
    assert jr.is_court_question("کدام دادگاه صالح است")
    assert not jr.is_court_question("مهلت تجدیدنظر چقدر است")


# ----------------------------------------------------------- draft-assist
class FakeLLM:
    def __init__(self, extraction):
        self.extraction = extraction

    async def __call__(self, tier, system, user, *, feature, max_tokens):
        return json.dumps(self.extraction, ensure_ascii=False)


def assist(text, extraction, known=None):
    state = asyncio.run(
        da.run_assist(
            "petition",
            [{"role": "user", "content": text}],
            [],
            known or {},
            [],
            call_llm=FakeLLM(extraction),
        )
    )
    return da.assist_response("petition", state)


def test_draft_assist_returns_chip_with_basis():
    text = "از آقای نمونه ۲ میلیارد ریال طلب دارم و می‌خواهم مطالبه کنم"
    out = assist(text, {"facts": text, "claims": "مطالبه ۲ میلیارد ریال", "amounts": "۲ میلیارد ریال"})
    sug = out["court_suggestion"]
    assert sug["court_key"] == "general_civil"
    assert out["fields"]["court_type"] == "general_civil"
    assert out["field_sources"]["court_type"] == "suggested"
    assert "بر اساس" in sug["chip_text"] and "ماده ۱۲" in sug["chip_text"]
    assert "درست است" in sug["chip_text"]


def test_draft_assist_small_amount_goes_to_peace():
    text = "۳۰۰ میلیون ریال بدهی دارد"
    out = assist(text, {"facts": text, "claims": "مطالبه ۳۰۰ میلیون ریال", "amounts": "۳۰۰ میلیون ریال"})
    assert out["court_suggestion"]["court_key"] == "peace"


def test_draft_assist_user_choice_wins_and_no_chip_when_different():
    text = "۳۰۰ میلیون ریال بدهی دارد"
    out = assist(
        text,
        {"facts": text, "claims": "مطالبه", "amounts": "۳۰۰ میلیون ریال"},
        known={"court_type": "general_civil"},
    )
    assert out["fields"]["court_type"] == "general_civil"
    assert out["court_suggestion"] is None


def test_draft_assist_unknown_gives_no_suggestion_and_does_not_block():
    text = "با همسایه‌ام اختلاف دارم"
    out = assist(text, {"facts": text})
    assert out["court_suggestion"] is None
    assert out["status"] == "need_info"  # asks for the missing fields as before


# ------------------------------------------------------------------- chat
def _chat_helper():
    try:
        from output_apps.generated_modules.smartjudge import smartjudge_module as m
    except Exception as exc:  # pragma: no cover - heavy deps absent
        pytest.skip(f"smartjudge_module not importable here: {type(exc).__name__}")
    return m._court_suggestion_for_chat


def test_chat_court_question_with_amount():
    helper = _chat_helper()
    sug, missing = helper("برای مطالبه ۲۰۰ میلیون تومان کجا شکایت کنم؟", {})
    assert missing is None
    assert set(sug) >= {"court", "basis_article", "confidence"}
    assert sug["court_key"] == "general_civil"


def test_chat_court_question_amount_from_earlier_message():
    helper = _chat_helper()
    payload = {"messages": [{"role": "user", "content": "طلبم ۵۰ میلیون تومان است"},
                            {"role": "user", "content": "کدام دادگاه صالح است؟"}]}
    sug, missing = helper("کدام دادگاه صالح است؟", payload)
    assert missing is None and sug["court_key"] == "peace"


def test_chat_court_question_missing_amount_and_non_court_question():
    helper = _chat_helper()
    assert helper("از او طلب دارم، کجا شکایت کنم؟", {}) == (None, "amount")
    assert helper("مهلت تجدیدنظر چقدر است؟", {}) == (None, None)


# ------------------------------------------------- review fixes (PR #581)
def _module():
    try:
        from output_apps.generated_modules.smartjudge import smartjudge_module as m
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"smartjudge_module not importable here: {type(exc).__name__}")
    return m


def test_real_consult_court_question_without_amount_clarifies(monkeypatch):
    m = _module()

    async def boom(*a, **k):
        raise AssertionError("retrieval/LLM must not run for a clarifying question")

    monkeypatch.setattr(m, "aquery_knowledge_graph", boom)
    out = asyncio.run(m._consult_core({"message": "از او طلب دارم، کجا شکایت کنم؟"}, None, m.chat_auth.ANONYMOUS))
    assert out["status"] == "SUCCESS"
    assert out["clarification_needed"] == "amount"
    assert out["reply"] == m.MSG_COURT_NEED_AMOUNT


def test_early_return_has_same_contract_keys_as_normal_body(monkeypatch):
    m = _module()
    out = asyncio.run(m._consult_core({"message": "از او طلب دارم، کجا شکایت کنم؟"}, None, m.chat_auth.ANONYMOUS))
    normal = m._consult_body(
        conv_id="c", reply="r", prob=None, draft=None, laws=[], precedents=[], court_suggestion=None,
        case_file_refs=[], model="m", tier="FREE", t0=0.0,
    )
    assert set(normal) <= set(out)
    assert out["case_file_refs"] == [] and out["statutory_basis"] == []
    assert out["court_suggestion"] is None and out["source_disclosure"]


def test_same_text_same_court_regardless_of_argument_split():
    text = "مطالبه وجه ۲ میلیارد ریال"
    a = jr.suggest_court(facts=text)["court_suggestion"]["court_key"]
    b = jr.suggest_court(claims=text)["court_suggestion"]["court_key"]
    c = jr.suggest_court(facts="مطالبه وجه", claims="۲ میلیارد", amounts="ریال")["court_suggestion"]["court_key"]
    assert a == b == c == "general_civil"


@pytest.mark.parametrize("raw", ["1000000000", "1,000,000,000", "۱٬۰۰۰٬۰۰۰٬۰۰۰", 1000000000])
def test_threshold_parsing_accepts_ints_and_separated_strings(tmp_path, raw):
    path = tmp_path / "r.yaml"
    path.write_text(
        f"""rules:
  - {{id: x, forum: f, matter: m, threshold_rials: "{raw}", legal_basis: b, source_url: null, status: confirmed, note: n}}
""" if isinstance(raw, str) else f"""rules:
  - {{id: x, forum: f, matter: m, threshold_rials: {raw}, legal_basis: b, source_url: null, status: confirmed, note: n}}
""",
        encoding="utf-8",
    )
    assert jr.load_rules(path)[0]["threshold_rials"] == 1000000000


@pytest.mark.parametrize("raw", ['"abc"', "true", "1.5", '"-5"', "[1]"])
def test_threshold_parsing_rejects_garbage(tmp_path, raw):
    path = tmp_path / "r.yaml"
    path.write_text(
        f"rules:\n  - {{id: x, forum: f, matter: m, threshold_rials: {raw}, legal_basis: b, source_url: null, status: confirmed, note: n}}\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        jr.load_rules(path)


def test_lawyer_answers_2026_10_13_in_yaml():
    """Gate item 3/4: old appeal and cassation nisabs superseded, peace ceiling confirmed, appealability still open."""
    assert rule("peace_court_monetary")["status"] == "confirmed"
    assert rule("peace_court_monetary")["threshold_rials"] == LIMIT
    for rid in ("civil_appeal_nisab", "civil_cassation_nisab"):
        assert rule(rid)["status"] == "superseded"
        assert "2026-10-13" in rule(rid)["note"] and "1402" in rule(rid)["note"]
    assert rule("peace_court_appealable_over")["status"] == "needs_lawyer"
    confirmed = {r["id"] for r in jr.confirmed_rules()}
    assert "civil_appeal_nisab" not in confirmed and "civil_cassation_nisab" not in confirmed


def test_personal_matter_needs_cue_not_amount_alone():
    assert not jr.is_personal_matter("حد نصاب ۵۰۰ میلیون تومان برای دادگاه صلح چقدر است؟")
    assert jr.is_personal_matter("۲۰ میلیون تومان از کسی طلب دارم کجا شکایت کنم")
    assert jr.is_personal_matter("مطالبه ۲۰ میلیون تومان خسارت، کدام دادگاه صالح است؟")
    assert not jr.is_personal_matter("صلاحیت دادگاه صلح چیست؟")
