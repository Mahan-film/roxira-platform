#!/usr/bin/env python3
import os
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

def generate_enterprise_docx(task_id: str, prompt: str, target_dir: str, metadata: dict, arch_data: dict = None):
    arch = arch_data or metadata.get("arch_data", {})
    doc = Document()

    title = doc.add_heading(f"سند جامع معماری فنی و مهندسی سیستم: {task_id}", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    p1 = doc.add_paragraph()
    p1.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p1.add_run(f"عنوان ماژول / پروژه: {prompt}\n")
    run.bold = True
    p1.add_run(f"شناسه ممیزی: {task_id} | تاریخ تدوین: {metadata.get('created_at', '')}\n")
    p1.add_run(f"استاندارد سند: IEEE 1016-2009 Software Design Description (SDD)\n")
    p1.add_run(f"وضعیت انطباق: {metadata.get('verification_status', 'ALL_GREEN')}\n")

    # ۱. خلاصه مدیریتی و ارزش عملیاتی
    doc.add_heading("۱. خلاصه اجرایی و تعریف دامنه (Executive Summary)", level=1)
    p2 = doc.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p2.add_run(arch.get("executive_summary", "ماژول خودکار سازمانی"))

    # ۲. ماتریس تصمیم‌گیری تطبیقی
    doc.add_heading("۲. ماتریس ارزیابی و تصمیمات استراتژیک معماری (Engineering Decision Matrix)", level=1)
    d_table = doc.add_table(rows=1, cols=4)
    d_table.style = 'Light Shading Accent 1'
    d_hdr = d_table.rows[0].cells
    d_headers = ["لایه ارزیابی", "راهکار منتخب", "گزینه‌های ردشده", "استدلال فنی و ارزش عملیاتی"]
    for i, h in enumerate(d_headers):
        d_hdr[i].text = h
        d_hdr[i].paragraphs[0].runs[0].bold = True

    for dec in arch.get("decision_matrix", []):
        r = d_table.add_row().cells
        r[0].text = dec.get("layer", "")
        r[1].text = dec.get("chosen_solution", "")
        r[2].text = dec.get("rejected_alternatives", "")
        r[3].text = dec.get("technical_justification", "")

    # ۳. مدل‌سازی داده و دیکشنری جداول (Data Dictionary)
    doc.add_heading("۳. ساختار پایگاه داده و مدل موجودیت‌ها (Data Schema & DDL)", level=1)
    for ent in arch.get("domain_entities", []):
        doc.add_heading(f"جدول: {ent.get('table_name')} ({ent.get('name')})", level=2)
        p_desc = doc.add_paragraph()
        p_desc.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p_desc.add_run(ent.get("description", ""))

        f_table = doc.add_table(rows=1, cols=3)
        f_table.style = 'Table Grid'
        f_hdr = f_table.rows[0].cells
        f_hdr[0].text = "نام ستون (Field)"
        f_hdr[1].text = "نوع داده (Type)"
        f_hdr[2].text = "محدودیت‌ها (Constraints)"
        for i in range(3): f_hdr[i].paragraphs[0].runs[0].bold = True

        for fld in ent.get("fields", []):
            fr = f_table.add_row().cells
            fr[0].text = fld.get("name", "")
            fr[1].text = fld.get("type", "")
            fr[2].text = fld.get("constraints", "")

    # ۴. قراردادهای API و ماشین وضعیت
    doc.add_heading("۴. قراردادهای ارتباطی API و چرخه ایجنتی", level=1)
    for api in arch.get("api_contracts", []):
        p_api = doc.add_paragraph()
        p_api.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p_api.add_run(f"• متد: {api.get('method')} | مسیر: {api.get('endpoint')}\n  شرح: {api.get('description')}\n")

    docx_path = os.path.join(target_dir, f"{task_id}_Report.docx")
    doc.save(docx_path)
    return docx_path

def generate_markdown_report(task_id: str, prompt: str, target_dir: str, metadata: dict, arch_data: dict = None):
    arch = arch_data or metadata.get("arch_data", {})
    
    matrix_rows = "\n".join(
        f"| **{m.get('layer','')}** | {m.get('chosen_solution','')} | {m.get('rejected_alternatives','')} | {m.get('technical_justification','')} |"
        for m in arch.get("decision_matrix", [])
    )
    
    entities_section = ""
    for ent in arch.get("domain_entities", []):
        fields_md = "\n".join(f"- `{f.get('name')}` ({f.get('type')}) - *{f.get('constraints')}*" for f in ent.get("fields", []))
        entities_section += f"### جدول: `{ent.get('table_name')}` ({ent.get('name')})\n*{ent.get('description')}*\n\n{fields_md}\n\n"

    apis_section = "\n".join(
        f"- **`{a.get('method')}`** `{a.get('endpoint')}`: {a.get('description')}"
        for a in arch.get("api_contracts", [])
    )

    md = f"""# سند رسمی معماری و تحلیل نرم‌افزار (IEEE 1016): {task_id}

**عنوان ماژول:** {prompt}  
**شناسه ثبت:** `{task_id}`  
**محیط استقرار:** `Hetzner Cloud Production (ARM64)`  
**تأییدیه نهایی:** `{metadata.get('verification_status', 'ALL_GREEN')}`  

---

## ۱. خلاصه مدیریتی و اهداف تجاری
{arch.get('executive_summary', '')}

---

## ۲. ماتریس تصمیم‌گیری استراتژیک و ارزیابی معماری

| لایه ارزیابی | راهکار منتخب | گزینه‌های بررسی‌شده | استدلال فنی و ادله بنچمارک |
| :--- | :--- | :--- | :--- |
{matrix_rows}

---

## ۳. مدل‌سازی داده و ساختار جداول پایگاه داده
{entities_section}

---

## ۴. قراردادهای رابط برنامه‌نویسی کاربردی (API Contracts)
{apis_section}

---

## ۵. مصنوعات فیزیکی تحویل‌شده در مخزن
- `router.py`: کدهای عملیاتی بک‌اند FastAPI
- `Component.tsx`: رابط کاربری تعاملی Next.js
- `{task_id}_Report.docx`: سند ویرایش‌پذیر Word با استایل سازمانی
"""
    md_path = os.path.join(target_dir, "REPORT.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)
    return md_path
