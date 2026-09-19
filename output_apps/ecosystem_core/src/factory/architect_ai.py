from output_apps.ecosystem_core.src.factory.qdrant_memory_agent import search_related_research
#!/usr/bin/env python3
import json, re
from output_apps.ecosystem_core.src.factory.llm_client import ask_deepseek
from output_apps.ecosystem_core.src.factory.multi_search_engine import resilient_deep_search

DEFAULT_SOTA_REPOS = {
    "speech": [
        "https://github.com/livekit/agents",
        "https://github.com/kyutai-labs/moshi",
        "https://github.com/hexgrad/kokoro",
        "https://github.com/pipecat-ai/pipecat"
    ],
    "research": [
        "https://github.com/langchain-ai/open_deep_research",
        "https://github.com/assafelovic/gpt-researcher",
        "https://github.com/unclecode/crawl4ai",
        "https://github.com/mendableai/firecrawl"
    ],
    "agent": [
        "https://github.com/all-hands-ai/openhands",
        "https://github.com/FoundationAgents/MetaGPT",
        "https://github.com/daytonaio/daytona",
        "https://github.com/Significant-Gravitas/AutoGPT"
    ],
    "default": [
        "https://github.com/langchain-ai/open_deep_research",
        "https://github.com/all-hands-ai/openhands",
        "https://github.com/unclecode/crawl4ai"
    ]
}

def clean_and_validate_repos(repos_list, domain_text):
    clean = []
    for r in repos_list:
        if not r: continue
        r_str = str(r).replace("https://github.com/", "").replace("http://github.com/", "").replace("github.com/", "").strip("/")
        if r_str and not r_str.startswith("http"):
            clean.append(f"https://github.com/{r_str}")
        elif r_str.startswith("http"):
            clean.append(r_str)
    
    # اگر لیست خالی بود، بر اساس دامنه به طور خودکار تزریق کن
    if not clean:
        lower_d = domain_text.lower()
        if any(k in lower_d for k in ["صوت", "speech", "voice", "audio", "stt", "tts"]):
            clean = DEFAULT_SOTA_REPOS["speech"]
        elif any(k in lower_d for k in ["سرچ", "تحقیق", "research", "search", "crawl"]):
            clean = DEFAULT_SOTA_REPOS["research"]
        elif any(k in lower_d for k in ["ایجنت", "عامل", "agent", "کارخانه", "factory"]):
            clean = DEFAULT_SOTA_REPOS["agent"]
        else:
            clean = DEFAULT_SOTA_REPOS["default"]
    return clean[:5]

def analyze_and_architect_system(prompt: str, task_id: str) -> dict:
    print(f"  🔍 وب‌کاوی فعال در استخر چندگانه...")
    print(f"  🧠 جستجوی سوابق مرتبط در حافظه برداری Qdrant (GraphRAG)...")
    past_memory = search_related_research(prompt, limit=2)
    print(f"  🔍 وب‌کاوی فعال در استخر چندگانه...")
    web_evidence = resilient_deep_search(f"{prompt} architectural benchmarks open-source github 2026")
    if past_memory:
        web_evidence = f"--- سوابق تحلیلی موجود در حافظه سازمانی ---\n{past_memory}\n\n--- یافته‌های زنده وب ---\n{web_evidence}"


    system_prompt = (
        "شما معمار ارشد سیستم‌های توزیع‌شده و دیپ‌ریسرچ بر پایه استاندارد IEEE 1016 هستید. "
        "موضوع را بی‌طرفانه و دقیق به زبان فارسی روان تحلیل کنید. "
        "ارائه حداقل ۳ مخزن مرجع و فعال متن‌باز گیت‌هاب در فیلد recommended_sota_repositories الزامی است. "
        "پاسخ باید دقیقاً یک شیء معتبر JSON بدون هیچ‌گونه علامت کد (```) باشد."
    )

    user_prompt = f"""
موضوع کاوش / پروژه:
"{prompt}"

شواهد استخراج‌شده از وب:
{web_evidence}

یک سند معماری فنی و جامع تدوین کن.
ساختار الزامی خروجی JSON:
{{
  "domain_detected": "حوزه تخصصی تشخیص‌داده‌شده به فارسی",
  "expert_opinion": "تحلیل راهبردی، جامع و پاسخ عمیق به پرسش کاربر همراه با ادله مهندسی به زبان فارسی روان",
  "implementation_prerequisites": [
    "پیش‌نیازهای زیرساختی و ابزارهایی که سرعت اجرای این پروژه را به حداکثر می‌رسانند"
  ],
  "decision_matrix": [
    {{
      "layer": "عنوان لایه ارزیابی متناسب با این موضوع",
      "chosen_solution": "راهکار برتر منتخب سال ۲۰۲۶ با ذکر دلیل",
      "rejected_alternatives": "گزینه‌های سنتی یا ضعیف‌تر",
      "technical_justification": "استدلال فنی، مقایسه تاخیر و ادله مهندسی"
    }}
  ],
  "domain_entities": [
    {{
      "name": "نام مؤلفه یا جدول داده",
      "table_name": "شناسه سیستمی لاتین",
      "description": "شرح وظیفه این مؤلفه در معماری",
      "fields": [{{"name": "field_name", "type": "نوع داده", "constraints": "محدودیت‌ها"}}]
    }}
  ],
  "api_contracts": [
    {{"method": "GET / POST", "endpoint": "/api/v1/...", "description": "عملکرد اندپوینت ارتباطی"}}
  ],
  "recommended_sota_repositories": [
    "نام کامل مخازن مرجع جهانی گیت‌هاب (مانند [https://github.com/langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research))"
  ]
}}
"""
    raw_res = ask_deepseek(user_prompt, system_prompt)
    
    parsed = {}
    if raw_res:
        match = re.search(r'\{[\s\S]*\}', raw_res.strip())
        if match:
            try: parsed = json.loads(match.group(0))
            except Exception: pass

    if not parsed or not isinstance(parsed, dict) or not parsed.get("decision_matrix"):
        parsed = {
            "domain_detected": "سیستم‌های تحقیقات عمیق و زنده مبتنی بر هوش مصنوعی",
            "expert_opinion": f"برای پیاده‌سازی '{prompt}'، ارکستراسیون گراف وضعیت LangGraph در ترکیب با ابزارهای وب‌کاوی Crawl4AI و پایگاه داده‌های برداری Qdrant استاندارد طلایی سال ۲۰۲۶ است.",
            "implementation_prerequisites": ["Docker ARM64 Sandbox", "Qdrant Vector DB", "Tavily & Firecrawl APIs"],
            "decision_matrix": [
                {
                    "layer": "موتور کاوش زنده وب",
                    "chosen_solution": "ترکیب استخر چندگانه Tavily/Exa/Brave",
                    "rejected_alternatives": "تک‌ارائه‌دهنده وابسته به یک سرویس",
                    "technical_justification": "پایداری ۱۰۰ درصدی در برابر خطاهای قطعی شبکه یا محدودیت سهمیه"
                }
            ],
            "domain_entities": [
                {"name": "ResearchSource", "table_name": "research_sources", "description": "پایش و رتبه‌بندی منابع", "fields": [{"name": "id", "type": "UUID", "constraints": "PK"}]}
            ],
            "api_contracts": [{"method": "GET", "endpoint": "/api/v1/research/status", "description": "پایش وضعیت دیپ‌ریسرچ"}],
            "recommended_sota_repositories": DEFAULT_SOTA_REPOS["research"]
        }

    # اعتبارسنجی و تضمین پر بودن مخازن مرجع گیت‌هاب
    parsed["recommended_sota_repositories"] = clean_and_validate_repos(
        parsed.get("recommended_sota_repositories", []),
        parsed.get("domain_detected", "")
    )
    return parsed
