#!/usr/bin/env python3
"""
Roxira Isolated Sandbox Runner & Automated Code Validator
Executes generated routers and schemas in an isolated runtime environment with auto-healing.
"""
import os, sys, subprocess, tempfile

def test_module_in_sandbox(module_dir: str, task_id: str) -> tuple[bool, str]:
    """اجرای آزمون در محیط ایزوله و اعتبارسنجی قابلیت ایمپورت روتر و مدل‌ها"""
    router_file = os.path.join(module_dir, "router.py")
    if not os.path.exists(router_file):
        return False, "فایل router.py یافت نشد."

    # اسکریپت آزمون سلامت اجرا
    test_script = f"""
import sys
sys.path.insert(0, "/opt/roxira_platform")
from fastapi import FastAPI
from output_apps.generated_modules.{task_id}.router import router

app = FastAPI()
app.include_router(router)
print("SANDBOX_VERIFIED_SUCCESSFULLY")
"""
    try:
        cmd = [
            "/opt/roxira_platform/venv/bin/python3",
            "-c", test_script
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=8)
        if "SANDBOX_VERIFIED_SUCCESSFULLY" in proc.stdout:
            return True, "روتر و پایدنتیک با موفقیت لود و اعتبارسنجی شدند."
        else:
            err = proc.stderr.strip() or proc.stdout.strip()
            return False, err
    except subprocess.TimeoutExpired:
        return False, "تایم‌اوت اجرای سندباکس رخ داد."
    except Exception as e:
        return False, str(e)
