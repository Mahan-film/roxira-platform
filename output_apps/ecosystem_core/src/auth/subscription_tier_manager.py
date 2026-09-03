"""
ROXIRA FREEMIUM & SUBSCRIPTION TIER ENGINE
مدیریت سطوح اشتراک (Free / Pro / Max) و تخصیص مدل زبانی متناسب
"""
from typing import Dict, Any

class SubscriptionTierManager:
    TIERS = {
        "FREE": {
            "tier_name": "رایگان (Free Tier)",
            "monthly_token_quota": 50000,
            "allowed_models": ["nvidia/nemotron-3-ultra:free", "z-ai/glm-5.2:free"],
            "features": ["مشاوره عمومی", "استعلام مواد قانونی", "جستجوی پایه"]
        },
        "PRO": {
            "tier_name": "حرفه‌ای (Pro Tier)",
            "monthly_token_quota": 500000,
            "allowed_models": ["deepseek/deepseek-v4-flash", "inclusionai/ling-3.0-flash"],
            "features": ["تنظیم خودکار دادخواست", "خسارت ماده ۵۲۲", "انبارداری FIFO", "سامانه مؤدیان"]
        },
        "MAX": {
            "tier_name": "فوق‌تخصصی سازمانی (Max / Enterprise Tier)",
            "monthly_token_quota": 2000000,
            "allowed_models": ["deepseek/deepseek-v4-pro", "openai/gpt-5.6-luna"],
            "features": ["لوایح ماده ۴۷۷", "اعاده دادرسی", "تحلیل عمیق قراردادها", "پشتیبانی اختصاصی"]
        }
    }

    @classmethod
    def get_tier_policy(cls, tier_code: str = "FREE") -> Dict[str, Any]:
        return cls.TIERS.get(tier_code.upper(), cls.TIERS["FREE"])

if __name__ == "__main__":
    p = SubscriptionTierManager.get_tier_policy("PRO")
    print("✅ تست سیستم اشتراک‌ها:")
    print(f"سطح: {p['tier_name']} | سهمیه: {p['monthly_token_quota']:,} توکن | مدل‌ها: {p['allowed_models']}")
