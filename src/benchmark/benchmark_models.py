from __future__ import annotations

import time
import json
import pathlib
import sys

CURRENT_DIR = pathlib.Path.cwd()
ROOT_DIRS = [CURRENT_DIR, pathlib.Path("/Users/mac/Developer/project-foundry-worktrees/fnd-ops-00"), pathlib.Path("/Users/mac/Developer/project-foundry")]
for r in ROOT_DIRS:
    if str(r) not in sys.path:
        sys.path.insert(0, str(r))

from output_apps.ecosystem_core.src.agents.ai_router import CostOptimizedAIRouter

def run_comparative_model_benchmark():
    router = CostOptimizedAIRouter()
    
    test_cases = [
        {
            "name": "تراز حسابداری دوبل و مالیات حقوق",
            "tier": "FREE_EXTRACTION",
            "prompt": "یک سند حسابداری خرید قطعه به مبلغ ۵۰ میلیون تومان با ارزش افزوده ۱۰٪ را به تفکیک کدینگ دوبل بده."
        },
        {
            "name": "تنظیم استدلال ماده ۲۳ قانون چک",
            "tier": "FREE_REASONING",
            "prompt": "ارکان صدور اجرائیه مستقیم چک برگشتی صیادی وفق ماده ۲۳ را به صورت خلاصه بیان کن."
        }
    ]

    print("\n========================================================")
    print("⚡ RUNNING OPENROUTER FREE & BUDGET MODEL BENCHMARK")
    print("========================================================\n")

    for tc in test_cases:
        t0 = time.perf_counter()
        res = router.execute(
            prompt=tc["prompt"],
            system_prompt="پاسخ را در قالب شیء معتبر JSON خروجی بده.",
            task_tier=tc["tier"],
            json_mode=True
        )
        elapsed = time.perf_counter() - t0
        
        status_badge = "✅ [SUCCESS]" if res.get("status") == "SUCCESS" else "❌ [FAILED]"
        model_used = res.get("model_used", "None")
        is_free = "🆓 (Free Tier)" if res.get("is_free_tier") else "💲 (Paid Tier)"
        
        print(f"{status_badge} {tc['name']}")
        print(f"   ├─ Model: {model_used} {is_free}")
        print(f"   └─ Latency: {elapsed:.2f}s\n")

    print("========================================================\n")

if __name__ == "__main__":
    run_comparative_model_benchmark()
