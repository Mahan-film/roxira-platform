"""Lawyer answers of 2026-10-13 as deterministic rules: repeal warning, lease regimes, mahr fact, retirement."""

from output_apps.generated_modules.smartjudge import chat_fast
from output_apps.generated_modules.smartjudge import legal_notes as ln
from output_apps.generated_modules.smartjudge import prompt_library as pl
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as le


# ---- item 2: implicit repeal warning ---------------------------------------------------------
def test_contested_row_adds_warning_once():
    rows = [{"title": "x"}, {"title": "y", "repeal_status": "implicit_contested"}]
    out = ln.finalize_reply("پاسخ", "اجرای حکم؟", rows)
    assert out.startswith("پاسخ") and ln.REPEAL_WARNING_FA in out
    assert ln.finalize_reply(out, "اجرای حکم؟", rows) == out  # idempotent


def test_no_warning_without_flag():
    assert ln.finalize_reply("پاسخ", "سوال", [{"title": "x"}, {"repeal_status": "active"}]) == "پاسخ"


def test_repeal_status_travels_from_payload_to_row_and_response():
    row = le._payload_to_row({"law_name": "قانون", "article_no": "5", "text": "متن", "repeal_status": "implicit_contested"})
    assert row["repeal_status"] == "implicit_contested"
    assert "repeal_status" not in le._payload_to_row({"law_name": "قانون", "article_no": "5", "text": "متن"})
    assert chat_fast.trim_sources([row])[0]["repeal_status"] == "implicit_contested"


# ---- item 4: lease regimes -------------------------------------------------------------------
def test_lease_detection_and_prompt_addendum():
    assert ln.is_lease_question("مستأجر اجاره‌نامه را تمدید نکرده است")
    assert not ln.is_lease_question("چک برگشتی دارم")
    prompt = pl.build_system_prompt([], True, "موجر می‌تواند ملک را تخلیه کند؟")
    assert ln.LEASE_ADDENDUM in prompt
    assert ln.LEASE_ADDENDUM in pl.build_text_prompt_basic(True, "اجاره‌نامه")
    assert ln.LEASE_ADDENDUM not in pl.build_system_prompt([], True, "طلاق")
    for year in ("۱۳۵۶", "۱۳۶۲", "۱۳۷۶"):
        assert year in ln.LEASE_ADDENDUM and year in ln.LEASE_NOTICE_FA
    assert "هرگز یکی را قطعاً حاکم اعلام نکن" in ln.LEASE_ADDENDUM


def test_lease_reply_without_dependency_statement_gets_notice():
    bad = "طبق قانون ۱۳۷۶ مستأجر باید تخلیه کند."
    assert not ln.lease_reply_ok(bad)
    assert ln.LEASE_NOTICE_FA in ln.finalize_reply(bad, "مستأجر تخلیه نمی‌کند", [])


def test_lease_reply_with_dependency_statement_untouched():
    good = "قانون حاکم به تاریخ و نوع قرارداد بستگی دارد؛ ۱۳۵۶ و ۱۳۷۶ هر کدام شرایطی دارند."
    assert ln.lease_reply_ok(good)
    assert ln.finalize_reply(good, "مستأجر تخلیه نمی‌کند", []) == good


# ---- item 5: mahr fact -----------------------------------------------------------------------
def test_mahr_fact_only_for_mahr_or_imprisonment_with_coins():
    assert ln.MAHR_FACT in pl.build_system_prompt([], True, "مهریه ام را چطور بگیرم؟")
    assert ln.MAHR_FACT in pl.build_system_prompt([], True, "آیا ۱۱۰ سکه حبس دارد؟")
    assert ln.MAHR_FACT not in pl.build_system_prompt([], True, "حبس برای چک")
    assert "110" in ln.MAHR_FACT and "حبس" in ln.MAHR_FACT


# ---- item 6: retirement disclaimer -----------------------------------------------------------
def test_retirement_disclaimer():
    out = ln.finalize_reply("ماده ۷۶ ...", "شرایط بازنشستگی تأمین اجتماعی چیست؟", [])
    assert ln.SOCIAL_SECURITY_DISCLAIMER_FA in out and "سازمان تأمین اجتماعی" in out
    assert ln.finalize_reply("پاسخ", "چک", []) == "پاسخ"
