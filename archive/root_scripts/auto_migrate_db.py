import asyncio
import os
import pathlib
import importlib.util
from sqlalchemy.ext.asyncio import create_async_engine

DB_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://roxira_user:roxira_pass@localhost:5432/roxira_os")

async def init_tables():
    engine = create_async_engine(DB_URL, echo=False)
    base_gen = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
    
    for mod_file in base_gen.glob("*/*_module.py"):
        try:
            spec = importlib.util.spec_from_file_location(mod_file.stem, mod_file)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if hasattr(mod, "Base"):
                async with engine.begin() as conn:
                    await conn.run_sync(mod.Base.metadata.create_all)
                print(f"🗄️ جداول ماژول [{mod_file.stem}] در دیتابیس ساخته شدند.")
        except Exception as e:
            print(f"⚠️ ساخت جدول برای {mod_file.name}: {e}")
            
    await engine.dispose()
    print("🏁 عملیات دیتابیس کامل شد.")

if __name__ == "__main__":
    asyncio.run(init_tables())
