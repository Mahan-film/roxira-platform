import pathlib
import os

print("🔧 ۱. تنظیم مسیرهای پویا در roxira_factory_core.py...")

factory_path = pathlib.Path("/opt/roxira_platform/output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
factory_path.parent.mkdir(parents=True, exist_ok=True)

factory_code = '''import os
import httpx
import ast
import json
import logging
import pathlib
from typing import Dict, Any, List

logger = logging.getLogger("RoxiraFactoryCore")

# مسیر نسبی سازگار با داخل کانتینر (/app) و سرور میزبان
BASE_DIR = pathlib.Path(__file__).resolve().parents[4]
MODULES_OUTPUT_DIR = BASE_DIR / "output_apps" / "generated_modules"
MODULES_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

class RoxiraSoftwareFactory:
    """موتور پردازش، تحلیل سورس‌کد و بازتولید هوشمند سیستم‌های نرم‌افزاری"""

    @classmethod
    async def synthesize_and_save_module(cls, module_name: str, category: str, features: list[str], framework: str = "FastAPI") -> Dict[str, Any]:
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        
        target_dir = MODULES_OUTPUT_DIR / module_name.lower()
        target_dir.mkdir(parents=True, exist_ok=True)

        system_prompt = f"""شما معمار ارشد سیستم‌های نرم‌افزاری در کارخانه نرم‌افزار روکسیرا (Roxira OS) هستید.
وظیفه: طراحی کامل ماژول سازمانی {module_name} در دسته {category} با امکانات: {', '.join(features)}.
الزامات:
۱. استفاده از پایتون ۳.۱۲+، SQLAlchemy 2.0 Async و Pydantic v2.
۲. کدهای ماژولار و ساختاریافته شامل Models، Schemas و Service Router."""

        user_prompt = f"کدهای کامل ماژول {module_name} را پیاده‌سازی کن."

        models = [
            "google/gemini-3.7-flash",
            "deepseek/deepseek-v4-flash",
            "z-ai/glm-5.3-flash"
        ]

        if openrouter_key:
            for model in models:
                try:
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        resp = await client.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {openrouter_key}",
                                "HTTP-Referer": "https://roxira.net",
                                "X-Title": "Roxira Software Factory",
                                "Content-Type": "application/json"
                            },
                            json={
                                "model": model,
                                "messages": [
                                    {"role": "system", "content": system_prompt},
                                    {"role": "user", "content": user_prompt}
                                ],
                                "temperature": 0.1,
                                "max_tokens": 4096
                            }
                        )
                        if resp.status_code == 200:
                            content = resp.json()["choices"][0]["message"]["content"]
                            output_file = target_dir / f"{module_name.lower()}_bundle.py"
                            output_file.write_text(content, encoding="utf-8")
                            
                            return {
                                "status": "success",
                                "module": module_name,
                                "category": category,
                                "saved_file": str(output_file.name),
                                "relative_path": f"output_apps/generated_modules/{module_name.lower()}/{output_file.name}",
                                "model_used": model,
                                "message": f"ماژول {module_name} با موفقیت تولید و ذخیره شد."
                            }
                except Exception as ex:
                    logger.warning(f"Failed with {model}: {ex}")
                    continue

        return {"status": "error", "message": "خطا در ارتباط با مدل‌های هوش مصنوعی یا پایان زمان مجاز."}
'''
factory_path.write_text(factory_code, encoding="utf-8")
print("✅ ۱. فایل roxira_factory_core.py با مسیر پویا به‌روزرسانی شد.")

print("🔧 ۲. افزایش تایم‌اوت Nginx به ۳۰۰ ثانیه برای عملیات تولید کد...")
nginx_conf = pathlib.Path("/opt/roxira_platform/production_bundle/nginx/nginx.conf")
nginx_content = """events {
    worker_connections 1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;
    client_max_body_size 50M;

    # تنظیم تایم‌اوت‌های طولانی برای ایجنت‌های هوش مصنوعی
    proxy_connect_timeout 300s;
    proxy_send_timeout    300s;
    proxy_read_timeout    300s;
    send_timeout          300s;

    server {
        listen 80;
        server_name ghazihoushmand.ir www.ghazihoushmand.ir localhost;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            proxy_pass http://enterprise_app:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    server {
        listen 80;
        server_name roxira.net www.roxira.net roxira.ir www.roxira.ir;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            proxy_pass http://enterprise_app:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
"""
nginx_conf.write_text(nginx_content, encoding="utf-8")
print("✅ ۲. فایل nginx.conf با تایم‌اوت ۳۰۰ ثانیه‌ای به‌روزرسانی شد.")
