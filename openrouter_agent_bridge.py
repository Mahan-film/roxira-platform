import os
import requests
import json

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# ماتریس مدل‌های بهینه‌سازی‌شده
MODEL_TIERS = {
    "reasoning": "google/gemini-3.8-flash",
    "fast_execution": "deepseek/deepseek-v4-flash-latest",
    "coding_agent": "poolside/laguna-s-2.1:free",
    "heavy_statutory": "thinkingmachines/inkling:free",
    "zero_cost_fallback": "openrouter/free"
}

def dispatch_agent_task(prompt: str, tier: str = "reasoning", system_instruction: str = ""):
    model = MODEL_TIERS.get(tier, "google/gemini-3.8-flash")
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.net",
        "X-Title": "Roxira Autonomous Engine"
    }
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_instruction or "شما دستیار ارشد هوش مصنوعی پلتفرم روکسیرا و قاضی هوشمند هستید."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    }
    
    try:
        res = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=30)
        res.raise_fail_if_error = True
        data = res.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        # در صورت بروز خطا، سوئیچ خودکار به مدل بک‌آپ رایگان
        print(f"⚠️ ارجاع به Fallback Router به دلیل: {e}")
        payload["model"] = MODEL_TIERS["zero_cost_fallback"]
        res = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=30)
        return res.json()["choices"][0]["message"]["content"]

if __name__ == "__main__":
    print("🧠 تست موتور توزیع هوشمند مدل‌ها...")
    out = dispatch_agent_task("وضعیت ماده ۵۲۲ قانون آیین دادرسی مدنی را در یک جمله توضیح بده.", tier="fast_execution")
    print(f"پاسخ دریافتی: {out[:120]}...")
