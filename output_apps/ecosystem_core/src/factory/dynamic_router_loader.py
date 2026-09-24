#!/usr/bin/env python3
"""
Dynamic Route Auto-Mounter
اسکن خودکار ماژول‌های تولیدشده در generated_modules و اتصال زنده آن‌ها به FastAPI
"""
import os
import importlib.util
from fastapi import FastAPI

MODULES_DIR = "/opt/roxira_platform/output_apps/generated_modules"

def mount_generated_routes(app: FastAPI):
    if not os.path.exists(MODULES_DIR):
        return
    
    for task_folder in os.listdir(MODULES_DIR):
        router_path = os.path.join(MODULES_DIR, task_folder, "router.py")
        if os.path.exists(router_path):
            try:
                spec = importlib.util.spec_from_file_location(f"dyn_{task_folder}", router_path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                if hasattr(mod, "router"):
                    app.include_router(mod.router)
                    print(f"  🔗 روتر ماژول {task_folder} به‌صورت داینامیک فعال شد.")
            except Exception as e:
                print(f"  ⚠️ خطا در لود {task_folder}: {e}")
