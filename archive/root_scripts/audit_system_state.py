import os, sys, json, pathlib, subprocess, urllib.request

print("="*60)
print("🔍 شناسنامه جامع وضعیت زیرساخت پلتفرم سازمانی روکسیرا")
print("="*60)

# ۱. بررسی کانتینرهای فعال و منابع
print("\n[1] کانتینرهای فعال Docker:")
try:
    ps = subprocess.check_output("docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'", shell=True).decode()
    print(ps.strip())
except Exception as e:
    print(f"خطا در بررسی داکر: {e}")

# ۲. بررسی کالکشن‌های دیتابیس برداری Qdrant
print("\n[2] وضعیت کالکشن‌های دیتابیس برداری Qdrant:")
try:
    req = urllib.request.Request("http://127.0.0.1:6333/collections")
    with urllib.request.urlopen(req, timeout=3) as resp:
        data = json.loads(resp.read().decode())
        collections = [c["name"] for c in data.get("result", {}).get("collections", [])]
        print(f"کالکشن‌های فعال ({len(collections)}): {collections}")
except Exception as e:
    print(f"عدم دسترسی به Qdrant روی پورت ۶۳۳۳: {e}")

# ۳. بررسی جداول ساخته‌شده در PostgreSQL
print("\n[3] جداول مستقر در پایگاه‌داده PostgreSQL:")
try:
    tables = subprocess.check_output(
        "docker exec -i roxira_postgres_prod psql -U postgres -d roxira_os -t -c \"SELECT tablename FROM pg_tables WHERE schemaname='public';\" 2>/dev/null || docker exec -i roxira_db_prod psql -U roxira_user -d roxira_os -t -c \"SELECT tablename FROM pg_tables WHERE schemaname='public';\" 2>/dev/null",
        shell=True
    ).decode()
    t_list = [t.strip() for t in tables.splitlines() if t.strip()]
    print(f"تعداد جداول فعال ({len(t_list)}): {t_list}")
except Exception as e:
    print(f"خطا در خواندن جداول: {e}")

# ۴. بررسی ساختار ماژول‌ها و فایل‌های پایتون روی دیسک
print("\n[4] ماژول‌های مستقر در دایرکتوری Generated Modules:")
mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
if mod_dir.exists():
    for mod_path in sorted(mod_dir.glob("*/*_module.py")):
        print(f" • {mod_path.parent.name} -> {mod_path.name} ({mod_path.stat().st_size} bytes)")
else:
    print("پوشه ماژول‌ها یافت نشد.")

# ۵. بررسی پکیج‌های نسل جدید نصب‌شده در کانتینر اپلیکیشن
print("\n[5] کتابخانه‌های کلیدی نصب‌شده در کانتینر اصلی:")
try:
    pip_list = subprocess.check_output(
        "docker exec -i roxira_app_prod pip list --format=json",
        shell=True
    ).decode()
    packages = {p["name"].lower(): p["version"] for p in json.loads(pip_list)}
    check_keys = ["fastapi", "sqlalchemy", "asyncpg", "pydantic", "qdrant-client", "docling", "scrapling", "httpx", "litellm", "lightrag-hku", "networkx"]
    for k in check_keys:
        print(f" • {k}: {packages.get(k, '❌ نصب نیست')}")
except Exception as e:
    print(f"خطا در استخراج لیست پکیج‌ها: {e}")

# ۶. بررسی متغیرهای محیطی کلیدی
print("\n[6] وضعیت کلیدهای محیطی (API Keys):")
env_p = pathlib.Path("/opt/roxira_platform/.env")
if env_p.exists():
    lines = env_p.read_text().splitlines()
    for l in lines:
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.split("=", 1)
            k = k.strip()
            masked = v.strip()[:6] + "..." if len(v.strip()) > 6 else "SET"
            if any(term in k.upper() for term in ["KEY", "URL", "DB", "HOST"]):
                print(f" • {k}: {masked}")

print("\n" + "="*60)
