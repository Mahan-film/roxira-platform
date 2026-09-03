import pathlib

p = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
content = p.read_text(encoding="utf-8")

snippet = """
# --- Extended Software Factory Endpoints ---
try:
    code_vector_mod = dynamic_import("code_vector_engine", "output_apps/ecosystem_core/src/crawlers/code_vector_engine.py")

    class EnterpriseModuleGenRequest(BaseModel):
        module_name: str
        category: str = "ERP"  # CRM, ERP, Accounting, HR
        features: list[str]

    @app.post("/api/v1/factory/enterprise-module")
    async def api_generate_enterprise_module(payload: EnterpriseModuleGenRequest):
        prompt = f"طراحی و کدنویسی ماژول سازمانی {payload.module_name} در دسته {payload.category} با قابلیت‌های: {', '.join(payload.features)}. همراه با متدهای دیتابیس PostgreSQL و تست‌های Pydantic."
        return await factory_core_mod.RoxiraSoftwareFactory.synthesize_open_source_component(
            prompt, "FastAPI"
        )
except Exception as e:
    print(f"Extended factory routes load warning: {e}")
"""

if "api/v1/factory/enterprise-module" not in content:
    content += snippet
    p.write_text(content, encoding="utf-8")
    print("✅ اندپوینت‌های ماژول‌های سازمانی تزریق شدند.")
