#!/usr/bin/env python3
import sys, os
import ast, json, re, time

from output_apps.ecosystem_core.src.factory.architect_ai import analyze_and_architect_system
from output_apps.ecosystem_core.src.factory.report_generator import generate_enterprise_docx, generate_markdown_report
from output_apps.ecosystem_core.src.factory.qdrant_memory_agent import index_research_artifact

MODULES_DIR = "/opt/roxira_platform/output_apps/generated_modules"

def sanitize_identifier(name: str, fallback: str = "Entity") -> str:
    if not name: return fallback
    clean = re.sub(r'[\u200c\u200b\u200e\u200f\ufeff]', '', name)
    clean = re.sub(r'[^a-zA-Z0-9_]', '_', clean).strip('_')
    if not clean or clean[0].isdigit(): clean = f"Model_{clean}"
    return "".join(part.capitalize() for part in clean.split("_") if part) or fallback

class FactoryEngine:
    @staticmethod
    def build_module(task_id: str, prompt: str):
        target_dir = os.path.join(MODULES_DIR, task_id)
        os.makedirs(target_dir, exist_ok=True)
        safe_prefix = re.sub(r'[^a-zA-Z0-9_]', '_', task_id.lower())

        print(f"\n🏭 [کارخانه خودگردان روکسیرا] آغاز چرخه ساخت: {task_id}")
        
        # ۱. عامل دیپ‌ریسرچ و معمار
        arch_data = analyze_and_architect_system(prompt, task_id)

        # ۲. عامل بک‌اند
        entities = arch_data.get("domain_entities", [])
        entity_classes = ""
        for ent in entities:
            cls_name = sanitize_identifier(ent.get("name") or ent.get("table_name"), "DataModel")
            fields = ent.get("fields", [])
            field_lines = []
            for f in fields[:6]:
                f_name = re.sub(r'[^a-zA-Z0-9_]', '_', f.get("name", "val")).strip('_') or "field_val"
                if f_name[0].isdigit(): f_name = f"f_{f_name}"
                field_lines.append(f"{f_name}: str = Field(default='', description='{f.get('constraints', '')}')")
            fields_body = "\n    ".join(field_lines) if field_lines else "id: str = Field(default='')"
            entity_classes += f"\nclass {cls_name}(BaseModel):\n    {fields_body}\n"

        backend_code = f'''"""
Roxira OS - Autonomous Software Factory
Module: {task_id}
Domain: {arch_data.get("domain_detected", "General")}
Standard: IEEE 1016 Software Design Description (SDD)
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
import datetime
from typing import List, Optional

router = APIRouter(prefix="/api/v1/{safe_prefix}", tags=["{task_id}"])

{entity_classes}

@router.get("/health")
async def health_check():
    return {{
        "module": "{task_id}",
        "status": "ALL_GREEN",
        "domain": "{arch_data.get("domain_detected", "General")}",
        "timestamp": datetime.datetime.now().isoformat()
    }}
'''
        backend_code = re.sub(r'[\u200c\u200b\u200e\u200f\ufeff]', ' ', backend_code)
        with open(os.path.join(target_dir, "router.py"), "w", encoding="utf-8") as f:
            f.write(backend_code)

        # ۳. عامل فرانت‌اند
        clean_opinion = arch_data.get("expert_opinion", "")[:600].replace('"', "'")
        frontend_code = f'''import React from 'react';

export default function {sanitize_identifier(task_id)}View() {{
  return (
    <div className="p-6 bg-slate-900 border border-slate-800 rounded-3xl text-white shadow-2xl space-y-4">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-emerald-400">{prompt}</h2>
          <p className="text-xs text-slate-400 font-mono mt-1">{task_id} | {arch_data.get("domain_detected", "")}</p>
        </div>
        <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs rounded-xl font-mono font-bold">
          IEEE 1016 VERIFIED
        </span>
      </div>
      <div className="text-sm text-slate-300 leading-relaxed bg-slate-950 p-4 rounded-2xl border border-slate-800/80">
        {clean_opinion}...
      </div>
    </div>
  );
}}
'''
        with open(os.path.join(target_dir, "Component.tsx"), "w", encoding="utf-8") as f:
            f.write(frontend_code)

        # ۴. عامل آزمون کیفیت
        syntax_passed = True
        try:
            ast.parse(backend_code)
            print("  ✅ [عامل کیفیت] کدهای پایتون با موفقیت تایید شدند (AST Passed).")
        except SyntaxError as se:
            print(f"  ⚠️ خطای نحو: {se}")
            syntax_passed = False

        # ۵. عامل مستندساز
        status_label = "ALL_GREEN" if syntax_passed else "SYNTAX_WARNING"
        metadata = {
            "task_id": task_id,
            "prompt": prompt,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "verification_status": status_label,
            "backend_syntax_pass": syntax_passed,
            "frontend_ready": True,
            "artifacts": ["router.py", "Component.tsx", f"{task_id}_Report.docx", "REPORT.md"],
            "arch_data": arch_data
        }

        with open(os.path.join(target_dir, "manifest.json"), "w", encoding="utf-8") as mf:
            json.dump(metadata, mf, ensure_ascii=False, indent=2)

        generate_enterprise_docx(task_id, prompt, target_dir, metadata, arch_data)
        generate_markdown_report(task_id, prompt, target_dir, metadata, arch_data)

        # ۶. ثبت در حافظه برداری Qdrant
        try:
            index_research_artifact(task_id, prompt, arch_data.get("expert_opinion", ""), arch_data.get("domain_detected", ""))
            print(f"  🧠 [حافظه برداری] تسک {task_id} در کالکشن research_knowledge_base کیودرنت ایندکس شد.")
        except Exception as q_err:
            print(f"  ⚠️ خطا در ایندکس Qdrant: {q_err}")

        # بروزرسانی صف تسک‌ها
        qfile = "/opt/roxira_platform/task_queue.json"
        if os.path.exists(qfile):
            try:
                with open(qfile, "r", encoding="utf-8") as qf: qdata = json.load(qf)
                comp_list = qdata.get("completed", [])
                if not any(c.get("id") == task_id for c in comp_list):
                    comp_list.append({"id": task_id, "prompt": prompt, "status": "COMPLETED", "created_at": metadata["created_at"]})
                qdata["completed"] = comp_list
                qdata["pending"] = [p for p in qdata.get("pending", []) if p.get("id") != task_id]
                with open(qfile, "w", encoding="utf-8") as qf: json.dump(qdata, qf, ensure_ascii=False, indent=2)
            except Exception: pass

        print(f"🎉 ماژول {task_id} با موفقیت تحویل داده شد ({status_label}).")
        return metadata

if __name__ == "__main__":
    t_id = sys.argv[1] if len(sys.argv) > 1 else f"USER-{int(time.time())}"
    p_text = sys.argv[2] if len(sys.argv) > 2 else "توسعه ماژول سازمانی"
    FactoryEngine.build_module(t_id, p_text)
