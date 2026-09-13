#!/usr/bin/env python3
import time
import urllib.request
import json
import subprocess

LOG_FILE = "/var/log/roxira_swarm_qa.log"

def log_swarm(msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] [SWARM-QA] {msg}"
    print(entry)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(entry + "\n")

def run_qa_cycle():
    try:
        req = urllib.request.Request("http://127.0.0.1:8000/api/v1/apps/judge/system/simulation-qa")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            tot = data.get("total_benchmark_time_ms")
            log_swarm(f"✅ شبیه‌ساز ۳ پرونده فرضی با موفقیت اجرا شد | زمان کل: {tot} ms")
    except Exception as e:
        log_swarm(f"⚠️ خطای شبیه‌ساز: {e}")

if __name__ == "__main__":
    run_qa_cycle()
