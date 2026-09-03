import pathlib
import os

print("🚀 ۱. بازنویسی کامل و بدون نقص ماژول roxira_factory_core.py...")

factory_path = pathlib.Path("/opt/roxira_platform/output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
factory_path.parent.mkdir(parents=True, exist_ok=True)

factory_code = '''import os
import httpx
import ast
import json
import logging
from typing import Dict, Any, List

logger = logging.getLogger("RoxiraFactoryCore")

class RoxiraSoftwareFactory:
    """موتور پردازش، تحلیل سورس‌کد و بازتولید هوشمند سیستم‌های نرم‌افزاری"""

    @staticmethod
    def analyze_python_ast(source_code: str) -> Dict[str, Any]:
        """تجزیه ساختار دستوری (AST) برای استخراج کلاس‌ها، توابع و وابستگی‌ها"""
        try:
            tree = ast.parse(source_code)
            classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
            functions = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
            imports = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for n in node.names:
                        imports.append(n.name)
                elif isinstance(node, ast.ImportFrom):
                    imports.append(node.module or "")
            return {
                "status": "success",
                "classes_found": classes,
                "functions_found": functions,
                "dependencies": list(set(imports)),
                "complexity_score": len(classes) * 3 + len(functions)
            }
        except Exception as e:
            return {"status": "error", "error_message": str(e)}

    @classmethod
    async def synthesize_open_source_component(cls, spec_prompt: str, target_framework: str = "FastAPI") -> Dict[str, Any]:
        """طراحی و پیاده‌سازی خودکار کامپوننت‌های نرم‌افزاری با مدل‌های استنتاج کُد"""
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        
        system_prompt = f"""شما معمار ارشد سیستم‌های نرم‌افزاری و مهندس خودکار روکسیرا (Roxira OS) هستید.
وظیفه شما: دریافت نیازمندی و تولید کدهای ماژولار، استاندارد، ایمن و بهینه در فریم‌ورک {target_framework}.
الزامات:
۱. استفاده از Type Hinting کامل و الگوهای مدرن پایتون ۳.۱۲+.
۲. ساختار تمیز بدون وابستگی‌های سنگین غیرضروری.
۳. افزودن Docstring کامل و کدهای Unit Test استاندارد."""

        # زنجیره مدل‌های کدنویسی و معماری بهینه
        models_to_try = [
            "google/gemini-3.7-flash",
            "deepseek/deepseek-v4-flash",
            "deepseek/deepseek-v4-pro",
            "qwen/qwen-3.8-2.4t-a95b"
        ]

        if openrouter_key:
            for model in models_to_try:
                try:
                    async with httpx.AsyncClient(timeout=45.0) as client:
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
                                    {"role": "user", "content": f"طراحی و ساخت ماژول زیر:\\n{spec_prompt}"}
                                ],
                                "temperature": 0.1,
                                "max_tokens": 4096
                            }
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            generated_code = data["choices"][0]["message"]["content"]
                            return {
                                "status": "success",
                                "model_engine": model,
                                "synthesized_code": generated_code
                            }
                except Exception as ex:
                    logger.warning(f"Synthesis failed with {model}: {ex}")
                    continue

        if deepseek_key:
            try:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    resp = await client.post(
                        "https://api.deepseek.com/chat/completions",
                        headers={
                            "Authorization": f"Bearer {deepseek_key}",
                            "Content-Type": "application/json"
                        },
                        json={
                            "model": "deepseek-chat",
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": f"طراحی و ساخت ماژول زیر:\\n{spec_prompt}"}
                            ],
                            "temperature": 0.1
                        }
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return {
                            "status": "success",
                            "model_engine": "deepseek-direct",
                            "synthesized_code": data["choices"][0]["message"]["content"]
                        }
            except Exception as ex:
                logger.error(f"DeepSeek direct synthesis failed: {ex}")

        return {"status": "failed", "message": "خطا در اتصال به موتورهای تولید کد."}
'''
factory_path.write_text(factory_code, encoding="utf-8")
print("✅ ۱. فایل roxira_factory_core.py با کدهای کامل ذخیره شد.")

print("🚀 ۲. تمیزکاری و ثبت استاندارد روت‌ها در run_unified_server.py...")

server_file = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
server_code = server_file.read_text(encoding="utf-8")

# حذف بلاک‌های تکراری و خراب قبلی
clean_lines = []
skip = False
for line in server_code.splitlines():
    if "# --- Roxira Software Factory" in line or "# ==========================================" in line:
        skip = True
    if skip and line.startswith("if __name__ =="):
        skip = False
    if not skip:
        clean_lines.append(line)

cleaned_code = "\n".join(clean_lines)

factory_routes = """
# ==========================================
# ROXIRA AUTONOMOUS SOFTWARE FACTORY ROUTES
# ==========================================
class FactorySynthesisRequest(BaseModel):
    prompt: str
    target_framework: str = "FastAPI"

class EnterpriseModuleGenRequest(BaseModel):
    module_name: str
    category: str = "ERP"
    features: list[str]

@app.post("/api/v1/factory/synthesize")
async def api_factory_synthesize(payload: FactorySynthesisRequest):
    mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    return await mod.RoxiraSoftwareFactory.synthesize_open_source_component(
        payload.prompt, payload.target_framework
    )

@app.post("/api/v1/factory/enterprise-module")
async def api_generate_enterprise_module(payload: EnterpriseModuleGenRequest):
    mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    spec = f"طراحی و پیاده‌سازی ماژول سازمانی {payload.module_name} در رده {payload.category} با امکانات: {', '.join(payload.features)}. همراه با مدل‌های دیتابیس PostgreSQL، اسکیمای Pydantic و تست‌های اعتبارسنجی."
    return await mod.RoxiraSoftwareFactory.synthesize_open_source_component(
        spec, "FastAPI"
    )

if __name__ == "__main__":
"""

if 'if __name__ == "__main__":' in cleaned_code:
    final_code = cleaned_code.replace('if __name__ == "__main__":', factory_routes)
else:
    final_code = cleaned_code + "\n" + factory_routes

server_file.write_text(final_code, encoding="utf-8")
print("✅ ۲. فایل run_unified_server.py بازسازی و اصلاح شد.")
