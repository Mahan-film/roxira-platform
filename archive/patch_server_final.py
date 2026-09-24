import pathlib

# ساخت __init__.py در تمام زیرپوشه‌ها
base_gen = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
for folder in base_gen.glob("*"):
    if folder.is_dir():
        (folder / "__init__.py").touch()
(base_gen / "__init__.py").touch()
(base_gen.parent / "__init__.py").touch()

srv_file = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
code = srv_file.read_text(encoding="utf-8")

# حذف لودرهای تکراری و افزودن لودر استاندارد
clean_lines = [l for l in code.splitlines() if "DYNAMIC ENTERPRISE MODULE LOADER" not in l and "ROXIRA AUTONOMOUS DYNAMIC ROUTER LOADER" not in l and "mount_enterprise_routers" not in l]
clean_code = "\n".join(clean_lines)

injection = """
# === ROXIRA AUTONOMOUS DYNAMIC ROUTER LOADER ===
import importlib.util

def mount_enterprise_routers():
    mod_paths = [
        pathlib.Path("/app/output_apps/generated_modules"),
        pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
    ]
    target_dir = next((p for p in mod_paths if p.exists()), None)
    if not target_dir:
        return

    for mod_file in target_dir.glob("*/*_module.py"):
        try:
            spec = importlib.util.spec_from_file_location(mod_file.stem, str(mod_file))
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                if hasattr(mod, "router"):
                    app.include_router(mod.router)
                    logger.info(f"✅ روتر ماژول {mod_file.stem} با موفقیت لود شد.")
        except Exception as err:
            logger.error(f"❌ خطا در بارگذاری {mod_file.name}: {err}")

mount_enterprise_routers()
"""

srv_file.write_text(clean_code + "\n" + injection, encoding="utf-8")
print("✅ فایل سرور با لودر داینامیک بازنویسی شد.")
