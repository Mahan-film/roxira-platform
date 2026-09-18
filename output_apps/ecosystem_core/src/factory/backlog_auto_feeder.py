#!/usr/bin/env python3
"""
Roxira Auto-Backlog Feeder
موتور خودکار تولید اهداف مهندسی و تکمیل نقشه راه سازمانی در نبود دستور کاربر
"""
import json
import os
import time

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"

ROADMAP_PIPELINE = [
    {
        "id": "PROJ-102",
        "prompt": "پیاده‌سازی ماژول ارسال خودکار فاکتورهای الکترونیکی به سامانه مودیان مالیاتی با امضای دیجیتال کلید خصوصی",
        "priority": "HIGH"
    },
    {
        "id": "PROJ-103",
        "prompt": "طراحی موتور هوشمند تطبیق قراردادها با ماده ۱۰ قانون مدنی و قوانین بالادستی تجارت الکترونیک",
        "priority": "HIGH"
    },
    {
        "id": "PROJ-104",
        "prompt": "پیاده‌سازی هسته تسعیر خودکار چندارزی بر پایه استاندارد ISO 4217 با بافر ایمن هجینگ تتر",
        "priority": "MEDIUM"
    },
    {
        "id": "PROJ-105",
        "prompt": "طراحی ماژول چندسکویی ارزیابی ادله اثبات دعوی در دادگاه‌های صلح مبتنی بر Tauri 2.0",
        "priority": "MEDIUM"
    }
]

def ensure_backlog_stocked():
    if not os.path.exists(QUEUE_FILE):
        return
    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    pending = data.get("pending", [])
    completed_ids = [t.get("id") for t in data.get("completed", [])]

    if not pending:
        for candidate in ROADMAP_PIPELINE:
            if candidate["id"] not in completed_ids:
                print(f"🎯 [Backlog Feeder] تولید خودکار تسک راهبردی بعدی: {candidate['id']}")
                print(f"   شرح تسک: {candidate['prompt']}")
                data["pending"].append({
                    "id": candidate["id"],
                    "prompt": candidate["prompt"],
                    "status": "QUEUED",
                    "auto_generated": True,
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC")
                })
                break
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    ensure_backlog_stocked()
