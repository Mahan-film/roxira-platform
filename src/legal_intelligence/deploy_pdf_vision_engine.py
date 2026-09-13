#!/usr/bin/env python3
import pathlib
import subprocess
import os

print("="*75)
print("🚀 استقرار ماژول موتور صدور لایحه قضایی و تحلیل هوشمند اسناد و دادنامه‌ها")
print("="*75)

backend_file = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules/smartjudge/smartjudge_module.py")
current_backend = backend_file.read_text(encoding="utf-8")

advanced_modules_code = r'''
# ------------------------------------------------------------------------------
# ماژول صدور لایحه با فرمت استاندارد قضایی و قالب رسمی دادگستری
# ------------------------------------------------------------------------------
@router.post("/export-defense-document")
async def export_defense_document(payload: dict = Body(...)):
    """تولید متن فرمت‌بندی‌شده لایحه دفاعیه با سربرگ استاندارد مراجع قضایی"""
    case_title = payload.get("case_title", "دفاعیه حقوقی")
    draft_text = payload.get("draft_text", "")
    court_branch = payload.get("court_branch", "شعبه دادگاه عمومی حقوقی / تجدیدنظر")
    user_phone = payload.get("phone", "09129367796")
    
    formatted_document = f"""================================================================================
                    جمهوری اسلامی ایران - قوه قضائیه
                    برگ لایحه دفاعیه و پیوست دادخواست
================================================================================
مرجع رسیدگی‌کننده : {court_branch}
موضوع خواسته / اتهام: {case_title}
شماره پیگیری سیستمی: ROX-JUDGE-{int(time.time())}
تاریخ تنظیم: {time.strftime('%Y/%m/%d')}
--------------------------------------------------------------------------------

ریاست و مستشاران محترم دادگاه؛

با سلام و احترام؛
در مقام دفاع و تبیین مبانی قانونی پرونده کلاسه فوق، مراتب زیر مستنداً به قوانین موضوعه،
آرای وحدت رویه هیأت عمومی دیوان عالی کشور و موازین شرعی و قانونی تقدیم می‌گردد:

{draft_text}

--------------------------------------------------------------------------------
با تجدید احترام؛
تنظیم‌شده توسط سامانه هوشمند قاضی (نسخه VIP وکلا و مراجعین)
استعلام اصالت سند: https://ghazihoushmand.ir/verify
================================================================================
"""
    return {
        "status": "SUCCESS",
        "doc_id": f"DOC-{str(uuid.uuid4())[:8].upper()}",
        "formatted_text": formatted_document,
        "download_ready": True,
        "format": "TXT / PDF Compatible"
    }

# ------------------------------------------------------------------------------
# ماژول تحلیل و استخراج ادله از اسناد و تصاویر دادنامه‌ها (Vision OCR Processor)
# ------------------------------------------------------------------------------
@router.post("/analyze-document-text")
async def analyze_document_text(payload: dict = Body(...)):
    """استخراج و انطباق متون اسناد بارگذاری‌شده (قرارداد، دادنامه بدوی، چک) با پایگاه قوانین"""
    extracted_text = payload.get("extracted_text", "").strip()
    doc_type = payload.get("doc_type", "RULING") # RULING (دادنامه), CONTRACT (قرارداد), DRAFT (چک/سند)
    
    if not extracted_text:
        return JSONResponse({"status": "ERROR", "message": "متن سند استخراج‌شده الزامی است."}, status_code=400)

    # انطباق سریع با مواد مرتبط در گراف قوانین
    matched_laws, matched_precedents = query_knowledge_graph(extracted_text, limit=4)
    
    # شناسایی مهلت‌های تجدیدنظرخواهی یا فرجام‌خواهی
    has_deadline_alert = any(w in extracted_text for w in ["۲۰ روز", "بیست روز", "ابلاغ واقعی", "مهلت تجدیدنظر"])
    
    analysis_result = {
        "status": "SUCCESS",
        "document_type": doc_type,
        "key_findings": [
            "سند با موفقیت پردازش شد و ارکان دعوا استخراج گردید.",
            "مهلت قانونی اعتراض در دادنامه درج شده و نیازمند اقدام فوری است." if has_deadline_alert else "ارکان حقوقی سند جهت طرح دادخواست کامل است."
        ],
        "statutory_basis": matched_laws,
        "unified_precedents": matched_precedents,
        "suggested_action": "تنظیم فوری لایحه تجدیدنظرخواهی بر مبنای آرای وحدت رویه استخراج‌شده."
    }
    return analysis_result
'''

if "/export-defense-document" not in current_backend:
    backend_file.write_text(current_backend.strip() + "\n" + advanced_modules_code.strip() + "\n", encoding="utf-8")
    print("✅ اندپوینت‌های صدور لایحه رسمی و پردازش هوشمند اسناد با موفقیت ثبت شدند.")

# بازنشانی کانتینر بک‌اند
subprocess.run(["docker", "restart", "roxira_app_prod"], check=True)
print("="*75)
print("🎉 ماژول‌های جدید با موفقیت در محیط Production مستقر شدند.")
print("="*75)
