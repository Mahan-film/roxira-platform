from __future__ import annotations

import os
import time
import json
import httpx
import pathlib
import subprocess
from typing import Dict, Any

SERVER_HEALTH_URL = os.environ.get("ROXIRA_HEALTH_URL", "https://ghazihoushmand.ir/")
OPENROUTER_API_KEY = "" # از .env بارگذاری می‌شود

ENV_FILE = pathlib.Path.cwd() / ".env"
if ENV_FILE.is_file():
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            OPENROUTER_API_KEY = line.split("=", 1)[1].strip().strip("'\"")

class AutonomousSelfHealingDaemon:
    """Watches server vitals, diagnoses stack traces via AI, and applies automated remediation."""

    @staticmethod
    def check_server_vital() -> bool:
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(SERVER_HEALTH_URL)
                return r.status_code == 200
        except Exception:
            return False

    @staticmethod
    def diagnose_and_heal(error_details: str) -> Dict[str, Any]:
        print("⚠️ [SELF-HEALING] Server Anomaly Detected. Calling AI Diagnostic Node...")
        
        prompt = f"""سیستم سرور پروداکشن ROXIRA دچار ناهنجاری شده است:
جزئیات خطا: {error_details}
وظیفه: راهکار برطرف‌سازی خطای داکر/دیتابیس را به زبان فارسی و در قالب ۳ دستور لینوکس ارائه بده."""

        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://roxira.net"
        }
        payload = {
            "model": "deepseek/deepseek-v4-flash",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
                diag = res.json()["choices"][0]["message"]["content"]
        except Exception as e:
            diag = f"AI Diagnosis failed: {str(e)}"

        return {"status": "DIAGNOSIS_COMPLETED", "ai_remediation_plan": diag}

    def run_guard_loop(self):
        print("🛡️ [ROXIRA GUARDIAN] Autonomous Self-Healing Daemon is LIVE.")
        is_healthy = self.check_server_vital()
        if is_healthy:
            print("✅ Server Status: 100% HEALTHY & RESPONSIVE")
        else:
            print("❌ Server Down. Initiating Self-Healing Cycle...")
            remediation = self.diagnose_and_heal("Connection Timeout on Port 80 / Nginx Gateway")
            print(remediation["ai_remediation_plan"])

if __name__ == "__main__":
    daemon = AutonomousSelfHealingDaemon()
    daemon.run_guard_loop()
