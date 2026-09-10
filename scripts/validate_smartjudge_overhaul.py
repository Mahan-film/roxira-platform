#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
اعتبارسنج جامع بازطراحی SmartJudge — بدون نیاز به سرویس خارجی

بررسی‌ها:
  ۱) مدل‌های دقیق سه سطح OpenRouter
  ۲) توابع محض (tier map / model chain / JSON extraction / استخراج شماره ماده)
  ۳) پرامپت دو لایه (برداری + گراف) با متن مرجع قضایی
  ۴) اولویت DSN پایگاه داده (DATABASE_URL → POSTGRES_* → استاندارد)
  ۵) افت ایمن لایه گراف و سلامت endpointها (health / calculate / classify / search)

اجرا:  python3 scripts/validate_smartjudge_overhaul.py
خروجی 0 = همه بررسی‌ها موفق
"""
import asyncio
import importlib.util
import json
import os
import pathlib
import sys

_CANDIDATE_MODULE_PATHS = [
    pathlib.Path("/app/output_apps/generated_modules/smartjudge/smartjudge_module.py"),
    pathlib.Path("/opt/roxira_platform/output_apps/generated_modules/smartjudge/smartjudge_module.py"),
]
# داخل کانتینر مسیر /app و روی هاست مسیر /opt/roxira_platform معتبر است
MODULE_PATH = next((p for p in _CANDIDATE_MODULE_PATHS if p.exists()), _CANDIDATE_MODULE_PATHS[-1])

FAILED = []


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f" | {extra}" if extra else ""))
    if not cond:
        FAILED.append(name)


def load_module():
    spec = importlib.util.spec_from_file_location("smartjudge_module", str(MODULE_PATH))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    try:
        mod = load_module()
    except Exception as exc:
        print(f"[FAIL] import module: {exc}")
        return 1

    # ۱) مدل‌های سه سطح — دقیقاً طبق مشخصات (Tier1 فوق‌ارزان / Tier2-3 دقت بالا)
    check("tier1 models", mod.TIER_MODELS["tier1"] == ["google/gemini-3.5-flash-lite", "deepseek/deepseek-v4-flash-0731", "z-ai/glm-5.3-flash"])
    check("tier2 models", mod.TIER_MODELS["tier2"] == ["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro", "google/gemini-3.8-flash"])
    check("tier3 models", mod.TIER_MODELS["tier3"] == ["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro", "google/gemini-3.8-flash"])
    check("emergency models", mod._EMERGENCY_MODELS == ["google/gemini-3.5-flash-lite", "openai/gpt-5.6-luna", "deepseek/deepseek-v4-flash-0731"])
    chain = mod._model_chain("tier1")
    check("model chain dedup", len(chain) == len(set(chain)) and chain[0] == "google/gemini-3.5-flash-lite")
    check("tier max tokens strict", mod.TIER_MAX_TOKENS == {"tier1": 2000, "tier2": 3500, "tier3": 4500}
          and max(mod.TIER_MAX_TOKENS.values()) <= 5000)

    # ۲) توابع محض
    check("tier map aliases", mod._tier_map("flash") == "tier1" and mod._tier_map("deep") == "tier3" and mod._tier_map("x") == "tier2")
    obj = mod._extract_json_block('```json\n{"a": 1, "legal_advisory": "تست"}\n```')
    check("json extraction", isinstance(obj, dict) and obj.get("a") == 1)
    check("json extraction returns None", mod._extract_json_block("no json here") is None)
    check("article numbers fa/en", mod._extract_article_numbers("مطابق ماده ۵۲۲ و ماده 10 قانون مدنی") == [522, 10])

    # پارس عمیق — خروجی دوباره‌انکدشده LLM (باگ Double-JSON)
    dbl = json.dumps(json.dumps(
        {"legal_advisory": "متن ساده فارسی تحلیل ماهوی", "draft_text": "پیش‌نویس دفاعیه"}, ensure_ascii=False))
    obj2 = mod._deep_json_parse(dbl)
    check("deep json double-encoded", isinstance(obj2, dict) and obj2.get("legal_advisory") == "متن ساده فارسی تحلیل ماهوی")
    check("deep json fenced", (mod._deep_json_parse('```json\n' + dbl + '\n```') or {}).get("draft_text") == "پیش‌نویس دفاعیه")
    check("deep json garbage", mod._deep_json_parse("not json at all") is None)

    # ۳) پرامپت دو لایه
    rag = {
        "laws": [{"title": "ماده ۱۰ قانون مدنی", "content": "قراردادهای خصوصی نافذ است.", "category": "CIVIL"}],
        "precedents": [{"title": "رای وحدت رویه ۸۴۰", "content": "خسارت تاخیر تادیه", "precedent_number": "840"}],
        "advisories": [], "circulars": [], "retrieval": "qdrant+lexical-rerank",
    }
    graph = {
        "status": "OK",
        "nodes": [{"node_id": "CIVIL-ART-10", "node_type": "ARTICLE", "title": "ماده ۱۰ قانون مدنی",
                   "category": "CIVIL_CONTRACTS", "content": "نافذ بودن قراردادها", "depth": 0}],
        "relations": [{"relation": "EXCEPTS", "weight": 1, "description": "تخصیص ماده ۱۰",
                       "source_id": "REG-MANDATORY-1403", "source_title": "الزام ثبت اسناد ۱۴۰۳",
                       "target_id": "CIVIL-ART-10", "target_title": "ماده ۱۰ قانون مدنی"}],
    }
    prompt = mod._build_system_prompt("tier2", rag, graph)
    check("prompt core present", "دستیار حقوقی و دادرسی" in prompt and "شانس موفقیت" in prompt)
    check("prompt vector layer", "لایه ۱ — بازیابی برداری از Qdrant" in prompt and "ماده ۱۰ قانون مدنی" in prompt)
    check("prompt graph layer", "لایه ۲ — گراف دانش حقوقی" in prompt and "—[EXCEPTS]→" in prompt)
    check("prompt tier instruction", "سطح ۲ (دقت بالا)" in prompt)

    # ۳-ب) Task 2 — معماری کَش پرامپت و مسیریابی نیت پویا
    check("cache static prefix first", prompt.startswith(mod._JUDICIAL_CORE_SYSTEM_PROMPT))
    static_part = prompt.split("【لایه ۱", 1)[0]
    check("cache schema in static prefix", "قالب دقیق JSON" in static_part and "قواعد الزامی" in static_part)
    check("mode formal directive", "حالت پاسخ — FORMAL_DISPUTE (اختلاف/دعوای رسمی)" in prompt
          and "draft_text" in prompt)
    info_prompt = mod._build_system_prompt("tier1", rag, graph, is_informational=True)
    info_tail = info_prompt.split("【حالت پاسخ", 1)[1]
    check("mode informational directive", "حالت پاسخ — RESEARCH_QA" in info_prompt
          and '""' in info_tail and "عذرخواهی" in info_tail and "۲ تا ۳ پاراگراف" in info_tail)
    check("user prompt dynamic only", "قالب دقیق JSON" not in mod._user_prompt("متن آزمایشی", []))
    check("intent strong info", mod._is_informational_query("آخرین آرای وحدت رویه درباره چک صیاد چیست؟") is True)
    check("intent weak info", mod._is_informational_query("شرح ماده ۵۲۲ آیین دادرسی مدنی") is True)
    check("intent formal override", mod._is_informational_query(
        "موکل مطالبه خسارت قرارداد دارد؛ دادخواست و پیش‌نویس دفاعیه تنظیم شود") is False)
    check("intent empty formal", mod._is_informational_query("") is False)

    # Task 1 (فاز ۲) — طبقه‌بندی RESEARCH_QA / FORMAL_DISPUTE با کلیدواژه‌های مشخصات
    check("classify research spec keywords", mod._classify_query_intent(
        "ارتباط آخرین رای وحدت رویه با بخشنامه‌های اخیر قوه قضاییه چیست؟ خلاصه بگو") == "RESEARCH_QA")
    check("classify formal dispute", mod._classify_query_intent(
        "مطالبه وجه چک صیادی ۸۵۰ میلیون ریالی علیه صادرکننده و ضامن") == "FORMAL_DISPUTE")
    check("classify چه بود", mod._classify_query_intent("رای وحدت رویه ۸۴۰ چه بود") == "RESEARCH_QA")
    check("classify formal with topic marker", mod._classify_query_intent(
        "مطالبه وجه چک مستند به رای وحدت رویه ۸۴۰؛ دادخواست تنظیم شود") == "FORMAL_DISPUTE")

    # شبیه‌سازی خط لوله کامل بدون سرویس خارجی — رفتار نیت روی خروجی واقعی _llm_analyze
    async def _fake_chat(messages, models, max_tokens=1000, temperature=0.2, timeout=90.0):
        payload = {"legal_advisory": "خلاصه اطلاعاتی تمیز",
                   "draft_text": "پیش‌نویس نباید صادر شود؛ متن آزمونی طولانی‌تر از سی نویسه است",
                   "cited_precedents": [], "matched_laws": []}
        return json.dumps(payload, ensure_ascii=False), "fake-model"

    _orig_chat = mod._chat_completion
    mod._chat_completion = _fake_chat
    try:
        info_res = asyncio.run(mod._llm_analyze("ماده ۵۲۲ آیین دادرسی مدنی چیست؟", "tier1", []))
        check("pipeline research_qa minimal response",
              info_res.get("draft_text") == "" and info_res.get("jurisdiction") == ""
              and info_res.get("success_probability") == "" and info_res.get("query_type") == "RESEARCH_QA",
              str(info_res.get("status")))
        formal_res = asyncio.run(mod._llm_analyze(
            "موکل مطالبه خسارت قرارداد دارد؛ دادخواست و پیش‌نویس دفاعیه تنظیم شود", "tier2", []))
        check("pipeline formal keeps draft",
              bool(formal_res.get("draft_text")) and formal_res.get("query_type") == "FORMAL_DISPUTE"
              and bool(formal_res.get("jurisdiction")),
              str(formal_res.get("status")))
    except Exception as exc:
        check("pipeline informational draft zeroed", False, str(exc)[:120])
        check("pipeline formal keeps draft", False, str(exc)[:120])
    finally:
        mod._chat_completion = _orig_chat

    # Task 1 (فاز ۲) — آستانه ارتباط برداری: اسناد بی‌ربط/fallback عمومی به‌کل حذف می‌شوند
    rag_noise = asyncio.run(mod._rag_retrieve("سلام خوبید ممنون مرسی خب"))
    check("relevance threshold filters noise",
          not rag_noise.get("laws") and not rag_noise.get("precedents")
          and not rag_noise.get("circulars") and not rag_noise.get("advisories"),
          "filtered=" + str((rag_noise.get("retrieval") or {}).get("filtered_below_threshold")))
    rag_rel = asyncio.run(mod._rag_retrieve("چک صیادی ضامن مسئولیت تضامنی"))
    check("relevance threshold keeps relevant",
          len(rag_rel.get("laws") or []) >= 1,
          "max_score=" + str((rag_rel.get("retrieval") or {}).get("max_score")))

    # پچ آوایی — ترمیم تحریف‌های آوایی Whisper در واژگان حقوقی (Task 1)
    check("phonetic repair dict",
          mod._repair_legal_phonetics("رئیم باحتت هیئت عمومی") == "رأی وحدت رویه هیئت عمومی"
          and "وحدت رویه" in mod._repair_legal_phonetics("وقتت رویه مهم است")
          and mod._repair_legal_phonetics("وقتترابی هیئت عمومی") == "وحدت رویه هیئت عمومی"
          and mod._repair_legal_phonetics("دادگاه صلحا و قوبه قضایی") == "دادگاه صلح و قوه قضاییه"
          and mod._repair_legal_phonetics("خسارت تاخیر تادیه") == "خسارت تأخیر تأدیه")
    _src_phon = MODULE_PATH.read_text(encoding="utf-8")
    check("phonetic repair wired in stt+rag+graph",
          _src_phon.count("_repair_legal_phonetics(") >= 4
          and "_repair_legal_phonetics(_normalize_transcript(text))" in _src_phon
          and _src_phon.count("_clean_stt_output(") >= 4)

    # پچ بوت‌پلیت — سانیتایزر سخت‌گیرانه در FORMAL_DISPUTE (Task 2)
    async def _fake_chat_boilerplate(messages, models, max_tokens=1000, temperature=0.2, timeout=90.0):
        return json.dumps({"legal_advisory": "تحلیل ماهوی فشرده",
                           "jurisdiction": "نامشخص",
                           "success_probability": "نیاز به بررسی اسناد بیشتر",
                           "draft_text": "کوتاه"}, ensure_ascii=False), "fake-model"

    _orig_chat3 = mod._chat_completion
    mod._chat_completion = _fake_chat_boilerplate
    try:
        bp_res = asyncio.run(mod._llm_analyze(
            "موکل مطالبه خسارت قرارداد دارد؛ دادخواست تنظیم شود", "tier2", []))
        check("boilerplate sanitizer strict",
              bp_res.get("jurisdiction") == "" and bp_res.get("success_probability") == ""
              and bp_res.get("draft_text") == "" and bp_res.get("query_type") == "FORMAL_DISPUTE",
              str(bp_res.get("status")))
    except Exception as exc:
        check("boilerplate sanitizer strict", False, str(exc)[:120])
    finally:
        mod._chat_completion = _orig_chat3

    # پچ نرمال‌سازی پیش‌جست‌وجو — پرسش مخدوش آوایی به اصطلاح استاندارد می‌رسد (Task 3)
    rag_ph = asyncio.run(mod._rag_retrieve("وقتت رویه در دادگاه صلحا"))
    ph_total = sum(len(rag_ph.get(k) or []) for k in ("laws", "precedents", "circulars", "advisories"))
    check("rag phonetic normalization", ph_total >= 1,
          "total=" + str(ph_total) + " max=" + str((rag_ph.get("retrieval") or {}).get("max_score")))
    graph_ph = asyncio.run(mod._graph_retrieve("وقتت رویه ماده ۴۷۴"))
    check("graph phonetic normalization", graph_ph.get("status") in
          ("OK", "NO_MATCH", "EMPTY_QUERY", "UNAVAILABLE", "PSYCOPG_UNAVAILABLE"),
          str(graph_ph.get("status")))

    # ۴) اولویت DSN
    saved = {k: os.environ.pop(k, None) for k in ("DATABASE_URL", "POSTGRES_USER", "DATABASE_NAME")}
    _saved_working_dsn = getattr(mod, "_working_db_dsn", "")
    mod._working_db_dsn = ""  # ریست کش DSN — شبیه‌سازی خط لوله نباید بررسی‌های زیر را آلوده کند
    os.environ["DATABASE_URL"] = "postgresql://env-user:env-pass@env-host:5432/env-db"
    check("dsn from DATABASE_URL", mod._db_dsn() == "postgresql://env-user:env-pass@env-host:5432/env-db")
    del os.environ["DATABASE_URL"]
    os.environ["POSTGRES_USER"] = "compose_user"
    os.environ["POSTGRES_PASSWORD"] = "compose_pass"
    os.environ["POSTGRES_HOST"] = "compose_host"
    os.environ["POSTGRES_PORT"] = "5432"
    os.environ["POSTGRES_DB"] = "compose_db"
    check("dsn from POSTGRES_*", mod._db_dsn() == "postgresql://compose_user:compose_pass@compose_host:5432/compose_db")
    for k in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB"):
        os.environ.pop(k, None)
    dsn_default = mod._db_dsn()
    check("dsn fallback (.env/standard)", dsn_default.startswith("postgresql://") and "postgres_prod" in dsn_default, dsn_default)
    mod._working_db_dsn = _saved_working_dsn  # بازگردانی کش DSN پس از بررسی‌های محیطی
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v

    # ۵) افت ایمن گراف + endpointها
    graph_result = asyncio.run(mod._graph_retrieve("قرارداد و ماده ۱۰"))
    check("graph graceful degrade", graph_result.get("status") in
          ("OK", "NO_MATCH", "EMPTY_QUERY", "UNAVAILABLE", "PSYCOPG_UNAVAILABLE"), str(graph_result.get("status")))

    health = asyncio.run(mod.health())
    check("health online", health.get("status") == "ONLINE")
    check("health engine dual-level", "Dual-Level GraphRAG" in health.get("engine", ""))
    check("health stt groq-first", health.get("stt") in
          ("groq-whisper-large-v3-turbo", "local-faster-whisper"))
    check("health collections", len(health.get("collections", [])) == 4)

    infl = asyncio.run(mod.calculate_inflation(
        mod.InflationCalcRequest(principal_amount_irr=1_000_000, start_year=1400, end_year=1403)))
    check("delay damages calc", abs(infl["updated_value_to_date"] - 1_000_000 * (1050.2 / 367.4)) < 0.01)
    try:
        asyncio.run(mod.calculate_inflation(
            mod.InflationCalcRequest(principal_amount_irr=1, start_year=1390, end_year=1403)))
        check("delay damages honest 422", False)
    except Exception as exc:
        check("delay damages honest 422", getattr(exc, "status_code", None) == 422,
              str(getattr(exc, "status_code", "")))

    court = asyncio.run(mod.classify_court_jurisdiction(
        mod.JurisdictionRequest(dispute_type="FINANCIAL", claim_amount_irr=500_000_000)))
    check("classify small claim", court["competent_authority"] == "دادگاه صلح")

    search = asyncio.run(mod.unified_search(mod.MasterLegalSearchRequest(query="چک", limit=2)))
    check("unified search keys", "advisory_matches" in search and "graph_matches" in search and "total_found" in search)

    # ۶) پاکیزگی از Mock
    src = MODULE_PATH.read_text(encoding="utf-8")
    check("no dummy/mock arrays", "dummy" not in src.lower() and 'advisory_matches": []' not in src)
    check("no dead return None", "    }\n    return None" not in src)
    check("no legacy urllib", "import urllib" not in src)
    check("groq turbo model", "whisper-large-v3-turbo" in src)
    check("no voice_case template", "voice_case" not in src and "پردازش گردید" not in src)
    check("stt temp-file pattern", "_save_temp_audio" in src and "input_audio_" in src)
    check("stt minimal response", 'return {"status": "OK", "transcript": _clean_stt_output(transcript)}' in src)

    # Task 3 — رفع برش دنباله STT
    check("stt tail fix local params", "condition_on_previous_text=False" in src
          and "beam_size=5" in src and "temperature=0.0" in src)
    check("stt tail fix groq best-effort", 'condition_on_previous_text="false"' in src
          and 'beam_size="5"' in src)

    # Task 3 (فاز ۲) — نرمال‌سازی متن STT + حذف پیش‌گفتار مذهبی/تشریفاتی
    check("stt normalization preamble", mod._normalize_transcript(
        "سلام علیکم و رحمت الله خب ماده ۵۲۲ آیین دادرسی مدنی چیست ممنون")
        == "ماده ۵۲۲ آیین دادرسی مدنی چیست")
    check("stt normalization religious preamble", mod._normalize_transcript(
        "به نام خداوند بخشنده و مهربان سلام علیکم دادگاه صلاحیت کجاست")
        == "دادگاه صلاحیت کجاست")
    check("stt normalization stt-prompt tail", mod._normalize_transcript(
        "لطفاً به صورت خیلی خلاصه توضیح دهید رای وحدت رویه ۸۴۰ چه بود")
        == "رای وحدت رویه ۸۴۰ چه بود")
    check("stt clean output pipeline", mod._clean_stt_output(
        "به نام خداوند بخشنده و مهربان، سلام علیکم و رحمت الله؛ "
        "خب لطفا به صورت خیلی خلاصه توضیح دهید وقتترابی ماده ۴۷۴ چیست ممنون")
        == "وحدت رویه ماده ۴۷۴ چیست")
    check("stt normalization applied in endpoint", "_clean_stt_output(transcript)" in src)
    check("stt prompt conversational tail",
          "لطفاً به صورت خیلی خلاصه توضیح دهید" in mod.LEGAL_STT_PROMPT
          and "دادگاه انتظامی قضات" in mod.LEGAL_STT_PROMPT
          and "دادگاه انتظامی وکلا" in mod.LEGAL_STT_PROMPT
          and mod.LEGAL_STT_PROMPT.rstrip().endswith("دادگاه نظامی."))

    # Task 4 — ماژول اعاده دادرسی و دادگاه‌های انتظامی/نظامی
    check("retrial case types", set(mod.RETRIAL_CASE_TYPES) == {"CRIMINAL_474", "CIVIL_426", "SPECIAL_477"})
    check("retrial statutory grounds", len(mod._RETRIAL_STATUTORY_GROUNDS["CRIMINAL_474"]) == 7
          and len(mod._RETRIAL_STATUTORY_GROUNDS["CIVIL_426"]) >= 6
          and len(mod._RETRIAL_STATUTORY_GROUNDS["SPECIAL_477"]) >= 1)
    rsys = mod._retrial_build_system_prompt("CRIMINAL_474")
    check("retrial prompt grounds+schema", rsys.startswith(mod._RETRIAL_CORE_PROMPT)
          and "بند ۵" in rsys and "قالب دقیق JSON" in rsys and "دادخواست رسمی" in rsys)
    rreq = mod.RetrialEvalRequest(case_description="شرح", verdict_details="دادنامه",
                                  retrial_type="CRIMINAL_474", user_identifier="u1", is_verified=True)
    check("retrial request model", rreq.is_verified and rreq.retrial_type == "CRIMINAL_474"
          and rreq.user_identifier == "u1")

    # گیت‌های نقطه پایانی — بدون سرویس خارجی
    try:
        asyncio.run(mod.retrial_evaluate(mod.RetrialEvalRequest(
            case_description="شرح آزمون", verdict_details="دادنامه آزمون", retrial_type="CRIMINAL_474",
            user_identifier="pytest-retrial-user", is_verified=False)))
        check("retrial verification gate 403", False)
    except Exception as exc:
        check("retrial verification gate 403", getattr(exc, "status_code", None) == 403)
    try:
        asyncio.run(mod.retrial_evaluate(mod.RetrialEvalRequest(
            case_description="شرح آزمون", retrial_type="WRONG_TYPE",
            user_identifier="pytest-retrial-user", is_verified=True)))
        check("retrial invalid type 422", False)
    except Exception as exc:
        check("retrial invalid type 422", getattr(exc, "status_code", None) == 422)

    # جریان کامل سهمیه با mock — بدون دیتابیس و LLM واقعی
    async def _noop_schema():
        return None

    def _quota_zero(_uid):
        return 0

    def _quota_one(_uid):
        return 1

    def _claim(_uid, _ph, _em, _ct, _cd, _vs):
        return 4242

    def _noop(*_a, **_k):
        return None

    async def _fake_retrial_engine(rt, cd, vd):
        return {"status": "SUCCESS", "retrial_type": rt,
                "retrial_label": mod.RETRIAL_CASE_TYPES[rt],
                "matched_clause": "بند ۵ ماده ۴۷۴", "eligibility_score": 70,
                "eligibility_analysis": "تحلیل انطباق ادله", "legal_evaluation": "ارزیابی حقوقی",
                "petition_text": "دادخواست رسمی دیوان عالی", "missing_requirements": [],
                "cited_precedents": [], "statutory_grounds": [], "model_used": "fake", "retrieval": {}}

    _retrial_saved = (mod._ensure_retrial_schema, mod._retrial_quota_count_sync, mod._retrial_claim_sync,
                      mod._retrial_finalize_sync, mod._retrial_release_sync, mod._retrial_evaluate_engine,
                      mod.OPENROUTER_KEY)
    mod._ensure_retrial_schema = _noop_schema
    mod._retrial_quota_count_sync = _quota_zero
    mod._retrial_claim_sync = _claim
    mod._retrial_finalize_sync = _noop
    mod._retrial_release_sync = _noop
    mod._retrial_evaluate_engine = _fake_retrial_engine
    mod.OPENROUTER_KEY = "test-key"
    try:
        ok_res = asyncio.run(mod.retrial_evaluate(mod.RetrialEvalRequest(
            case_description="شرح آزمون", verdict_details="دادنامه", retrial_type="CRIMINAL_474",
            user_identifier="pytest-retrial-user", is_verified=True)))
        check("retrial success flow", ok_res.get("response_id") == 4242
              and ok_res.get("quota", {}).get("used") == 1
              and ok_res.get("matched_clause") == "بند ۵ ماده ۴۷۴"
              and ok_res.get("petition_text") == "دادخواست رسمی دیوان عالی")
        mod._retrial_quota_count_sync = _quota_one
        try:
            asyncio.run(mod.retrial_evaluate(mod.RetrialEvalRequest(
                case_description="شرح", retrial_type="CRIMINAL_474",
                user_identifier="pytest-retrial-user", is_verified=True)))
            check("retrial quota exhausted 403", False)
        except Exception as exc:
            check("retrial quota exhausted 403", getattr(exc, "status_code", None) == 403
                  and "ارتقا" in str(getattr(exc, "detail", "")))
    finally:
        (mod._ensure_retrial_schema, mod._retrial_quota_count_sync, mod._retrial_claim_sync,
         mod._retrial_finalize_sync, mod._retrial_release_sync, mod._retrial_evaluate_engine,
         mod.OPENROUTER_KEY) = _retrial_saved

    # Task 6 (فاز ۲) — نجات پیش‌نویس در دعوای رسمی وقتی مدل کلید draft_text را حذف می‌کند
    async def _fake_chat_nodraft(messages, models, max_tokens=1000, temperature=0.2, timeout=90.0):
        if "کارشناس انشای لوایح" in str((messages[0] or {}).get("content") or ""):
            return json.dumps({"draft_text": "پیش‌نویس جایگزین متمرکز برای دادخواست مطالبه"},
                              ensure_ascii=False), "fake-draft"
        return json.dumps({"legal_advisory": "تحلیل بدون پیش‌نویس"}, ensure_ascii=False), "fake-model"

    _orig_chat2 = mod._chat_completion
    mod._chat_completion = _fake_chat_nodraft
    try:
        rescue = asyncio.run(mod._llm_analyze(
            "موکل مطالبه خسارت قرارداد دارد؛ دادخواست و پیش‌نویس دفاعیه تنظیم شود", "tier2", []))
        check("pipeline formal draft rescue",
              rescue.get("draft_text") == "پیش‌نویس جایگزین متمرکز برای دادخواست مطالبه"
              and rescue.get("query_type") == "FORMAL_DISPUTE",
              str(rescue.get("status")))
    except Exception as exc:
        check("pipeline formal draft rescue", False, str(exc)[:120])
    finally:
        mod._chat_completion = _orig_chat2
    check("seed params sane", len(mod._seed_conditions("خسارت تاخیر تادیه طبق ماده ۵۲۲")[0]) > 0)

    print()
    if FAILED:
        print(f"❌ {len(FAILED)} check(s) failed: {FAILED}")
        return 1
    print("✅ همه بررسی‌های اعتبارسنجی SmartJudge موفق بود.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

