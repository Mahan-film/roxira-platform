import pathlib
import os

print("⚡ بازنویسی roxira_factory_core.py با سیستم گزارش دقیق خطا و Fallback مستقیم...")

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
        code_blocks = re.findall(r"```(?:python)?\s*(.*?)\s*```", raw_content, re.DOTALL)
        if code_blocks:
            return "\\n\\n# --- COMPONENT ---\\n\\n".join(b.strip() for b in code_blocks if b.strip())
        raw_clean = re.sub(r"```.*?", "", raw_content)
        return raw_clean.strip()

    @classmethod
    async def retrieve_code_patterns(cls, query: str) -> str:
        q_host = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
        q_port = os.getenv("QDRANT_PORT", "6333")
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.post(
                    f"http://{q_host}:{q_port}/collections/software_factory_code_vectors/points/scroll",
                    json={"limit": 2, "with_payload": True}
                )
                if res.status_code == 200:
                    points = res.json().get("result", {}).get("points", [])
                    snippets = [p.get("payload", {}).get("snippet", "") for p in points if p.get("payload")]
                    return "\\n---\\n".join(snippets[:1])
        except Exception:
            pass
        return ""

    @classmethod
    async def synthesize_and_save_module(cls, module_name: str, category: str, features: List[str], framework: str = "FastAPI") -> Dict[str, Any]:
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        
        base_dir = cls.get_output_dir()
        target_dir = base_dir / module_name.lower()
        target_dir.mkdir(parents=True, exist_ok=True)

        existing_patterns = await cls.retrieve_code_patterns(f"{module_name} {category}")

        system_prompt = f"""You are the Chief Software Architect for Roxira OS.
Design the complete enterprise module {module_name} in category {category} with features: {', '.join(features)}.
Architecture Standards: Python 3.12+, SQLAlchemy 2.0 Async, Pydantic v2 schemas, Dependency Injection, and production-ready FastAPI endpoints."""

        user_prompt = f"Write the complete, deployable Python code for enterprise module {module_name} with all models, schemas, and routes."

        models = [
            "google/gemini-2.5-flash",
            "deepseek/deepseek-chat",
            "meta-llama/llama-3.3-70b-instruct",
            "nvidia/nemotron-3-ultra:free"
        ]

        last_errors = []

        # ۱. تلاش از طریق OpenRouter
        if openrouter_key:
            for model in models:
                try:
                    async with httpx.AsyncClient(timeout=120.0) as client:
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
                            out_file = target_dir / f"{module_name.lower()}_module.py"
                            out_file.write_text(pure_code, encoding="utf-8")

                            return {
                                "status": "success",
                                "module": module_name,
                                "category": category,
                                "file_name": out_file.name,
                                "saved_path": f"/opt/roxira_platform/output_apps/generated_modules/{module_name.lower()}/{out_file.name}",
                                "model_used": model,
                                "message": f"ماژول {module_name} با موفقیت روی دیسک ذخیره شد."
                            }
                        else:
                            last_errors.append(f"OpenRouter [{model}]: HTTP {resp.status_code} - {resp.text[:120]}")
                except Exception as ex:
                    last_errors.append(f"OpenRouter [{model}]: {str(ex)}")

        # ۲. تلاش از طریق اتصال مستقیم به DeepSeek (Fallback)
        if deepseek_key:
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    resp = await client.post(
                        "[https://api.deepseek.com/chat/completions](https://api.deepseek.com/chat/completions)",
                        headers={
                            "Authorization": f"Bearer {deepseek_key}",
                            "Content-Type": "application/json"
                        },
                        json={
                            "model": "deepseek-chat",
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt}
                            ],
                            "temperature": 0.1
                        }
                    )
                    if resp.status_code == 200:
                        raw_content = resp.json()["choices"][0]["message"]["content"]
                        pure_code = cls.extract_clean_python_code(raw_content)
                        out_file = target_dir / f"{module_name.lower()}_module.py"
                        out_file.write_text(pure_code, encoding="utf-8")
                        return {
                            "status": "success",
                            "module": module_name,
                            "category": category,
                            "file_name": out_file.name,
                            "saved_path": f"/opt/roxira_platform/output_apps/generated_modules/{module_name.lower()}/{out_file.name}",
                            "model_used": "deepseek-direct",
                            "message": f"ماژول {module_name} با موفقیت توسط سرور مستقیم DeepSeek تولید و ذخیره شد."
                        }
                    else:
                        last_errors.append(f"DeepSeek Direct: HTTP {resp.status_code} - {resp.text[:120]}")
            except Exception as ex:
                last_errors.append(f"DeepSeek Direct: {str(ex)}")

        return {
            "status": "error",
            "message": "عدم موفقیت در اتصال به مدل‌ها.",
            "details": last_errors
        }
'''
factory_path.write_text(factory_code, encoding="utf-8")
print("✅ roxira_factory_core.py با سیستم خطایابی تفصیلی به‌روز شد.")
