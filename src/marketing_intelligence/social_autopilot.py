# -*- coding: utf-8 -*-
"""
Autonomous Social Media & Brand Growth Engine (2026 Edition)
=============================================================
رصد خودکار رویدادها، تحلیل پرونده‌های جنجالی، تولید کاروسل اینستاگرام
و مقالات تحلیلی لینکدین برای برند شخصی و پلتفرم‌های قاضی هوشمند و روکسیرا.
"""
import os
import time
import json
import httpx

OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def generate_social_campaign(topic: str, platform: str = "linkedin") -> dict:
    prompt = f"""
    به عنوان یک استراتژیست ارشد برندینگ و محتوای هوش مصنوعی و حقوقی:
    یک پست فوق‌العاده جذاب، حرفه‌ای، ویروسی و تعاملی برای پلتفرم {platform} درباره موضوع زیر تدوین کنید:
    موضوع: {topic}

    الزامات ساختاری:
    1. قلاب آغازین (Hook) قوی در خط اول برای جلب توجه متخصصین.
    2. تحلیل فنی و کاربردی کوتاه در ۳ تا ۵ بند با ایموجی‌های مناسب.
    3. دعوت به اقدام (CTA) هوشمندانه به استفاده از دستیار حقوقی ghazihoushmand.ir و زیرساخت roxira.ir.
    4. هشتگ‌های تخصصی پربازدید و ارقام انگلیسی استاندارد (0-9).
    """

    headers = {
        "Authorization": f"Bearer {OPENROUTER_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "google/gemini-flash-1.5",
        "messages": [
            {"role": "system", "content": "شما دستیار ارشد تولید محتوای سازمانی و بازاریابی B2B/B2C هستید."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 1000
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            res = client.post(OPENROUTER_URL, headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                content = data["choices"][0]["message"]["content"]
                return {"status": "success", "platform": platform, "content": content}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Failed to generate"}

if __name__ == "__main__":
    sample_topic = "چگونه هوش مصنوعی قاضی هوشمند پرونده‌های چک صیادی را در کمتر از ۳ دقیقه تحلیل و لایحه دفاعی تنظیم می‌کند؟"
    res = generate_social_campaign(sample_topic, "linkedin")
    print("="*60)
    print("📢 نمونه پست تولیدشده توسط موتور هوشمند:")
    print("="*60)
    print(res.get("content", "Error"))
    print("="*60)
