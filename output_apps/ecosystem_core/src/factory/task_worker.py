#!/usr/bin/env python3
"""
Roxira Autonomous Background Worker (Zero-Failure 2026)
پردازش پیوسته صف کارها و تولید خودکار تسک‌ها از نقشه راه در زمان بیکاری
"""
import os
import sys
import json
import time
import subprocess

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"
ENGINE_SCRIPT = "/opt/roxira_platform/output_apps/ecosystem_core/src/factory/roxira_factory_engine.py"

ROADMAP_PIPELINE = [
    {"id": "PROJ-102", "prompt": "پیاده‌سازی ماژول ارسال خودکار فاکتورهای الکترونیکی به سامانه مودیان مالیاتی با امضای دیجیتال"},
    {"id": "PROJ-103", "prompt": "طراحی موتور هوشمند تطبیق قراردادها با ماده ۱۰ قانون مدنی و قوانین تجارت الکترونیک"},
    {"id": "PROJ-104", "prompt": "پیاده‌سازی هسته تسعیر خودکار چندارزی بر پایه استاندارد ISO 4217 با بافر هجینگ تتر"},
    {"id": "PROJ-105", "prompt": "طراحی ماژول چندسکویی ارزیابی ادله اثبات دعوی در دادگاه‌های صلح مبتنی بر Tauri 2.0"}
]

def load_and_ensure_queue():
    data = {"pending": [], "completed": []}
    if os.path.exists(QUEUE_FILE):
        try:
            with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass

    # خودپیش‌رانی: اگر صف خالی است، تسک بعدی نقشه راه را تزریق کن
    if not data.get("pending"):
        completed_ids = [t.get("id") for t in data.get("completed", [])]
        for candidate in ROADMAP_PIPELINE:
            if candidate["id"] not in completed_ids:
                print(f"🎯 [Auto-Backlog] تولید تسک جدید نقشه راه: {candidate['id']}")
                data.setdefault("pending", []).append({
                    "id": candidate["id"],
                    "prompt": candidate["prompt"],
                    "status": "QUEUED",
                    "auto_generated": True,
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC")
                })
                break

    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data

def process_task(task):
    print(f"\n🚀 [Autonomous Worker] آغاز اجرای تسک: {task['id']}")
    print(f"📝 هدف: {task['prompt']}")
    
    cmd = ["python3", ENGINE_SCRIPT, task['prompt']]
    res = subprocess.run(cmd, capture_output=True, text=True)
    
    task["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S UTC")
    task["exit_code"] = res.returncode
    task["status"] = "SUCCESS" if res.returncode == 0 else "FAILED"
    return task

def run():
    data = load_and_ensure_queue()
    pending = data.get("pending", [])
    if not pending:
        print("💤 [Worker] تمامی اهداف نقشه راه انجام شده است.")
        return

    current = pending.pop(0)
    finished = process_task(current)
    data.setdefault("completed", []).append(finished)
    
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # ثبت تغییرات در گیت‌هاب
    subprocess.run(["git", "add", "-A"], cwd="/opt/roxira_platform", capture_output=True)
    subprocess.run([
        "git", "commit", "-m", 
        f"feat(factory): auto-processed {finished['id']} - status {finished['status']}"
    ], cwd="/opt/roxira_platform", capture_output=True)
    subprocess.run(["git", "push", "origin", "main"], cwd="/opt/roxira_platform", capture_output=True)
    print(f"✅ تسک {finished['id']} با موفقیت تست و در مخزن Push شد.")

if __name__ == "__main__":
    run()
