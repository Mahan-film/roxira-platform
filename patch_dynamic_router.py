import pathlib

base_gen = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
for folder in base_gen.glob("*"):
    if folder.is_dir():
        (folder / "__init__.py").touch()
(base_gen / "__init__.py").touch()
(base_gen.parent / "__init__.py").touch()

server_path = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
content = server_path.read_text(encoding="utf-8")

router_code = '''
# === ROXIRA AUTONOMOUS DYNAMIC ROUTER LOADER ===
import importlib.util

def mount_enterprise_routers():
    modules_dir = pathlib.Path("/app/output_apps/generated_modules")
    if not modules_dir.exists():
        modules_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
    
    for mod_file in modules_dir.glob("*/*_module.py"):
        try:
            spec = importlib.util.spec_from_file_location(mod_file.stem, mod_file)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if hasattr(mod, "router"):
                app.include_router(mod.router)
                logger.info(f"✅ روتر ماژول {mod_file.stem} لود شد.")
        except Exception as err:
            logger.error(f"❌ خطا در لود {mod_file.name}: {err}")

mount_enterprise_routers()
'''

if "# === ROXIRA AUTONOMOUS DYNAMIC ROUTER LOADER ===" not in content:
    clean_lines = [l for l in content.splitlines() if "DYNAMIC ENTERPRISE MODULE LOADER" not in l and "output_apps.generated_modules" not in l]
    content = "\n".join(clean_lines) + "\n" + router_code
    server_path.write_text(content, encoding="utf-8")
    print("✅ لودر خودکار ماژول‌ها به هسته سرور متصل شد.")
else:
    print("ℹ️ لودر از قبل فعال است.")
