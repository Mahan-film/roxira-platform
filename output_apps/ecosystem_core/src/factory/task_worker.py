import sys
sys.path.insert(0, '/opt/roxira_platform')
#!/usr/bin/env python3
import os
import sys
import json
import time
import subprocess

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"
ENGINE_SCRIPT = "/opt/roxira_platform/output_apps/ecosystem_core/src/factory/roxira_factory_engine.py"

def process_task(task):
    task_id = task.get("id", f"TASK-{int(time.time())}")
    prompt = task.get("prompt", "توسعه زیرسیستم هوشمند")
    print(f"\n🚀 [Autonomous Worker] آغاز اجرای دقیق تسک: {task_id}")
    print(f"📝 هدف: {prompt}")
    
    # ارسال دقیق هر دو آرگومان: task_id و prompt
    cmd = ["python3", ENGINE_SCRIPT, task_id, prompt]
    res = subprocess.run(cmd, capture_output=True, text=True)
    
    task["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S UTC")
    task["exit_code"] = res.returncode
    task["status"] = "SUCCESS" if res.returncode == 0 else "FAILED"
    return task

def run():
    if not os.path.exists(QUEUE_FILE):
        return
    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    pending = data.get("pending", [])
    if not pending:
        print("💤 [Worker] صف تسک‌های معوقه خالی است.")
        return

    current = pending.pop(0)
    finished = process_task(current)
    data.setdefault("completed", []).append(finished)
    
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    subprocess.run(["git", "add", "-A"], cwd="/opt/roxira_platform", capture_output=True)
    subprocess.run([
        "git", "commit", "-m", 
        f"feat(factory): auto-build {finished['id']} with exact task metadata"
    ], cwd="/opt/roxira_platform", capture_output=True)
    subprocess.run(["git", "push", "origin", "main"], cwd="/opt/roxira_platform", capture_output=True)
    print(f"✅ تسک {finished['id']} بیلد، ثبت و ادغام شد.")

if __name__ == "__main__":
    run()
