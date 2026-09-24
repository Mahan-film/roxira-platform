import os
import time
import json
import asyncio
import httpx
from pathlib import Path

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
if not OPENROUTER_API_KEY or OPENROUTER_API_KEY.startswith("YOUR_"):
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

ALL_16_MODELS = [
    # رایگان
    {"id": "nvidia/nemotron-3-ultra:free", "tier_label": "Nvidia Nemotron (FREE)", "in_cost": 0.0, "out_cost": 0.0},
    
    # فوق اقتصادی
    {"id": "upstage/solar-pro-4", "tier_label": "Solar Pro 4 ($0.03/M)", "in_cost": 0.03, "out_cost": 0.12},
    {"id": "deepseek/deepseek-v4-flash-0731", "tier_label": "DeepSeek V4 Flash ($0.045/M)", "in_cost": 0.045, "out_cost": 0.09},
    {"id": "z-ai/glm-5.3-flash", "tier_label": "GLM 5.3 Flash ($0.075/M)", "in_cost": 0.075, "out_cost": 0.25},
    {"id": "xiaomi/mimo-v2.5", "tier_label": "Xiaomi MiMo ($0.08/M)", "in_cost": 0.08, "out_cost": 0.20},
    {"id": "google/gemini-3.5-flash-lite", "tier_label": "Gemini 3.5 Lite ($0.10/M)", "in_cost": 0.10, "out_cost": 0.40},

    # میان‌رده استدلالی
    {"id": "moonshotai/kimi-k3", "tier_label": "Kimi K3 ($0.15/M)", "in_cost": 0.15, "out_cost": 0.50},
    {"id": "openai/gpt-5.6-luna", "tier_label": "GPT-5.6 Luna ($0.20/M)", "in_cost": 0.20, "out_cost": 1.20},
    {"id": "google/gemini-3.8-flash", "tier_label": "Gemini 3.8 Flash ($0.75/M)", "in_cost": 0.75, "out_cost": 1.875},
    {"id": "google/gemini-3.7-flash", "tier_label": "Gemini 3.7 Flash ($0.75/M)", "in_cost": 0.75, "out_cost": 3.75},
    {"id": "deepseek/deepseek-reasoner", "tier_label": "DeepSeek Reasoner ($0.55/M)", "in_cost": 0.55, "out_cost": 2.19},

    # سطح بالا و پرچم‌دار
    {"id": "deepseek/deepseek-v4-pro", "tier_label": "DeepSeek V4 Pro ($0.87/M)", "in_cost": 0.87, "out_cost": 1.74},
    {"id": "qwen/qwen-3.8-max-0803", "tier_label": "Qwen 3.8 Max ($2.00/M)", "in_cost": 2.00, "out_cost": 6.00},
    {"id": "anthropic/claude-3.5-sonnet", "tier_label": "Claude 3.5 Sonnet ($3.00/M)", "in_cost": 3.00, "out_cost": 15.00},
    {"id": "openai/gpt-6-astra", "tier_label": "GPT-6 Astra ($3.00/M)", "in_cost": 3.00, "out_cost": 15.00},
    {"id": "anthropic/claude-fable-5.1", "tier_label": "Claude Fable 5.1 ($5.00/M)", "in_cost": 5.00, "out_cost": 25.00},
]

LEGAL_TEST_PROMPT = """
شما مستشار عالی قضایی ایران هستید.
مسئله:
دارنده چک صیادی ۸۵۰ میلیون ریالی علیه صادرکننده و ضامن قصد اقدام دارد.
۱. مرجع صالح با توجه به قانون جدید دادگاه صلح چیست؟
۲. شرایط صدور اجرائیه مستقیم ماده ۲۳ قانون چک علیه ضامن چیست؟
۳. برآورد درصد شانس موفقیت و استناد به شماره دقیق رای وحدت رویه مرتبط.
پاسخ را صریح، مستند، فارسی و بدون اتلاف توکن در فرآیند فکری بنویسید.
"""

async def run_single_test(client: httpx.AsyncClient, m: dict):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ghazihoushmand.ir",
        "X-Title": "Full Matrix Benchmark"
    }
    payload = {
        "model": m["id"],
        "messages": [{"role": "user", "content": LEGAL_TEST_PROMPT}],
        "temperature": 0.1,
        "max_tokens": 1200
    }
    start = time.time()
    try:
        res = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=60.0)
        elapsed = round(time.time() - start, 2)
        if res.status_code == 200:
            data = res.json()
            usage = data.get("usage", {})
            p_tok = usage.get("prompt_tokens", 0)
            c_tok = usage.get("completion_tokens", 0)
            cost = ((p_tok / 1e6) * m["in_cost"]) + ((c_tok / 1e6) * m["out_cost"])
            content = data["choices"][0]["message"].get("content") or ""
            return {
                "model": m["id"],
                "tier": m["tier_label"],
                "status": "OK",
                "time_sec": elapsed,
                "tokens": f"{p_tok}+{c_tok}",
                "cost_usd": f"${cost:.6f}",
                "content_preview": content[:300].replace("\n", " ")
            }
        else:
            return {"model": m["id"], "tier": m["tier_label"], "status": f"HTTP {res.status_code}", "time_sec": elapsed, "cost_usd": "$0.0", "error": res.text[:80]}
    except Exception as e:
        return {"model": m["id"], "tier": m["tier_label"], "status": "TIMEOUT/ERR", "time_sec": round(time.time() - start, 2), "cost_usd": "$0.0", "error": str(e)}

async def main():
    print("=" * 115)
    print("🚀 اجرای بنچمارک مقایسه‌ای هم‌زمان ۱۶ مدل هوش مصنوعی در OpenRouter")
    print("=" * 115)
    async with httpx.AsyncClient() as client:
        tasks = [run_single_test(client, m) for m in ALL_16_MODELS]
        results = await asyncio.gather(*tasks)

    print(f"\n{'مدل':<36} | {'وضعیت':<8} | {'زمان':<8} | {'هزینه تست':<12} | {'رده و مدل'}")
    print("-" * 115)
    for r in results:
        print(f"{r['model'][:35]:<36} | {r['status']:<8} | {r.get('time_sec', 0)}s{'':<4} | {r.get('cost_usd', '-'):<12} | {r['tier']}")

    out_file = "/opt/roxira_platform/data/all_16_models_benchmark.json"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\n" + "=" * 115)
    print(f"✅ خروجی کامل در فایل {out_file} ذخیره شد.")

if __name__ == "__main__":
    asyncio.run(main())
