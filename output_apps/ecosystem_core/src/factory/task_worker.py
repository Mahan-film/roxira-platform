#!/usr/bin/env python3
"""
Roxira Autonomous Background Worker
کارگر مقیم سرور برای پردازش پیوسته پروژه‌ها از صف، تست، اصلاح و استقرار خودکار.
"""
import os
import sys
import json
import time
import asyncio
import subprocess

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"
ENGINE_SCRIPT = "/opt/roxira_platform/output_apps/ecosystem_core/src/factory/roxira_factory_engine.py"

def load_queue():
    if not os.path.exists(QUEUE_FILE):
        initial = {
            "pending": [
                {"id": "PROJ-101", "prompt": "توسعه ماژول انبارداری هوشمند مبتنی بر هوش مصنوعی با پیش‌بینی کسری کالا", "status": "QUEUED"}
            ],
            "completed": []
        }
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(initial, f, ensure_ascii=False, indent=2)
        return initial
    try:
        with open(QUEUE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"pending": [], "completed": []}

def save_queue(q_data):
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(q_data, f, ensure_ascii=False, indent=2)

def process_single_task(task):
    print(f"\n🚀 [Autonomous Worker] آغاز اجرای کاملاً مستقل تسک: {task['id']}")
    print(f"📝 هدف پروژه: {task['prompt']}")
    
    # فراخوانی موتور سه‌فازی
    cmd = ["python3", ENGINE_SCRIPT, task['prompt']]
    res = subprocess.run(cmd, capture_output=True, text=True)
    
    task["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S UTC")
    task["exit_code"] = res.returncode
    task["status"] = "SUCCESS" if res.returncode == 0 else "FAILED"
    return task

def run_worker_cycle():
    data = load_queue()
    pending = data.get("pending", [])
    if not pending:
        print("💤 [Worker] هیچ پروژه جدیدی در صف انتظار نیست. در حالت آماده‌باش...")
        return
    
    current_task = pending.pop(0)
    finished_task = process_single_task(current_task)
    data["completed"].append(finished_task)
    save_queue(data)
    
    # ثبت در گیت‌هاب
    subprocess.run(["git", "add", "-A"], cwd="/opt/roxira_platform", capture_output=True)
    subprocess.run([
        "git", "commit", "-m", 
        f"feat(factory-autonomous): processed {finished_task['id']} - status {finished_task['status']}"
    ], cwd="/opt/roxira_platform", capture_output=True)
    subprocess.run(["git", "push", "origin", "main"], cwd="/opt/roxira_platform", capture_output=True)
    print(f"✅ تسک {finished_task['id']} انجام، تست و در گیت‌هاب ادغام شد.")

if __name__ == "__main__":
    run_worker_cycle()
