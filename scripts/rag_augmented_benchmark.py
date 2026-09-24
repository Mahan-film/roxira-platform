import os
import time
import json
import asyncio
import httpx
from pathlib import Path

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
if not OPENROUTER_API_KEY or OPENROUTER_API_KEY.startswith("YOUR_"):
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# فهرست مدل‌های منتخب برای ارزیابی سنتز داده‌های RAG
MODELS_TO_BENCHMARK = [
    {"id": "google/gemini-3.5-flash-lite", "tier": "Gemini 3.5 Lite", "in_cost": 0.10, "out_cost": 0.40},
    {"id": "google/gemini-3.7-flash", "tier": "Gemini 3.7 Flash", "in_cost": 0.75, "out_cost": 3.75},
    {"id": "google/gemini-3.8-flash", "tier": "Gemini 3.8 Flash", "in_cost": 0.75, "out_cost": 1.875},
    {"id": "deepseek/deepseek-v4-flash-0731", "tier": "DeepSeek V4 Flash", "in_cost": 0.045, "out_cost": 0.09},
    {"id": "deepseek/deepseek-v4-pro", "tier": "DeepSeek V4 Pro", "in_cost": 0.87, "out_cost": 1.74},
    {"id": "openai/gpt-5.6-luna", "tier": "GPT-5.6 Luna", "in_cost": 0.20, "out_cost": 1.20},
    {"id": "moonshotai/kimi-k3", "tier": "Kimi K3", "in_cost": 0.15, "out_cost": 0.50},
    {"id": "z-ai/glm-5.3-flash", "tier": "GLM 5.3 Flash", "in_cost": 0.075, "out_cost": 0.25},
]

# کانتکست استخراج‌شده از پایگاه داده و گراف قضایی (RAG Context)
RAG_INJECTED_CONTEXT = """
=== مستندات استخراج‌شده از پایگاه قوانین و آرای وحدت رویه (RAG Context) ===

[سند ۱ - رأی وحدت رویه شماره ۸۷۹ دیوان عالی کشور مورخ ۱۴۰۵/۴/۹]:
«به تصریح بندهای ۹ و ۱۰ ماده ۱۲ قانون شوراهای حل اختلاف مصوب ۱۴۰۲، صلاحیت دادگاه صلح در امور کیفری محدود به جنبه عمومی و خصوصی کلیه جرایم غیر عمدی ناشی از کار یا تصادفات رانندگی و جرایم تعزیری مستوجب مجازات درجه هفت و هشت است. صدور حکم بر قلع و قمع بنا جزء مجازات‌های ماده ۱۹ قانون مجازات اسلامی نیست و در ماده ۳ قانون حفظ کاربری اراضی زراعی و باغ‌ها مصوب ۱۳۷۴ علاوه بر جزای نقدی، قلع و قمع بنا جزء لاینفک حکم کیفری محسوب می‌شود. با توجه به صلاحیت عام دادگاه کیفری دو، رسیدگی به این جرم به استناد ماده ۳۰۱ قانون آیین دادرسی کیفری در صلاحیت دادگاه کیفری دو خواهد بود نه دادگاه صلح.»

[سند ۲ - رأی وحدت رویه شماره ۸۷۷ دیوان عالی کشور مورخ ۱۴۰۵/۳/۱۲]:
«مطابق ماده ۴۲۱ قانون تجارت پس از صدور حکم ورشکستگی قروض مؤجل به قروض حال مبدل می‌شود. چنانچه بر اثر تورم، ارزش اموال و دارایی‌های ورشکسته افزایش یافته یا اموالی باقی مانده که مازاد بر دیون او باشد و بستانکاران خسارت ناشی از کاهش ارزش دین موضوع ماده ۵۲۲ قانون آیین دادرسی مدنی را درخواست کنند، اداره تصفیه پس از احراز، از محل دارایی‌های باقی‌مانده آن را محاسبه و به بستانکاران پرداخت خواهد کرد.»

[سند ۳ - رأی وحدت رویه شماره ۸۷۸ دیوان عالی کشور مورخ ۱۴۰۵/۳/۲۶]:
«در ماده ۲ مکرر قانون مبارزه با قاچاق کالا و ارز، تخطی از سایر ضوابط ارزی که فاقد وصف مجرمانه باشد صرفاً تخلف محسوب شده است. عدم پرداخت مابه‌التفاوت نرخ ارز توسط واردکنندگان به دلیل تأخیر در ترخیص، تخلف از مقررات ارزی بوده و مرجع صالح برای رسیدگی به آن، چنانچه توأم با جرایم دیگری نباشد، سازمان تعزیرات حکومتی خواهد بود.»

[سند ۴ - ماده ۲۳ قانون صدور چک]:
«دارنده چک می‌تواند با ارائه گواهی عدم پرداخت از دادگاه صالح، بدون رسیدگی ماهوی، صدور اجرائیه را علیه صادرکننده و صاحب حساب درخواست نماید. صدور اجرائیه مستقیم ماده ۲۳ شامل ضامن و ظهرنویس نمی‌شود و مطالبه از ضامن مستلزم تقدیم دادخواست حقوقی است.»
"""

USER_QUERY = """
بر اساس صرفاً مستندات قانونی فوق (RAG Context)، به پرسش‌های حقوقی زیر پاسخ دقیق و استدلالی دهید:
۱. شخصی در اراضی باغی اقدام به تغییر کاربری و احداث بنا کرده است. با توجه به لزوم قلع‌وقمع، مرجع صالح رسیدگی کدام دادگاه است و مستند به چه رأی وحدت رویه‌ای؟
۲. در صورت وجود مازاد دارایی ناشی از تورم نزد اداره تصفیه برای تاجر ورشکسته، آیا بستانکاران حق دریافت خسارت ماده ۵۲۲ ق.آ.د.م را دارند؟ مستند به کدام رأی وحدت رویه؟
۳. مرجع رسیدگی به مطالبه مابه‌التفاوت نرخ ارز واردکنندگان ناشی از تأخیر در ترخیص کالا چیست؟ مستند به کدام رأی؟
۴. شرایط اقدام علیه صادرکننده و ضامن چک صیادی بر اساس ماده ۲۳ قانون صدور چک چیست؟

پاسخ را کاملاً ساختاریافته، با ذکر شماره دقیق آرا و مواد، به زبان فارسی حقوقی تدوین کنید.
"""

def evaluate_rag_adherence(text: str) -> dict:
    score = 0
    checks = {
        "cited_ruling_879": "۸۷۹" in text or "879" in text,
        "criminal_2_jurisdiction": any(k in text for k in ["کیفری دو", "کیفری ۲"]),
        "cited_ruling_877": "۸۷۷" in text or "877" in text,
        "bankruptcy_allowed": any(k in text for k in ["اداره تصفیه", "پرداخت", "تعلق می‌گیرد", "محاسبه"]),
        "cited_ruling_878": "۸۷۸" in text or "878" in text,
        "tazirat_jurisdiction": "تعزیرات" in text,
        "article_23_guarantor_distinction": "ضامن" in text and ("دادخواست" in text or "نمی‌شود" in text or "صادرکننده" in text)
    }
    
    if checks["cited_ruling_879"] and checks["criminal_2_jurisdiction"]: score += 25
    if checks["cited_ruling_877"] and checks["bankruptcy_allowed"]: score += 25
    if checks["cited_ruling_878"] and checks["tazirat_jurisdiction"]: score += 25
    if checks["article_23_guarantor_distinction"]: score += 25
    
    return {"score": score, "checks": checks}

async def benchmark_rag_model(client: httpx.AsyncClient, m: dict):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ghazihoushmand.ir",
        "X-Title": "RAG-Augmented Benchmark"
    }
    payload = {
        "model": m["id"],
        "messages": [
            {"role": "system", "content": "شما دستیار قضایی هستید که منحصراً بر مبنای اسناد و آرای وحدت رویه پیوست‌شده (کانتکست RAG) استدلال می‌کنید."},
            {"role": "user", "content": f"{RAG_INJECTED_CONTEXT}\n\n{USER_QUERY}"}
        ],
        "temperature": 0.05,
        "max_tokens": 1500
    }
    start = time.time()
    try:
        res = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=80.0)
        elapsed = round(time.time() - start, 2)
        if res.status_code == 200:
            data = res.json()
            usage = data.get("usage", {})
            p_tok = usage.get("prompt_tokens", 0)
            c_tok = usage.get("completion_tokens", 0)
            cost = ((p_tok / 1e6) * m["in_cost"]) + ((c_tok / 1e6) * m["out_cost"])
            content = data["choices"][0]["message"].get("content") or ""
            eval_res = evaluate_rag_adherence(content)
            return {
                "model": m["id"],
                "tier": m["tier"],
                "status": "OK",
                "time_sec": elapsed,
                "score": f"{eval_res['score']}/100",
                "tokens": f"{p_tok}+{c_tok}",
                "cost_usd": f"${cost:.6f}",
                "full_response": content,
                "checks": eval_res["checks"]
            }
        else:
            return {"model": m["id"], "tier": m["tier"], "status": f"HTTP {res.status_code}", "time_sec": elapsed, "score": "0/100", "cost_usd": "$0.0", "error": res.text[:90]}
    except Exception as e:
        return {"model": m["id"], "tier": m["tier"], "status": "TIMEOUT/ERR", "time_sec": round(time.time() - start, 2), "score": "0/100", "cost_usd": "$0.0", "error": str(e)}

async def main():
    print("=" * 110)
    print("⚖️  اجرای بنچمارک استدلال حقوقی مبتنی بر RAG (تزریق کانتکست قوانین و آرای وحدت رویه)")
    print("=" * 110)

    async with httpx.AsyncClient() as client:
        tasks = [benchmark_rag_model(client, m) for m in MODELS_TO_BENCHMARK]
        results = await asyncio.gather(*tasks)

    print(f"\n{'نام مدل':<32} | {'وضعیت':<8} | {'زمان':<8} | {'امتیاز RAG':<12} | {'هزینه تست':<12} | {'رده مدل'}")
    print("-" * 110)
    for r in sorted(results, key=lambda x: int(x.get("score", "0/100").split("/")[0]), reverse=True):
        print(f"{r['model'][:30]:<32} | {r['status']:<8} | {r.get('time_sec', 0)}s{'':<4} | {r.get('score', '0/100'):<12} | {r.get('cost_usd', '-'):<12} | {r['tier']}")

    out_file = "/opt/roxira_platform/data/rag_benchmark_results.json"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 110)
    print(f"✅ خروجی کامل پاسخ‌ها در فایل زیر ذخیره شد:\n   {out_file}")
    print("=" * 110)

if __name__ == "__main__":
    asyncio.run(main())
