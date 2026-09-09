import os, sys, importlib, uvicorn, pathlib
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ============ Roxira OS Unified Server v3.6 ============
# مسیرهای پویا: هم روی هاست (/opt/roxira_platform) و هم داخل کانتینر (/app) صحیح کار می‌کند
BASE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "output_apps"))

app = FastAPI(title="Roxira OS & Smart Judge Production", version="3.6.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# ============ Static assets (/static/*) ============
STATIC_DIR = BASE_DIR / "output_apps" / "ecosystem_core" / "src" / "api" / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
else:
    print("[ROXIRA][WARN] static dir not found: %s" % STATIC_DIR, file=sys.stderr)

# ============ Headers: cache for static + referrer policy for Enamad ============
@app.middleware("http")
async def add_security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    # Enamad seals require a referrer that includes the origin;
    # 'strict-origin-when-cross-origin' still sends origin to https://trustseal.enamad.ir
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=86400"
    return response

# اتصال خودکار تمامی روترهای فعال پلتفرم (با لاگ کامل خطاها - بدون شکست بی‌صدا)
modules_dir = BASE_DIR / "output_apps" / "generated_modules"
SKIP_MODULES = {"enterprisedashboard_module"}  # روت‌های / و /dashboard توسط dispatcher اصلی سرو می‌شوند
loaded_routers = 0
failed_imports = []
if modules_dir.exists():
    for root, _, files in os.walk(modules_dir):
        for f in sorted(files):
            if not f.endswith(".py") or f.startswith("__"):
                continue
            stem = f[:-3]
            if stem in SKIP_MODULES:
                continue
            mod_path = os.path.join(root, f)
            rel = os.path.relpath(mod_path, BASE_DIR).replace(os.sep, ".")[:-3]
            try:
                m = importlib.import_module(rel)
                if hasattr(m, "router"):
                    app.include_router(m.router)
                    loaded_routers += 1
            except Exception as exc:
                failed_imports.append(rel)
                print("[ROXIRA][LOAD-FAIL] %s: %s" % (rel, exc), file=sys.stderr)
else:
    print("[ROXIRA][FATAL] modules dir not found: %s" % modules_dir, file=sys.stderr)

print("[ROXIRA] routers loaded: %d | failed: %s" % (loaded_routers, failed_imports), file=sys.stderr)

# ============ Landing pages loaded from static/ (single source of truth) ============
_FALLBACK_ROXIRA = """<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>رکسایرا</title><style>body{background:#020617;color:#f8fafc;font-family:sans-serif;text-align:center;padding:80px}</style></head><body><h1>رکسایرا — سامانه جامع ERP</h1><p>صفحه در حال بارگذاری از فایل استاتیک...</p></body></html>"""

_FALLBACK_GHAZI = """<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>قاضی هوشمند</title><style>body{background:#050505;color:#f8fafc;font-family:sans-serif;text-align:center;padding:80px}</style></head><body><h1>سامانه قاضی هوشمند</h1><p>صفحه در حال بارگذاری از فایل استاتیک...</p></body></html>"""


def _read_landing(filename: str, fallback: str) -> str:
    try:
        raw = (STATIC_DIR / filename).read_text(encoding="utf-8")
        return raw if raw.strip() else fallback
    except Exception as exc:
        print("[ROXIRA][PAGE-FALLBACK] %s: %s" % (filename, exc), file=sys.stderr)
        return fallback


ROXIRA_HTML = _read_landing("roxira_index.html", _FALLBACK_ROXIRA)
GHAZI_HTML = _read_landing("ghazi_landing.html", _FALLBACK_GHAZI)



@app.get("/health")
async def health():
    return {
        "status": "ONLINE",
        "service": "roxira-unified-server",
        "version": "3.6.0",
        "portals": ["ghazihoushmand.ir", "roxira.net", "roxira.ir"],
        "loaded_routers": loaded_routers,
        "failed_imports": failed_imports
    }

@app.get("/")
@app.get("/dashboard")
async def root_dispatcher(request: Request):
    host = (request.headers.get("host") or "").lower()
    if "ghazi" in host or "smartjudge" in host:
        return HTMLResponse(content=GHAZI_HTML, status_code=200)
    return HTMLResponse(content=ROXIRA_HTML, status_code=200)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
