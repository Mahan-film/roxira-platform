import subprocess
import json

# پیدا کردن IP دیتابیس PostgreSQL در شبکه داکر
try:
    inspect_cmd = subprocess.check_output(
        "docker inspect roxira_postgres_prod || docker inspect roxira_db_prod", 
        shell=True, stderr=subprocess.DEVNULL
    ).decode("utf-8")
    data = json.loads(inspect_cmd)
    networks = data[0]["NetworkSettings"]["Networks"]
    net_name = list(networks.keys())[0]
    db_ip = networks[net_name]["IPAddress"]
    print(f"🔍 آی‌پی کانتینر PostgreSQL شناسایی شد: {db_ip}")
except Exception:
    db_ip = "127.0.0.1"
    print("ℹ️ استفاده از آدرس لوکال دیتابیس.")

migration_script = f"""
import asyncio, os, pathlib, importlib.util
from sqlalchemy.ext.asyncio import create_async_engine

db_url = 'postgresql+asyncpg://roxira_user:roxira_pass@{db_ip}:5432/roxira_os'

async def run_migration():
    engine = create_async_engine(db_url, echo=False)
    base = pathlib.Path('/app/output_apps/generated_modules')
    for mod_file in base.glob('*/*_module.py'):
        try:
            spec = importlib.util.spec_from_file_location(mod_file.stem, str(mod_file))
            if spec and spec.loader:
                m = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(m)
                if hasattr(m, 'Base'):
                    async with engine.begin() as conn:
                        await conn.run_sync(m.Base.metadata.create_all)
                    print(f'🗄️ جداول ماژول [{{mod_file.stem}}] در دیتابیس PostgreSQL ساخته شد.')
        except Exception as e:
            print(f'⚠️ خطا در {{mod_file.name}}: {{e}}')
    await engine.dispose()
    print('🏁 تمامی جداول در پایگاه داده با موفقیت مستقر شدند.')

asyncio.run(run_migration())
"""

res = subprocess.run(
    ["docker", "exec", "-i", "roxira_app_prod", "python3", "-c", migration_script],
    capture_output=True, text=True
)
print(res.stdout)
if res.stderr:
    print(res.stderr)
