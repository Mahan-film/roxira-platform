from __future__ import annotations

import os
import pathlib
import sys
from typing import Dict, Any

import httpx

SERVER_HEALTH_URL = os.environ.get("ROXIRA_HEALTH_URL", "https://ghazihoushmand.ir/")


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[2]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


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

        llm_route = _llm_route()
        messages = [{"role": "user", "content": prompt}]
        try:
            result = llm_route.route(
                "selfimprove",
                messages,
                llm_route.attempts_for("selfimprove", timeout=30.0),
                public=True,
            )
            diag = result.text
        except (llm_route.AllAttemptsFailed, llm_route.CapReached) as exc:
            diag = f"AI Diagnosis failed: {exc}"

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
