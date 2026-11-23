"""Tests for T349 / Issue #1322:
Phone answers parity:
1. 'grounded' boolean flag in /chat response payload (True when grounded, False when ungrounded).
2. Phone gateway callers receive VIP tier and NEVER receive consumer upsell/busy text.
3. Phonetics parity: all 7 missing phonetic repair regexes from issue #965 comment 5.
4. Latest regulation catalog intent detection and retrieval scroll.
"""
import asyncio

from output_apps.generated_modules.smartjudge import (
    catalog_intent,
    chat_auth,
    legal_phonetics,
    regulations_retrieval as reg_retrieval,
    smartjudge_module as sj,
)


# ==============================================================================
# 1. Grounded boolean flag in /chat payload
# ==============================================================================

def test_consult_body_grounded_flag_explicit():
    """Verify _consult_body honors explicit grounded=True and grounded=False."""
    body_true = sj._consult_body(
        conv_id="c-1",
        reply="پاسخ مستند",
        prob=0.8,
        draft="لایحه",
        laws=[{"title": "قانون مدنی ماده ۱۰", "category": "LAW", "summary": "عقود"}],
        precedents=[],
        court_suggestion=None,
        case_file_refs=[],
        model="primary",
        tier="FREE",
        t0=0.0,
        grounded=True,
    )
    assert body_true["grounded"] is True
    assert "grounded" in body_true

    body_false = sj._consult_body(
        conv_id="c-2",
        reply="پاسخ بدون استناد",
        prob=None,
        draft=None,
        laws=[],
        precedents=[],
        court_suggestion=None,
        case_file_refs=[],
        model="primary",
        tier="FREE",
        t0=0.0,
        grounded=False,
    )
    assert body_false["grounded"] is False


def test_consult_body_grounded_flag_computed_default():
    """When grounded is None, _consult_body derives it via _chat_safety.is_grounded."""
    # With valid law -> grounded True
    b_grounded = sj._consult_body(
        conv_id="c-3",
        reply="پاسخ",
        prob=0.5,
        draft=None,
        laws=[{"title": "ماده ۱۰ قانون مدنی", "summary": "متن"}],
        precedents=[],
        court_suggestion=None,
        case_file_refs=[],
        model="primary",
        tier="FREE",
        t0=0.0,
    )
    assert b_grounded["grounded"] is True

    # Empty sources -> grounded False
    b_ungrounded = sj._consult_body(
        conv_id="c-4",
        reply="پاسخ عمومی",
        prob=None,
        draft=None,
        laws=[],
        precedents=[],
        court_suggestion=None,
        case_file_refs=[],
        model="primary",
        tier="FREE",
        t0=0.0,
    )
    assert b_ungrounded["grounded"] is False


# ==============================================================================
# 2. Phone gateway: VIP tier and NEVER receive upsell text
# ==============================================================================

def test_phone_gateway_tier_is_vip(monkeypatch):
    """Verify phone gateway identity maps to VIP tier in chat_auth and user_level."""
    key = "k" * 40
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", key)
    gw_user = chat_auth.authenticate({"x-phone-gateway-key": key})
    assert chat_auth.is_phone_gateway(gw_user)
    assert chat_auth.user_level(gw_user) == "vip"
    assert gw_user.tier == "VIP"
    assert gw_user.plan_level == "free"


def test_phone_gateway_never_receives_upsell_on_exhaustion(monkeypatch):
    """When LLM free pool is exhausted, phone gateway must NEVER receive UPSELL_MESSAGE."""
    key = "k" * 40
    monkeypatch.setenv("SMARTJUDGE_PHONE_GATEWAY_KEY", key)
    gw_user = chat_auth.authenticate({"x-phone-gateway-key": key})
    assert chat_auth.is_phone_gateway(gw_user)

    class FakeLLMGateway:
        UPSELL_MESSAGE = "لطفاً برای دریافت پاسخ اشتراک تهیه فرمایید."
        PLANS_URL = "https://example.com/plans"

        def configured(self):
            return True

        def may_use_paid(self, tier):
            return False  # Pretend paid cannot be used

    monkeypatch.setattr(sj, "_llm_gateway", FakeLLMGateway())

    # Mock knowledge graph and LLM stream outcome to simulate exhaustion
    async def fake_kg(q, limit=5, meta_out=None):
        return [
            {
                "title": "ماده ۱۰ قانون مدنی",
                "summary": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند نافذ است.",
                "match_level": "EXACT",
                "is_active": True,
                "source_tier": "official",
                "category": "LAW",
            }
        ], []

    async def fake_llm(*args, **kwargs):
        from output_apps.generated_modules.smartjudge import chat_fast as cf
        return cf.StreamOutcome(text=""), "exhausted"

    monkeypatch.setattr(sj, "aquery_knowledge_graph", fake_kg)
    monkeypatch.setattr(sj, "_llm_stream_answer", fake_llm)
    monkeypatch.setattr(chat_auth, "decr", lambda k: 0)

    resp = asyncio.run(sj._consult_core({"message": "سوال تلفنی"}, None, gw_user))
    # It must return 503 unavailable, NEVER a friendly upsell
    assert getattr(resp, "status_code", 0) == 503


# ==============================================================================
# 3. Phonetics parity: 7 missing repair regexes from issue #965 comment 5
# ==============================================================================

def test_phonetics_parity_all_seven_patterns():
    """Verify all 7 phonetic repairs added in T349 fix ASR errors accurately."""
    cases = [
        # 1. قول به قضاییه -> قوه قضاییه
        ("نظر قول به قضاییه در این باره چیست؟", "قوه قضاییه"),
        # 2. ارای عدی بستا رویه -> آرای وحدت رویه
        ("بررسی ارای عدی بستا رویه دیوان", "آرای وحدت رویه"),
        # 3. آده رای بحث زدیه -> آرای وحدت رویه
        ("استناد به آده رای بحث زدیه", "آرای وحدت رویه"),
        # 4. مبارزان برشویش -> مبارزه با پولشویی
        ("قانون مبارزان برشویش کشور", "مبارزه با پولشویی"),
        # 5. پولشویش -> پولشویی
        ("جرم پولشویش چیست؟", "پولشویی"),
        # 6. قضاک -> قضات
        ("تصمیم قضاک دادگاه", "قضات"),
        # 7. تخلافات -> تخلفات
        ("رسیدگی به تخلافات اداری", "تخلفات"),
    ]

    for raw, expected_token in cases:
        repaired = legal_phonetics.repair_legal_phonetics(raw)
        assert expected_token in repaired, f"Failed phonetic repair for: {raw} -> {repaired}"


# ==============================================================================
# 4. Latest regulation catalog intent & retrieval scroll
# ==============================================================================

def test_detect_latest_regulation_intent():
    """Verify catalog_intent detects requests for latest regulations/circulars."""
    queries = [
        "آخرین بخشنامه بانک مرکزی",
        "جدیدترین بخشنامه های مالیاتی",
        "اخرین مقررات بازنشستگی",
        "آخر بخشنامه صادرات",
        "تازه‌ترین مصوبه هیئت وزیران",
    ]
    for q in queries:
        detected = catalog_intent.detect(q)
        assert detected is not None, f"Expected intent detection for query: {q}"
        assert detected["intent"] == "latest_regulation"
        assert detected["target"] == "regulation"


def test_build_catalog_context_and_format_for_regulation():
    """Verify deterministic formatting for regulation catalog hits."""
    sample_rows = [
        {
            "title": "بخشنامه رفع تعهدات ارزی",
            "number": "1403/100",
            "date": "1403/08/15",
            "issuer": "بانک مرکزی",
            "subject": "مهلت بازگشت ارز حاصل از صادرات محصولات پتروشیمی به سامانه نیما.",
        }
    ]

    ctx = catalog_intent.build_catalog_context(sample_rows, target="regulation")
    assert "بخشنامه‌ها و مقررات اجرایی" in ctx
    assert "بخشنامه رفع تعهدات ارزی" in ctx
    assert "بانک مرکزی" in ctx

    answer = catalog_intent.format_deterministic_answer(sample_rows, target="regulation")
    assert "1403/100" in answer
    assert "بانک مرکزی" in answer
    assert "1403/08/15" in answer


def test_regulations_latest_regulations_fallback(monkeypatch):
    """Verify regulations_retrieval.latest_regulations works with JSONL fallback or empty."""
    # Ensure no Qdrant connection hangs
    monkeypatch.delenv("SMARTJUDGE_REGULATIONS_COLLECTION", raising=False)

    results = asyncio.run(reg_retrieval.latest_regulations(limit=3))
    assert isinstance(results, list)
