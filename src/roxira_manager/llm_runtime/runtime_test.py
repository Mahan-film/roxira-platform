
from src.roxira_manager.llm_runtime.provider_runtime import ProviderRuntime


runtime = ProviderRuntime()


result = runtime.generate(

    "deepseek/deepseek-chat",

    """
پرونده:
خریدار ملک هستم.
فروشنده از تنظیم سند رسمی خودداری می‌کند.

تحلیل حقوقی ارائه کن:
1- دعوای مناسب
2- مواد قانونی
3- ریسک پرونده
"""

)


print("=== ROXIRA LLM RESPONSE ===")
print(result)

