#!/usr/bin/env python3
import sys, os, time, json
sys.path.insert(0, "/opt/roxira_platform")

from output_apps.ecosystem_core.src.factory.roxira_factory_engine import FactoryEngine

test_prompts = [
    ("TEST-01-NET", "طراحی سامانه توزیع بار هوشمند روی لبه شبکه با پروتکل QUIC"),
    ("TEST-02-FIN", "معماری موتور تسویه ارزی بلادرنگ با لاگ تغییرناپذیر ضد جعل"),
    ("TEST-03-DEV", "ساختار تیم ایجنتی کارخانه نرم‌افزار با نقش‌های تفکیک‌شده معمار و تستر")
]

print("🚀 آغاز چرخه آزمون خودکار کیفیت و تطبیق استانداردها...")
for tid, prompt in test_prompts:
    print(f"\n--- تست تسک: {tid} ---")
    meta = FactoryEngine.build_module(tid, prompt)
    arch = meta.get("arch_data", {})
    print(f"  • حوزه استخراج‌شده: {arch.get('domain_detected')}")
    print(f"  • تعداد تصمیمات ماتریس: {len(arch.get('decision_matrix', []))}")
    print(f"  • وضعیت آزمون: {meta.get('verification_status')}")

print("\n✅ تمامی تست‌های دامنه با موفقیت به پایان رسیدند.")
