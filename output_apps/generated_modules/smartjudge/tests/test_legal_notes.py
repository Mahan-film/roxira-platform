"""Lawyer answers of 2026-10-13 and 2026-10-21 as deterministic rules: repeal warning, lease regimes, mahr fact,
retirement, short imprisonment, cheques, filing offices, property registration."""

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
    assert ln.finalize_reply("پاسخ", "طلاق توافقی", []) == "پاسخ"


# ---- round 2 (2026-10-21): Q1/Q2 short imprisonment ------------------------------------------
def test_short_prison_detection_and_prompt():
    for q in ("آیا حبس کمتر از سه ماه صادر می‌شود؟", "مجازات تهدید چیست؟ حبس دارد؟", "مجازات جایگزین حبس چیست",
              "توهین به همسایه حبس دارد"):
        assert ln.is_short_prison_question(q), q
    assert not ln.is_short_prison_question("مهریه ۱۱۰ سکه حبس دارد؟")
    assert not ln.is_short_prison_question("چگونه ملک بخرم")
    assert ln.is_short_prison_question("اگر کسی دیگری را تهدید به قتل کند، چه مجازاتی دارد؟")
    prompt = pl.build_system_prompt([], True, "حبس کمتر از ۳ ماه چطور است؟")
    assert ln.SHORT_PRISON_FACT in prompt
    assert ln.SHORT_PRISON_FACT not in pl.build_system_prompt([], True, "طلاق")
    for art in ("65", "66", "67", "70"):
        assert f"ماده {art}" in ln.SHORT_PRISON_FACT
    assert "طبق رویهٔ عملی" in ln.SHORT_PRISON_FACT  # lawyer-only claims stay labelled as practice


def test_short_prison_notice_added_once_unless_reply_mentions_alternatives():
    q = "برای توهین حبس می‌دهند؟"
    out = ln.finalize_reply("حبس از یک تا سه ماه", q, [])
    assert ln.SHORT_PRISON_NOTICE_FA in out and ln.finalize_reply(out, q, []) == out
    good = "دادگاه به مجازات جایگزین حبس حکم می‌دهد."
    assert ln.finalize_reply(good, q, []) == good


# ---- Q15 cheques -----------------------------------------------------------------------------
def test_cheque_detection_and_prompt():
    assert ln.is_cheque_question("چک برگشتی دارم") and ln.is_cheque_question("چک صیادی")
    assert not ln.is_cheque_question("چکیده رأی را بگو") and not ln.is_cheque_question("طلاق")
    assert ln.CHEQUE_FACT in pl.build_system_prompt([], True, "چک برگشتی را کجا شکایت کنم")
    assert "ماده 11" in ln.CHEQUE_FACT and "812" in ln.CHEQUE_FACT and "دادسرا" in ln.CHEQUE_FACT
    assert "100" not in ln.CHEQUE_FACT and "میلیون" not in ln.CHEQUE_FACT  # peace-court ceiling lives in config


def test_cheque_notice_only_without_six_month_statement():
    q = "چک برگشتی دارم چه کنم"
    assert ln.CHEQUE_NOTICE_FA in ln.finalize_reply("باید اقدام کنید.", q, [])
    ok = "ظرف شش ماه از تاریخ چک باید اقدام کنید."
    assert ln.CHEQUE_NOTICE_FA not in ln.finalize_reply(ok, q, [])


# ---- Q18 filing offices ----------------------------------------------------------------------
def test_filing_notice_and_prompt():
    q = "دادخواست را کجا ثبت کنم؟"
    assert ln.is_filing_question(q) and ln.is_filing_question("شکایت کیفری")
    assert not ln.is_filing_question("مهریه چقدر است")
    assert ln.FILING_FACT in pl.build_system_prompt([], True, q)
    assert "دفاتر خدمات الکترونیک قضایی" in ln.finalize_reply("به دادگاه بروید.", q, [])
    done = "از طریق دفاتر خدمات الکترونیک قضایی ثبت کنید."
    assert ln.FILING_NOTICE_FA not in ln.finalize_reply(done, q, [])


# ---- Q20 property / Saghar -------------------------------------------------------------------
def test_property_notice_mentions_saghar_and_skips_leases():
    q = "قولنامه برای خرید ملک کافی است؟"
    assert ln.is_property_question("ثبت اسناد در چه مواردی اجباری است؟")
    assert ln.is_property_question(q) and ln.is_property_question("سند ملک را چطور منتقل کنم")
    assert not ln.is_property_question("مستأجر اجاره ملک را تخلیه نکرده") and not ln.is_property_question("طلاق")
    assert ln.PROPERTY_FACT in pl.build_system_prompt([], True, q)
    assert "ساغر" in ln.finalize_reply("سند رسمی لازم است.", q, [])
    assert ln.PROPERTY_NOTICE_FA not in ln.finalize_reply("در سامانه ساغر ثبت کنید.", q, [])
    assert "نیازمند بررسی" in ln.PROPERTY_FACT and "نیازمند بررسی" in ln.PROPERTY_NOTICE_FA


def test_unrelated_question_untouched_by_round2_rules():
    assert ln.prompt_addenda("حق مرخصی کارگر چقدر است؟") == []
    assert ln.finalize_reply("پاسخ", "حق مرخصی کارگر چقدر است؟", []) == "پاسخ"
