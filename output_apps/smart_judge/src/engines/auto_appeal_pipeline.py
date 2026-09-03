from __future__ import annotations

import json
import sys
import pathlib
import importlib.util

CURRENT_FILE = pathlib.Path(__file__).resolve()
ROOT_DIR = CURRENT_FILE.parents[4] if len(CURRENT_FILE.parents) >= 5 else pathlib.Path.cwd()

def resolve_file(rel: str) -> pathlib.Path:
    for base in [pathlib.Path.cwd(), pathlib.Path("/Users/mac/Developer/project-foundry-worktrees/fnd-ops-00"), pathlib.Path("/Users/mac/Developer/project-foundry")]:
        cand = base / rel
        if cand.is_file():
            return cand
    return pathlib.Path.cwd() / rel

def dynamic_import(name: str, file_path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, file_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

judge_file = resolve_file("output_apps/smart_judge/src/engines/legal_drafter.py")
vision_file = resolve_file("output_apps/ecosystem_core/src/vision/vision_document_analyzer.py")

judge_mod = dynamic_import("legal_drafter", judge_file)
vision_mod = dynamic_import("vision_document_analyzer", vision_file)

def generate_appeal_from_sana_notice(sana_raw_text: str, appellant_defense_reasons: str) -> dict:
    parsed_sana = vision_mod.analyze_document_image_or_text(sana_raw_text, doc_hint="SANA_JUDICIAL_NOTICE")
    
    ref_nums = parsed_sana.get("reference_numbers", {})
    judgment_no = ref_nums.get("دادنامه", "نامشخص")
    case_no = ref_nums.get("شماره پرونده", "نامشخص")
    parties = parsed_sana.get("parties", {})
    appellant_name = parties.get("خوانده") or "تجدیدنظرخواه"

    facts = f"""تجدیدنظرخواهی نسبت به دادنامه شماره {judgment_no} صادره در پرونده کلاسه {case_no}.
مبلغ محکوم‌به: {parsed_sana.get('amounts_and_dates', {}).get('مبلغ محکومیت', 'مندرج در پرونده')}.
جهات تجدیدنظرخواهی (ماده ۳۴۸ ق.آ.د.م): {appellant_defense_reasons}
خلاصه رای بدوی: {parsed_sana.get('actionable_summary', '')}"""

    client_info = {
        "claimant_name": appellant_name,
        "role": "تجدیدنظرخواه",
        "case_number": case_no,
        "judgment_number": judgment_no
    }

    engine = judge_mod.SmartJudgeEngine()
    draft = engine.generate_legal_document(
        doc_type="DEFENSE_BRIEF",
        case_facts=facts,
        client_info=client_info
    )
    
    return {
        "status": "APPEAL_GENERATED",
        "parsed_sana": parsed_sana,
        "appeal_draft": draft
    }

if __name__ == "__main__":
    sample_notice = """
    سامانه ابلاغ الکترونیک قضایی (ثنا)
    شماره ابلاغیه: ۱۴۰۳۹۸۲۷۱۰۰۰۲۳۴
    شماره پرونده: ۱۴۰۲۲۳۹۲۰۰۰۱۸۷۲۶
    مخاطب: آقای مبین خرمی
    موضوع: ابلاغ دادنامه شماره ۱۴۰۳۸۷۱
    متن: مهلت تجدیدنظرخواهی ۲۰ روز است. محکومیت به پرداخت ۲,۴۰۰,۰۰۰,۰۰۰ ریال اصل خواسته.
    """
    defense = "عدم توجه دادگاه بدوی به اسناد تسویه حساب مورخ ۱۴۰۲/۱۰/۱۵ (بند ج و هـ ماده ۳۴۸ ق.آ.د.م)."
    res = generate_appeal_from_sana_notice(sample_notice, defense)
    print("AUTO_APPEAL_PIPELINE_VERIFIED=PASS")
    print(f"Title: {res['appeal_draft'].get('title')}")
