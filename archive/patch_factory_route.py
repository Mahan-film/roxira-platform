import pathlib

p = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
content = p.read_text(encoding="utf-8")

snippet = """
# --- Roxira Software Factory Endpoints ---
try:
    factory_core_mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")

    class FactorySynthesisRequest(BaseModel):
        prompt: str
        target_framework: str = "FastAPI"

    @app.post("/api/v1/factory/synthesize")
    async def api_factory_synthesize(payload: FactorySynthesisRequest):
        return await factory_core_mod.RoxiraSoftwareFactory.synthesize_open_source_component(
            payload.prompt, payload.target_framework
        )
except Exception as e:
    print(f"Factory route load warning: {e}")
"""

if "api/v1/factory/synthesize" not in content:
    content += snippet
    p.write_text(content, encoding="utf-8")
    print("✅ اندپوینت کارخانه نرم‌افزار به سرور تزریق شد.")
