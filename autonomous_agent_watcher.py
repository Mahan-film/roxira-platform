import time
import pathlib
import ast
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
BASE_DIR = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")

def audit_modules():
    logging.info("🔍 مانیتورینگ سلامت ماژول‌های فکتوری روکسیرا...")
    for mod_path in BASE_DIR.glob("*/*_module.py"):
        try:
            ast.parse(mod_path.read_text(encoding="utf-8"))
            logging.info(f"✅ ماژول سالم است: {mod_path.name}")
        except SyntaxError as err:
            logging.error(f"❌ خطای سینتکس در {mod_path.name}: {err}")

if __name__ == "__main__":
    audit_modules()
