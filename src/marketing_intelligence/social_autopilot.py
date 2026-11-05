# -*- coding: utf-8 -*-
"""
Autonomous Social Media & Brand Growth Engine (2026 Edition)
=============================================================
رصد خودکار رویدادها، تحلیل پرونده‌های جنجالی، تولید کاروسل اینستاگرام
و مقالات تحلیلی لینکدین برای برند شخصی و پلتفرم‌های قاضی هوشمند و روکسیرا.
"""
import pathlib
import sys


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[2]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


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

    llm_route = _llm_route()
    messages = [
        {"role": "system", "content": "شما دستیار ارشد تولید محتوای سازمانی و بازاریابی B2B/B2C هستید."},
        {"role": "user", "content": prompt},
    ]
    try:
        result = llm_route.route(
            "marketing",
            messages,
            llm_route.attempts_for("marketing", timeout=15.0),
            max_tokens=1000,
            public=True,
        )
    except (llm_route.AllAttemptsFailed, llm_route.CapReached) as exc:
        return {"status": "error", "message": str(exc)}
    return {"status": "success", "platform": platform, "content": result.text}


if __name__ == "__main__":
    sample_topic = "چگونه هوش مصنوعی قاضی هوشمند پرونده‌های چک صیادی را در کمتر از ۳ دقیقه تحلیل و لایحه دفاعی تنظیم می‌کند؟"
    res = generate_social_campaign(sample_topic, "linkedin")
    print("="*60)
    print("📢 نمونه پست تولیدشده توسط موتور هوشمند:")
    print("="*60)
    print(res.get("content", "Error"))
    print("="*60)
