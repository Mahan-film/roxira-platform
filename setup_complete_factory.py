import pathlib
import os

print("🚀 ۱. راه‌اندازی CodeVectorEngine در سرور...")

code_vector_path = pathlib.Path("/opt/roxira_platform/output_apps/ecosystem_core/src/crawlers/code_vector_engine.py")
code_vector_path.parent.mkdir(parents=True, exist_ok=True)
code_vector_code = """import os
import httpx
import logging
from typing import Dict, Any

logger = logging.getLogger("CodeVectorEngine")

class CodeVectorEngine:
    COLLECTION_NAME = "software_factory_code_vectors"

    @classmethod
    async def index_code_snippet(cls, snippet_id: int, file_path: str, code_content: str, metadata: Dict[str, Any]) -> bool:
        q_host = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
        q_port = os.getenv("QDRANT_PORT", "6333")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                point = {
                    "id": snippet_id,
                    "payload": {
                        "file_path": file_path,
                        "code": code_content[:2000],
                        "module_type": metadata.get("module_type", "general"),
                        "dependencies": metadata.get("dependencies", [])
                    }
                }
                res = await client.put(
                    f"http://{q_host}:{q_port}/collections/{cls.COLLECTION_NAME}/points",
                    json={"points": [point]}
                )
                return res.status_code == 200
        except Exception as e:
            logger.error(f"Error indexing code: {e}")
            return False
"""
code_vector_path.write_text(code_vector_code, encoding="utf-8")

print("🚀 ۲. تزریق اندپوینت‌های سازمانی به run_unified_server.py...")

p = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
content = p.read_text(encoding="utf-8")

snippet = """
# --- Roxira Software Factory & Enterprise Modules ---
try:
    factory_core_mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    code_vector_mod = dynamic_import("code_vector_engine", "output_apps/ecosystem_core/src/crawlers/code_vector_engine.py")

    class FactorySynthesisRequest(BaseModel):
        prompt: str
        target_framework: str = "FastAPI"

    class EnterpriseModuleGenRequest(BaseModel):
        module_name: str
        category: str = "ERP"  # CRM, ERP, Accounting, HR, Docling
        features: list[str]

    @app.post("/api/v1/factory/synthesize")
    async def api_factory_synthesize(payload: FactorySynthesisRequest):
        return await factory_core_mod.RoxiraSoftwareFactory.synthesize_open_source_component(
            payload.prompt, payload.target_framework
        )

    @app.post("/api/v1/factory/enterprise-module")
    async def api_generate_enterprise_module(payload: EnterpriseModuleGenRequest):
        prompt = f"طراحی و پیاده‌سازی ماژول سازمانی {payload.module_name} در رده {payload.category} با امکانات: {', '.join(payload.features)}. همراه با مدل‌های دیتابیس PostgreSQL، اسکیمای Pydantic و تست‌های اعتبارسنجی."
        return await factory_core_mod.RoxiraSoftwareFactory.synthesize_open_source_component(
            prompt, "FastAPI"
        )
except Exception as e:
    print(f"Factory routes load notice: {e}")
"""

if "/api/v1/factory/synthesize" not in content:
    content += snippet
    p.write_text(content, encoding="utf-8")
    print("✅ اندپوینت‌ها اضافه شدند.")
else:
    print("ℹ️ اندپوینت‌ها از قبل موجود بودند.")
