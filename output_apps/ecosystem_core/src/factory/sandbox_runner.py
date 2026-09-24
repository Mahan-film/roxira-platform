#!/usr/bin/env python3
"""
Roxira Isolated Sandbox Runner & Automated Code Validator
Uses dynamic spec loading to prevent syntax errors caused by hyphens in module names.
"""
import os, sys, subprocess, importlib.util

def test_module_in_sandbox(module_dir: str, task_id: str) -> tuple[bool, str]:
    router_file = os.path.join(module_dir, "router.py")
    if not os.path.exists(router_file):
        return False, "فایل router.py یافت نشد."

    # لود کاملاً ایمن از طریق مسیر فیزیکی فایل مستقل از نام پکیج
    test_script = f"""
import sys, importlib.util
from fastapi import FastAPI

router_path = {repr(router_file)}
spec = importlib.util.spec_from_file_location("dynamic_module_router", router_path)
if spec is None or spec.loader is None:
    raise ImportError("امکان لود ماژول روتر وجود ندارد.")

mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

if not hasattr(mod, "router"):
    raise AttributeError("شیء router در فایل مقصد تعریف نشده است.")

app = FastAPI()
app.include_router(mod.router)
print("SANDBOX_VERIFIED_SUCCESSFULLY")
"""
    try:
        cmd = [
            "/opt/roxira_platform/venv/bin/python3",
            "-c", test_script
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=12)
        if "SANDBOX_VERIFIED_SUCCESSFULLY" in proc.stdout:
            return True, "روتر و مدل‌های پایدنتیک با موفقیت در سندباکس لود و اعتبارسنجی شدند."
        else:
            err = proc.stderr.strip() or proc.stdout.strip()
            return False, err
    except subprocess.TimeoutExpired:
        return False, "تایم‌اوت اجرای سندباکس رخ داد."
    except Exception as e:
        return False, str(e)
