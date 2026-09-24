import os
import time
import json
import asyncio
import httpx
from pathlib import Path

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
if not OPENROUTER_API_KEY or OPENROUTER_API_KEY.startswith("YOUR_"):
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# فهرست مدل‌های منتخب جهت آزمون سخت‌گیرانه
MODELS_TO_BENCHMARK = [
    {"id": "google/gemini-3.5-flash-lite", "category": "گوگل فوق‌سریع", "input_cost": 0.10, "output_cost": 0.40},
    {"id": "google/gemini-3.8-flash", "category": "گوگل پیشرفته", "input_cost": 0.15, "output_cost": 0.60},
    {"id": "deepseek/deepseek-v4-flash-0731", "category": "دیپ‌سیک اقتصادی", "input_cost": 0.045, "output_cost": 0.09},
    {"id": "deepseek/deepseek-v4-pro", "category": "دیپ‌سیک پرو", "input_cost": 0.87, "output_cost": 1.74},
    {"id": "z-ai/glm-5.3-flash", "category": "جی‌ال‌ام فلش", "input_cost": 0.075, "output_cost": 0.25},
    {"id": "moonshotai/kimi-k3", "category": "کیمی استدلالی", "input_cost": 0.15, "output_cost": 0.50},
    {"id": "openai/gpt-5.6-luna", "category": "اوپن‌ای‌آی لونا", "input_cost": 0.20, "output_cost": 1.20},
]

COMPLEX_LEGAL_PROMPT = """
شما مستشار عالی قضایی و متخصص آرای وحدت رویه دیوان عالی کشور هستید.
به مسئله حقوقی-کیفری زیر مستند، دقیق و مستدل پاسخ دهید:

پرونده ترکیبی:
۱. شخصی در اراضی باغی اقدام به تغییر کاربری غیرمجاز و احداث بنا نموده است. با توجه به قانون شوراهای حل اختلاف مصوب ۱۴۰۲ و لزوم صدور حکم قلع و قمع بنا، مرجع صالح رسیدگی کدام است؟ (آیا در صلاحیت دادگاه صلح است یا دادگاه کیفری دو؟ مستند به رای وحدت رویه دیوان عالی کشور).
۲. شرکتی تجاری دچار ورشکستگی شده اما به دلیل تورم، دارایی‌های توقیف‌شده نزد اداره تصفیه بیش از اصل دیون ارزش یافته است. آیا بستانکاران حق مطالبه خسارت کاهش ارزش پول (ماده ۵۲۲ ق.آ.د.م) از محل مازاد دارایی‌ها را دارند؟ (مستند به رای وحدت رویه دیوان عالی کشور).
۳. شرکتی به دلیل تاخیر در ارائه اسناد حمل و ترخیص، مشمول مابه‌التفاوت نرخ ارز شده است. مرجع صالح برای رسیدگی به این تخلف چیست؟ (دادگاه انقلاب یا تعزیرات حکومتی؟ مستند به رای وحدت رویه دیوان عالی کشور).

پاسخ‌ها را با ذکر شماره دقیق مواد قانونی و شماره آراء وحدت رویه مربوطه ارائه دهید.
"""

def evaluate_complex_answers(text: str) -> dict:
    """ارزیابی تطبیق استدلال مدل با آرای وحدت رویه ۸۷۷، ۸۷۸ و ۸۷۹ دیوان عالی کشور"""
    score = 0
    checks = {
        "ruling_879_criminal2": ("879" in text or "۸۷۹" in text) and any(k in text for k in ["کیفری دو", "کیفری ۲"]),
        "ruling_877_bankruptcy": ("877" in text or "۸۷۷" in text) and any(k in text for k in ["تصفیه", "تورم", "مازاد", "۵۲۲"]),
        "ruling_878_tazirat": ("878" in text or "۸۷۸" in text) and any(k in text for k in ["تعزیرات", "تعزیرات حکومتی"]),
        "structured_logic": len(text) > 400
    }
    
    if checks["ruling_879_criminal2"]: score += 35   # تشخیص رأی ۸۷۹ (قلع‌وقمع بنا در صلاحیت دادگاه کیفری دو)
    if checks["ruling_877_bankruptcy"]: score += 35   # تشخیص رأی ۸۷۷ (خسارت تاخیر تادیه ورشکسته از محل مازاد دارایی)
    if checks["ruling_878_tazirat"]: score += 20      # تشخیص رأی ۸۷۸ (صلاحیت سازمان تعزیرات در تخلفات ارزی)
    if checks["structured_logic"]: score += 10
    
    return {"score": score, "checks": checks}

async def benchmark_model(client: httpx.AsyncClient, model_cfg: dict):
    model_id = model_cfg["id"]
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ghazihoushmand.ir",
        "X-Title": "Complex Precedents Benchmark"
    }
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": "شما دستیار حقوقی مستند به آرای وحدت رویه هیئت عمومی دیوان عالی کشور هستید."},
            {"role": "user", "content": COMPLEX_LEGAL_PROMPT}
        ],
        "temperature": 0.05,
        "max_tokens": 1500
    }
    
    start = time.time()
    try:
        res = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=75.0)
        elapsed = round(time.time() - start, 2)
        if res.status_code == 200:
            data = res.json()
            usage = data.get("usage", {})
            p_tok = usage.get("prompt_tokens", 0)
            c_tok = usage.get("completion_tokens", 0)
            cost = ((p_tok / 1e6) * model_cfg["input_cost"]) + ((c_tok / 1e6) * model_cfg["output_cost"])
            msg = data["choices"][0]["message"]
            content = msg.get("content") or msg.get("reasoning") or ""
            eval_res = evaluate_complex_answers(content)
            return {
                "model": model_id,
                "category": model_cfg["category"],
                "status": "OK",
                "time_sec": elapsed,
                "score": f"{eval_res['score']}/100",
                "tokens": f"{p_tok}+{c_tok}",
                "cost_usd": f"${cost:.6f}",
                "full_response": content,
                "checks": eval_res["checks"]
            }
        else:
            return {"model": model_id, "category": model_cfg["category"], "status": f"HTTP {res.status_code}", "time_sec": elapsed, "score": "0/100", "cost_usd": "$0.0", "error": res.text[:120]}
    except Exception as e:
        return {"model": model_id, "category": model_cfg["category"], "status": "ERR/TIMEOUT", "time_sec": round(time.time() - start, 2), "score": "0/100", "cost_usd": "$0.0", "error": str(e)}

async def main():
    print("=" * 110)
    print("⚖️  آغاز آزمون فوق‌پیشرفته آرای وحدت رویه دیوان عالی کشور (۱۴۰۵) برای مدل‌های منتخب")
    print("=" * 110)

    async with httpx.AsyncClient() as client:
        tasks = [benchmark_model(client, m) for m in MODELS_TO_BENCHMARK]
        results = await asyncio.gather(*tasks)

    print(f"\n{'نام مدل':<36} | {'رده':<18} | {'وضعیت':<8} | {'زمان':<8} | {'امتیاز حقوقی':<14} | {'هزینه تست'}")
    print("-" * 110)
    for r in sorted(results, key=lambda x: int(x.get("score", "0/100").split("/")[0]), reverse=True):
        print(f"{r['model'][:35]:<36} | {r['category']:<18} | {r['status']:<8} | {r.get('time_sec', 0)}s{'':<5} | {r.get('score', '0/100'):<14} | {r.get('cost_usd', '-')}")

    out_file = "/opt/roxira_platform/data/complex_benchmark_1405_results.json"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\n" + "=" * 110)
    print(f"✅ خروجی کامل پاسخ‌ها جهت بازبینی و هم‌فکری با وکیل دادگستری ذخیره شد در:\n   {out_file}")
    print("=" * 110)

if __name__ == "__main__":
    asyncio.run(main())
