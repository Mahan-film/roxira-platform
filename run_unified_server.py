import os, sys, logging, pathlib, importlib.util
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("RoxiraUnifiedServer")

app = FastAPI(
    title="Roxira OS Unified Enterprise Platform",
    version="2.5.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_class=HTMLResponse)
async def root_dashboard():
    return """
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>Roxira OS | Autonomous Enterprise Suite</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
            .container { max-width: 900px; width: 100%; }
            .header { text-align: center; margin-bottom: 40px; }
            .header h1 { font-size: 2.2rem; color: #38bdf8; margin-bottom: 8px; }
            .header p { color: #94a3b8; font-size: 1.1rem; }
            .status-badge { display: inline-block; background: #065f46; color: #34d399; padding: 6px 16px; border-radius: 9999px; font-weight: bold; margin-bottom: 20px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; transition: transform 0.2s; }
            .card:hover { transform: translateY(-4px); border-color: #38bdf8; }
            .card h3 { margin-top: 0; color: #f1f5f9; display: flex; align-items: center; gap: 8px; }
            .card p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; }
            .btn { display: inline-block; background: #0284c7; color: white; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: bold; margin-top: 15px; }
            .btn:hover { background: #0369a1; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="status-badge">● تمامی سرویس‌ها آنلاین و عملیاتی هستند</div>
                <h1>پلتفرم سازمانی روکسیرا (Roxira OS)</h1>
                <p>کارخانه نرم‌افزاری خودمختار و معماری یکپارچه ابری</p>
                <a href="/docs" class="btn">مشاهده مستندات تعاملی API (Swagger)</a>
            </div>
            <div class="grid">
                <div class="card">
                    <h3>💳 سیستم مالی و حسابداری دوبل</h3>
                    <p>مدیریت دفاتر کل و معین، اسناد حسابداری تراز و صورت‌حساب‌های استاندارد IFRS.</p>
                    <a href="/api/v1/apps/finance/accounts" class="btn" style="background:#334155">اندپوینت مالی</a>
                </div>
                <div class="card">
                    <h3>📦 مدیریت زنجیره تأمین و انبار (ERP)</h3>
                    <p>ردیابی موجودی کالاها، شماره‌گذاری لات و بارکدخوان ابری یکپارچه.</p>
                    <a href="/api/v1/apps/warehouse/items" class="btn" style="background:#334155">اندپوینت انبار</a>
                </div>
                <div class="card">
                    <h3>👥 مدیریت ارتباط با مشتری (AtomicCRM)</h3>
                    <p>مدیریت سرنخ‌های فروش، پایپ‌لاین مشتریان و اتوماسیون تعاملات.</p>
                    <a href="/api/v1/apps/crm/leads" class="btn" style="background:#334155">اندپوینت CRM</a>
                </div>
                <div class="card">
                    <h3>🕷️ هوش وب و استخراج داده (Scrapling)</h3>
                    <p>موتور کرولینگ ضد ردیابی Camoufox و مانیتورینگ آنلاین رقبا.</p>
                    <a href="/docs#/Stealth%20Web%20Intelligence" class="btn" style="background:#334155">مستندات ایجنت</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    """

@app.get("/health")
@app.get("/api/v1/health")
async def health():
    return {"status": "online", "platform": "Roxira OS Autonomous Factory"}

def mount_dynamic_modules():
    search_dirs = [
        pathlib.Path("/app/output_apps/generated_modules"),
        pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
    ]
    target = next((d for d in search_dirs if d.exists()), None)
    if not target:
        return

    for py_file in target.glob("*/*_module.py"):
        try:
            mod_name = py_file.stem
            spec = importlib.util.spec_from_file_location(mod_name, str(py_file))
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                if hasattr(mod, "router"):
                    app.include_router(mod.router)
                    logger.info(f"Loaded router: {mod_name}")
        except Exception as e:
            logger.error(f"Error loading {py_file.name}: {e}")

mount_dynamic_modules()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
