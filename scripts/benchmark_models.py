import os
import time
import json
import asyncio
import httpx
from pathlib import Path

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

if not OPENROUTER_API_KEY or OPENROUTER_API_KEY.startswith("YOUR_"):
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

MODELS_TO_BENCHMARK = [
    # --- رده ۱: پرچم‌داران نسل جدید (Gold Standard / معیار حداکثری کیفیت) ---
    {"id": "anthropic/claude-fable-5.1", "category": "پرچم‌دار (Fable)", "input_cost": 5.00, "output_cost": 25.00},
    {"id": "openai/gpt-6-astra", "category": "پرچم‌دار (GPT-6)", "input_cost": 3.00, "output_cost": 15.00},
    {"id": "qwen/qwen-3.8-max-0803", "category": "پرچم‌دار (Qwen)", "input_cost": 2.00, "output_cost": 6.00},

    # --- رده ۲: میان‌رده‌های استدلالی با قیمت مناسب ---
    {"id": "openai/gpt-5.6-luna", "category": "اقتصادی پیشرفته", "input_cost": 0.20, "output_cost": 1.20},
    {"id": "google/gemini-3.8-flash", "category": "اقتصادی گوگل", "input_cost": 0.15, "output_cost": 0.60},
    {"id": "moonshotai/kimi-k3", "category": "استدلال هوشمند", "input_cost": 0.15, "output_cost": 0.50},
    {"id": "deepseek/deepseek-reasoner", "category": "استدلال عمیق", "input_cost": 0.55, "output_cost": 2.19},

    # --- رده ۳: فوق‌اقتصادی و فوق‌سریع ---
    {"id": "upstage/solar-pro-4", "category": "ارزش خرید بالا", "input_cost": 0.03, "output_cost": 0.12},
    {"id": "deepseek/deepseek-v4-flash-0731", "category": "فوق‌اقتصادی", "input_cost": 0.045, "output_cost": 0.09},
    {"id": "z-ai/glm-5.3-flash", "category": "فوق‌اقتصادی", "input_cost": 0.075, "output_cost": 0.25},
    {"id": "xiaomi/mimo-v2.5", "category": "فوق‌اقتصادی", "input_cost": 0.08, "output_cost": 0.20},
    {"id": "google/gemini-3.5-flash-lite", "category": "فوق‌اقتصادی", "input_cost": 0.10, "output_cost": 0.40},

    # --- رده ۴: کاملاً رایگان ($0) ---
    {"id": "nvidia/nemotron-3-ultra:free", "category": "رایگان", "input_cost": 0.0, "output_cost": 0.0},
    {"id": "minimax/minimax-m3:free", "category": "رایگان", "input_cost": 0.0, "output_cost": 0.0},
]

LEGAL_PROMPT = """
شما دستیار ارشد قضایی و حقوقی در ایران هستید.
پرونده فرضی:
دارنده یک فقره چک صیادی به مبلغ ۸۵۰ میلیون ریال با گواهی عدم پرداخت، قصد دارد هم‌زمان علیه صادرکننده و شخص ضامن (که ظهر چک را به عنوان ضامن امضا کرده) اقدام کند.
مطلوب است:
۱. تعیین مرجع صالح رسیدگی با استناد به قانون جدید شوراهای حل اختلاف و دادگاه صلح.
۲. آیا صدور اجرائیه مستقیم ماده ۲۳ قانون صدور چک علیه «ضامن» امکان‌پذیر است یا صرفاً علیه صادرکننده و صاحب حساب؟
۳. برآورد درصد شانس موفقیت علیه صادرکننده و ضامن به تفکیک.
۴. استناد به شماره دقیق مواد قانونی و رأی وحدت رویه مرتبط.

پاسخ را صریح، مستند به قوانین ایران، ساختاریافته و بدون ابداع شماره‌های فرضی ارائه دهید.
"""

def evaluate_legal_quality(text: str) -> dict:
    score = 0
    checks = {
        "peace_court": any(k in text for k in ["دادگاه صلح", "صلح"]),
        "article_23": "ماده ۲۳" in text or "ماده 23" in text,
        "guarantor_distinction": any(k in text for k in ["ضامن", "ظهرنویس", "تضامنی"]),
        "no_dummy_precedents": not any(f"رای وحدت رویه شماره {i}" in text for i in range(1, 5)),
        "structured": len(text) > 300
    }
    if checks["peace_court"]: score += 25
    if checks["article_23"]: score += 25
    if checks["guarantor_distinction"]: score += 20
    if checks["no_dummy_precedents"]: score += 20
    if checks["structured"]: score += 10
    return {"score": score, "checks": checks}

async def test_single_model(client: httpx.AsyncClient, model_cfg: dict):
    model_id = model_cfg["id"]
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ghazihoushmand.ir",
        "X-Title": "QaziHoushmand Advanced Benchmark"
    }
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": "پاسخ‌ها باید مستند، دقیق و منطبق با قوانین دادرسی جاری ایران باشد."},
            {"role": "user", "content": LEGAL_PROMPT}
        ],
        "temperature": 0.1,
        "max_tokens": 1400
    }
    start = time.time()
    try:
        res = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=85.0)
        elapsed = round(time.time() - start, 2)
        if res.status_code == 200:
            data = res.json()
            usage = data.get("usage", {})
            p_tok = usage.get("prompt_tokens", 0)
            c_tok = usage.get("completion_tokens", 0)
            cost = ((p_tok / 1e6) * model_cfg["input_cost"]) + ((c_tok / 1e6) * model_cfg["output_cost"])
            
            msg = data["choices"][0]["message"]
            content = msg.get("content") or msg.get("reasoning") or ""
            eval_res = evaluate_legal_quality(content)
            
            return {
                "model": model_id,
                "category": model_cfg["category"],
                "status": "OK",
                "time_sec": elapsed,
                "score": f"{eval_res['score']}/100",
                "tokens": f"{p_tok}+{c_tok}",
                "cost_usd": f"${cost:.6f}",
                "full_response": content
            }
        else:
            return {"model": model_id, "category": model_cfg["category"], "status": f"HTTP {res.status_code}", "time_sec": elapsed, "score": "0/100", "cost_usd": "$0.0", "error": res.text[:120]}
    except Exception as e:
        return {"model": model_id, "category": model_cfg["category"], "status": "TIMEOUT/ERR", "time_sec": round(time.time() - start, 2), "score": "0/100", "cost_usd": "$0.0", "error": str(e)}

async def main():
    print("=" * 110)
    print("⚖️  آغاز بنچمارک مقایسه‌ای مدل‌های زبانی OpenRouter (پرچم‌داران + اقتصادی + رایگان)")
    print(f"📊 تعداد کل مدل‌ها: {len(MODELS_TO_BENCHMARK)}")
    print("=" * 110)

    async with httpx.AsyncClient() as client:
        tasks = [test_single_model(client, m) for m in MODELS_TO_BENCHMARK]
        results = await asyncio.gather(*tasks)

    print(f"\n{'نام مدل':<36} | {'رده':<18} | {'وضعیت':<8} | {'زمان':<8} | {'امتیاز حقوقی':<14} | {'هزینه تست'}")
    print("-" * 110)
    for r in sorted(results, key=lambda x: int(x.get("score", "0/100").split("/")[0]), reverse=True):
        print(f"{r['model'][:35]:<36} | {r['category']:<18} | {r['status']:<8} | {r.get('time_sec', 0)}s{'':<5} | {r.get('score', '0/100'):<14} | {r.get('cost_usd', '-')}")

    out_file = "/opt/roxira_platform/data/benchmark_results.json"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\n" + "=" * 110)
    print(f"✅ فایل گزارش کامل شامل متون پاسخ‌ها در مسیر زیر ذخیره شد:\n   {out_file}")
    print("=" * 110)

if __name__ == "__main__":
    asyncio.run(main())
