import pathlib
import os

print("⚡ ۱. پیاده‌سازی Code-RAG و استخراج‌کننده تمیز کدهای پایتون در roxira_factory_core.py...")

factory_path = pathlib.Path("/opt/roxira_platform/output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
factory_code = '''import os
import httpx
import json
import logging
import pathlib
import re
import ast
from typing import Dict, Any, List

logger = logging.getLogger("RoxiraFactoryCore")

class RoxiraSoftwareFactory:
    @classmethod
    def get_output_dir(cls) -> pathlib.Path:
        for p in [pathlib.Path("/app/output_apps/generated_modules"), pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")]:
            try:
                p.mkdir(parents=True, exist_ok=True)
                return p
            except Exception:
                continue
        return pathlib.Path("/tmp/generated_modules")

    @classmethod
    def extract_clean_python_code(cls, raw_content: str) -> str:
        """استخراج خالص کدهای پایتون از بلاک‌های مارک‌داون"""
        code_blocks = re.findall(r"```python\s*(.*?)\s*```", raw_content, re.DOTALL)
        if code_blocks:
            return "\\n\\n# --- NEXT COMPONENT ---\\n\\n".join(code_blocks)
        raw_clean = re.sub(r"```.*?", "", raw_content)
        return raw_clean.strip()

    @classmethod
    async def retrieve_code_patterns(cls, query: str) -> str:
        """بازیابی نمونه کدهای مرتبط از Qdrant به عنوان زمینه معماری (Code-RAG)"""
        q_host = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
        q_port = os.getenv("QDRANT_PORT", "6333")
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.post(
                    f"http://{q_host}:{q_port}/collections/software_factory_code_vectors/points/scroll",
                    json={"limit": 2, "with_payload": True}
                )
                if res.status_code == 200:
                    points = res.json().get("result", {}).get("points", [])
                    snippets = [p.get("payload", {}).get("snippet", "") for p in points if p.get("payload")]
                    return "\\n---\\n".join(snippets[:2])
        except Exception:
            pass
        return ""

    @classmethod
    async def synthesize_and_save_module(cls, module_name: str, category: str, features: List[str], framework: str = "FastAPI") -> Dict[str, Any]:
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        
        base_dir = cls.get_output_dir()
        target_dir = base_dir / module_name.lower()
        target_dir.mkdir(parents=True, exist_ok=True)

        existing_patterns = await cls.retrieve_code_patterns(f"{module_name} {category}")

        system_prompt = f"""You are the Chief Software Architect for Roxira OS.
Design the complete enterprise module {module_name} in category {category} with features: {', '.join(features)}.
Architecture Standards: Python 3.12+, SQLAlchemy 2.0 Async, Pydantic v2 schemas, Dependency Injection, and production-ready FastAPI endpoints.

Roxira Codebase Context / Architectural Style:
{existing_patterns[:1200] if existing_patterns else 'Standard Modular Async FastAPI Architecture'}"""

        user_prompt = f"Write the complete, deployable Python code for enterprise module {module_name}."

        models = [
            "google/gemini-3.7-flash",
            "deepseek/deepseek-v4-flash",
            "z-ai/glm-5.3-flash"
        ]

        if openrouter_key:
            for model in models:
                try:
                    async with httpx.AsyncClient(timeout=180.0) as client:
                        resp = await client.post(
                            "[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)",
                            headers={
                                "Authorization": f"Bearer {openrouter_key}",
                                "HTTP-Referer": "[https://roxira.net](https://roxira.net)",
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
                            raw_content = resp.json()["choices"][0]["message"]["content"]
                            pure_code = cls.extract_clean_python_code(raw_content)
                            
                            # اعتبارسنجی سینتکس با AST
                            syntax_status = "valid"
                            try:
                                ast.parse(pure_code)
                            except Exception as syn_err:
                                syntax_status = f"partial_syntax_warning: {syn_err}"

                            out_file = target_dir / f"{module_name.lower()}_module.py"
                            out_file.write_text(pure_code, encoding="utf-8")

                            return {
                                "status": "success",
                                "module": module_name,
                                "category": category,
                                "syntax_validation": syntax_status,
                                "file_name": out_file.name,
                                "saved_path": f"/opt/roxira_platform/output_apps/generated_modules/{module_name.lower()}/{out_file.name}",
                                "model_used": model,
                                "message": f"ماژول {module_name} با موفقیت تولید و با اعتبارسنجی AST روی دیسک ذخیره شد."
                            }
                except Exception as ex:
                    logger.warning(f"Failed with {model}: {ex}")
                    continue

        return {"status": "error", "message": "خطا در اتصال به موتور هوش مصنوعی."}
'''
factory_path.write_text(factory_code, encoding="utf-8")
print("✅ ۱. ماژول کارخانه نرم‌افزار مجهز به Code-RAG و اعتبارسنجی AST به‌روزرسانی شد.")
