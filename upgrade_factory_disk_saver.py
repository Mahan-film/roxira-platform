import pathlib
import os

print("📁 ۱. ارتقای کارخانه نرم‌افزار به قابلیت ذخیره‌سازی خودکار ماژول‌ها روی دیسک...")

factory_path = pathlib.Path("/opt/roxira_platform/output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
factory_code = '''import os
import httpx
import ast
import json
import logging
import pathlib
from typing import Dict, Any, List

logger = logging.getLogger("RoxiraFactoryCore")

MODULES_OUTPUT_DIR = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
MODULES_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

class RoxiraSoftwareFactory:
    """موتور پردازش، تحلیل سورس‌کد و بازتولید هوشمند سیستم‌های نرم‌افزاری"""

    @classmethod
    async def synthesize_and_save_module(cls, module_name: str, category: str, features: list[str], framework: str = "FastAPI") -> Dict[str, Any]:
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        
        target_dir = MODULES_OUTPUT_DIR / module_name.lower()
        target_dir.mkdir(parents=True, exist_ok=True)

        system_prompt = f"""شما معمار ارشد سیستم‌های نرم‌افزاری در کارخانه نرم‌افزار روکسیرا (Roxira OS) هستید.
وظیفه: طراحی کامل ماژول سازمانی {module_name} در دسته {category} با امکانات: {', '.join(features)}.
الزامات:
۱. استفاده از پایتون ۳.۱۲+، SQLAlchemy 2.0 Async و Pydantic v2.
۲. کدهای کامل بدون حذف هیچ تابعی.
۳. تفکیک به فایل‌های استاندارد."""

        user_prompt = f"کدهای کامل ماژول {module_name} شامل مدل‌های دیتابیس، اسکیماهای اعتبارسنجی و روت‌های API را تولید کن."

        models = [
            "google/gemini-3.7-flash",
            "deepseek/deepseek-v4-flash",
            "deepseek/deepseek-v4-pro"
        ]

        if openrouter_key:
            for model in models:
                try:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {openrouter_key}",
                                "HTTP-Referer": "https://roxira.net",
                                "X-Title": "Roxira Software Factory",
                                "Content-Type": "application/json"
                            },
                            json={
                                "model": model,
                                "messages": [
                                    {"role": "system", "content": system_prompt},
                                    {"role": "user", "content": user_prompt}
                                ],
                                "temperature": 0.1,
                                "max_tokens": 4096
                            }
                        )
                        if resp.status_code == 200:
                            content = resp.json()["choices"][0]["message"]["content"]
                            # ذخیره خروجی کامل در فایل ماژول
                            output_file = target_dir / f"{module_name.lower()}_bundle.py"
                            output_file.write_text(content, encoding="utf-8")
                            
                            return {
                                "status": "success",
                                "module": module_name,
                                "category": category,
                                "saved_path": str(output_file),
                                "model_used": model,
                                "message": f"ماژول با موفقیت تولید و در مسیر {output_file} ذخیره گردید."
                            }
                except Exception as ex:
                    logger.warning(f"Failed with {model}: {ex}")
                    continue

        return {"status": "error", "message": "خطا در برقراری ارتباط با مدل‌های هوش مصنوعی."}
'''
factory_path.write_text(factory_code, encoding="utf-8")
print("✅ ۱. فایل roxira_factory_core.py با قابلیت Disk-Persistence به‌روز شد.")

print("📁 ۲. اصلاح روت در run_unified_server.py...")
server_file = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
server_code = server_file.read_text(encoding="utf-8")

new_route_block = """
@app.post("/api/v1/factory/enterprise-module")
async def api_generate_enterprise_module(payload: EnterpriseModuleGenRequest):
    mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    return await mod.RoxiraSoftwareFactory.synthesize_and_save_module(
        payload.module_name, payload.category, payload.features
    )
"""

if "synthesize_and_save_module" not in server_code:
    server_code = server_code.replace(
        'return await mod.RoxiraSoftwareFactory.synthesize_open_source_component(',
        'return await mod.RoxiraSoftwareFactory.synthesize_and_save_module(payload.module_name, payload.category, payload.features) #'
    )
    server_file.write_text(server_code, encoding="utf-8")
    print("✅ ۲. روت ذخیره‌ساز در فایل سرور به‌روزرسانی شد.")
