from __future__ import annotations

import time
from src.intelligence.providers.openrouter_client import OpenRouterClient

BENCHMARK_MODELS = [
    "z-ai/glm-5.2:free",
    "nvidia/nemotron-3.5-lightning:free",
    "deepseek/deepseek-v4-flash"
]

TEST_PROMPTS = [
    {"domain": "حسابداری دوبل", "prompt": "سند حسابداری فروش نسیه ۱۰۰ میلیون تومان با ۱۰ درصد مالیات ارزش افزوده را بنویس."},
    {"domain": "حقوقی و چک", "prompt": "ارکان صدور اجرائیه مستقیم طبق ماده ۲۳ قانون صدور چک را در ۳ بند خلاصه کن."}
]

def run_models_benchmark():
    client = OpenRouterClient()
    print("========================================================")
    print("⚡ ROXIRA LOW-COST & FREE MODELS BENCHMARK SUITE")
    print("========================================================\n")

    for p in TEST_PROMPTS:
        print(f"📌 حوزه: {p['domain']} | پرسش: {p['prompt']}")
        for model in BENCHMARK_MODELS:
            t0 = time.perf_counter()
            res = client.generate(model=model, prompt=p["prompt"])
            elapsed = time.perf_counter() - t0
            badge = "✅ [SUCCESS]" if res.get("status") == "SUCCESS" else "❌ [FAILED]"
            snippet = str(res.get("content", res.get("error", "")))[:100].replace("\n", " ")
            print(f"   {badge} {model.ljust(35)} | ⏱️ {elapsed:.2f}s -> {snippet}...")
        print("-" * 56)

if __name__ == "__main__":
    run_models_benchmark()
