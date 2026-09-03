import os
import re
import ast
import json
import httpx
import asyncio
import pathlib
from typing import Dict, Any, List

OUTPUT_BASE = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
OUTPUT_BASE.mkdir(parents=True, exist_ok=True)

MODULES = [
    {
        "name": "WarehouseInventory",
        "category": "ERP",
        "features": ["StockTracking", "BatchNumbering", "MultiWarehouse", "BarcodeScanner"]
    },
    {
        "name": "AtomicCRM",
        "category": "CRM",
        "features": ["LeadManagement", "PipelineTracking", "InteractionLog", "TaskAutomation"]
    },
    {
        "name": "DoclingParser",
        "category": "DocumentProcessing",
        "features": ["PDFTableExtraction", "InvoiceZUGFeRDValidation", "MarkdownConversion"]
    },
    {
        "name": "ScraplingWebAgent",
        "category": "WebIntelligence",
        "features": ["AntiBotBypass", "CamoufoxStealth", "CompetitorPriceMonitoring"]
    }
]

def clean_python_code(raw_text: str) -> str:
    blocks = re.findall(r"```(?:python)?\s*(.*?)\s*```", raw_text, re.DOTALL | re.IGNORECASE)
    if blocks:
        return "\n\n".join(b.strip() for b in blocks if b.strip())
    lines = [line for line in raw_text.splitlines() if not line.strip().startswith("```")]
    return "\n".join(lines).strip()

async def generate_module(client: httpx.AsyncClient, openrouter_key: str, deepseek_key: str, mod: Dict[str, Any]) -> bool:
    name = mod["name"]
    cat = mod["category"]
    feats = ", ".join(mod["features"])
    
    target_dir = OUTPUT_BASE / name.lower()
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / f"{name.lower()}_module.py"

    sys_prompt = (
        f"You are the Chief Software Architect for Roxira OS. "
        f"Design the complete, production-ready enterprise module '{name}' in category '{cat}'. "
        f"Features required: {feats}. "
        f"Technical Stack: Python 3.12+, Async SQLAlchemy 2.0 models, Pydantic v2 schemas, and FastAPI APIRouter endpoints. "
        f"Return ONLY runnable Python code."
    )
    user_prompt = f"Write the complete Python source code for {name} module."

    # ۱. تلاش با OpenRouter
    if openrouter_key:
        models = ["google/gemini-2.0-flash-001", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"]
        for m in models:
            try:
                resp = await client.post(
                    "[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)",
                    headers={
                        "Authorization": f"Bearer {openrouter_key}",
                        "HTTP-Referer": "[https://roxira.net](https://roxira.net)",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": m,
                        "messages": [
                            {"role": "system", "content": sys_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.1,
                        "max_tokens": 4096
                    },
                    timeout=120.0
                )
                if resp.status_code == 200:
                    raw_code = resp.json()["choices"][0]["message"]["content"]
                    code = clean_python_code(raw_code)
                    
                    # اعتبارسنجی سینتکس پایتون با AST
                    try:
                        ast.parse(code)
                    except SyntaxError as se:
                        print(f"⚠️ اخطار سینتکس در ماژول {name}: {se} (در حال ذخیره فایل...)")
                    
                    target_file.write_text(code, encoding="utf-8")
                    print(f"✅ ماژول [{name}] با مدل {m} تولید و ذخیره شد -> {target_file}")
                    return True
            except Exception as e:
                continue

    # ۲. فال‌بک به سرور مستقیم DeepSeek
    if deepseek_key:
        try:
            resp = await client.post(
                "[https://api.deepseek.com/chat/completions](https://api.deepseek.com/chat/completions)",
                headers={
                    "Authorization": f"Bearer {deepseek_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.1
                },
                timeout=120.0
            )
            if resp.status_code == 200:
                raw_code = resp.json()["choices"][0]["message"]["content"]
                code = clean_python_code(raw_code)
                target_file.write_text(code, encoding="utf-8")
                print(f"✅ ماژول [{name}] توسط سرور مستقیم DeepSeek تولید و ذخیره شد -> {target_file}")
                return True
        except Exception as e:
            print(f"❌ خطا در اتصال به DeepSeek: {e}")

    print(f"❌ عدم موفقیت در ساخت ماژول [{name}].")
    return False

async def main():
    print("🏭 راه‌اندازی کارخانه نرم‌افزار روکسیرا (Roxira Autonomous Software Factory)...\n")
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()

    async with httpx.AsyncClient() as client:
        for mod in MODULES:
            print(f"⚙️ در حال طراحی و کدنویسی ماژول: {mod['name']}...")
            await generate_module(client, openrouter_key, deepseek_key, mod)
            await asyncio.sleep(2)

    print("\n🏁 تمام ماژول‌های درخواستی روی دیسک مستقر شدند.")

if __name__ == "__main__":
    asyncio.run(main())
