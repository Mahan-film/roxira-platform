import pathlib

p = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
code = p.read_text(encoding="utf-8")

clean_lines = []
skip = False
for line in code.splitlines():
    if "# ==========================================" in line or "# --- Roxira Software Factory" in line:
        skip = True
    if skip and line.startswith("if __name__ =="):
        skip = False
    if not skip:
        clean_lines.append(line)

base_code = "\n".join(clean_lines)

routes = """
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

@app.post("/api/v1/factory/enterprise-module")
async def api_generate_enterprise_module(payload: EnterpriseModuleGenRequest):
    mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    return await mod.RoxiraSoftwareFactory.synthesize_and_save_module(
        payload.module_name, payload.category, payload.features
    )

if __name__ == "__main__":
"""

if 'if __name__ == "__main__":' in base_code:
    final_code = base_code.replace('if __name__ == "__main__":', routes)
else:
    final_code = base_code + "\n" + routes

p.write_text(final_code, encoding="utf-8")
print("✅ روت‌های کارخانه نرم‌افزار با موفقیت به‌روزرسانی شدند.")
