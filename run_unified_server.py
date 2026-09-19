
from output_apps.ecosystem_core.src.billing.router_payment import router as zibal_router
app.include_router(zibal_router)

from output_apps.ecosystem_core.src.billing.router_payment import router as zibal_root_payment
import os, sys, importlib, asyncio, uvicorn, pathlib
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
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

# ============ Dynamic rate limiter + token quota middleware ============
# Deducts an estimated token cost per request against the caller's TokenWallet and
# rejects with HTTP 402 (Payment Required) once the quota is exhausted; a per-tier
# token bucket answers HTTP 429 (Too Many Requests) in the meantime.
# The module is imported defensively so a missing driver can never take the unified
# server down: on any failure this middleware becomes a pass-through.
try:
    from output_apps.ecosystem_core.src.factory.user_auth_models import (
        AUTH_ENABLED as _AUTH_ENABLED,
        auth_quota_service as _quota_service,
        estimate_token_cost as _estimate_token_cost,
        tier_limits as _tier_limits,
    )
    _QUOTA_AVAILABLE = True
except Exception as _quota_import_exc:  # pragma: no cover - defensive
    print("[ROXIRA][QUOTA-WARN] middleware disabled: %s" % _quota_import_exc, file=sys.stderr)
    _QUOTA_AVAILABLE = False
    _AUTH_ENABLED = False
    _quota_service = None
    _estimate_token_cost = None
    _tier_limits = None

# Paths that are never rate limited or billed (assets, probes, docs).
_QUOTA_EXEMPT_PREFIXES = (
    "/static/", "/health", "/robots.txt", "/sitemap.xml", "/docs", "/openapi.json", "/redoc",
)
# Strong references to the fire-and-forget persistence tasks.
_QUOTA_PERSIST_TASKS = set()


def _decode_jwt_claims_unverified(token: str):
    """Best-effort claim extraction (tier hint only; never an authorisation check)."""
    try:
        import base64 as _b64, json as _json
        parts = str(token).split(".")
        if len(parts) != 3:
            return None
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = _json.loads(_b64.urlsafe_b64decode(padded))
        return claims if isinstance(claims, dict) else None
    except Exception:
        return None


def _quota_identity(request: Request):
    """Resolve (identity, tier_hint) from the bearer token, headers or client IP."""
    identity = None
    tier_hint = None
    authorization = request.headers.get("authorization") or ""
    if authorization.lower().startswith("bearer "):
        claims = _decode_jwt_claims_unverified(authorization.split(" ", 1)[1].strip())
        if claims:
            subject = claims.get("sub") or claims.get("phone") or claims.get("user_id")
            if subject:
                identity = str(subject)
            tier_hint = claims.get("subscription_tier") or claims.get("tier") or claims.get("plan")
    if identity is None:
        identity = request.headers.get("x-user-id") or request.headers.get("x-user-phone")
    if identity is None:
        client_host = request.client.host if request.client else "unknown"
        identity = "anon:%s" % (client_host or "unknown")
    return str(identity), tier_hint


def _quota_rejection(status_code: int, payload: dict, extra_headers: dict = None) -> JSONResponse:
    """Rejection response that still carries CORS headers (this layer is outermost)."""
    headers = {"Access-Control-Allow-Origin": "*", "Vary": "Origin"}
    if extra_headers:
        headers.update(extra_headers)
    return JSONResponse(status_code=status_code, content=payload, headers=headers)


@app.middleware("http")
async def rate_limit_and_token_quota(request: Request, call_next):
    if not (_QUOTA_AVAILABLE and _AUTH_ENABLED):
        return await call_next(request)

    path = request.url.path or "/"
    if path.startswith(_QUOTA_EXEMPT_PREFIXES):
        return await call_next(request)

    try:
        identity, tier_hint = _quota_identity(request)
        tier, remaining = await _quota_service.resolve(identity, tier_hint)

        # ---- dynamic rate limiting (per-tier token bucket) ----
        retry_after = _quota_service.check_rate(identity, tier)
        if retry_after is not None:
            _quota_service.stats["rate_limited"] += 1
            return _quota_rejection(
                429,
                {
                    "status": "error",
                    "code": "RATE_LIMITED",
                    "message": "تعداد درخواست‌های شما بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.",
                    "tier": tier,
                    "retry_after_seconds": retry_after,
                },
                {"Retry-After": str(max(1, int(retry_after) + 1))},
            )

        # ---- dynamic token cost estimate for this request ----
        try:
            content_length = int(request.headers.get("content-length") or 0)
        except Exception:
            content_length = 0
        cost = _estimate_token_cost(content_length, tier, path)

        # ---- quota gate: HTTP 402 once the wallet is exhausted ----
        if cost > 0 and remaining <= 0:
            _quota_service.stats["quota_rejected"] += 1
            return _quota_rejection(
                402,
                {
                    "status": "error",
                    "code": "TOKEN_QUOTA_EXHAUSTED",
                    "message": "اعتبار توکن شما به پایان رسیده است؛ برای ادامه کیف پول را شارژ کنید.",
                    "tier": tier,
                    "remaining_tokens": 0,
                    "estimated_cost": cost,
                    "top_up_url": "/pricing/plans",
                },
                {"X-Token-Quota-Remaining": "0"},
            )
    except Exception as exc:  # pragma: no cover - never break the request path
        print("[ROXIRA][QUOTA-WARN] bypassing request: %s" % exc, file=sys.stderr)
        return await call_next(request)

    response = await call_next(request)

    # ---- deduct the estimated cost and publish the remaining quota ----
    try:
        remaining_after = _quota_service.consume(identity, cost)
        _quota_service.stats["allowed"] += 1
        # Hedged Toman value of this request (0 when no FX source / free path).
        toman_cost = _quota_service.price_tokens(cost, tier)
        if toman_cost:
            _quota_service.stats["toman_charged"] += int(toman_cost)
        response.headers["X-Token-Cost"] = str(cost)
        response.headers["X-Token-Cost-Toman"] = str(toman_cost)
        response.headers["X-Token-Quota-Remaining"] = str(remaining_after)
        response.headers["X-RateLimit-Tier"] = tier
        response.headers["X-RateLimit-Limit"] = str(_tier_limits(tier)["rpm"])
        if cost > 0:
            task = asyncio.create_task(_quota_service.persist(identity, remaining_after))
            _QUOTA_PERSIST_TASKS.add(task)
            task.add_done_callback(_QUOTA_PERSIST_TASKS.discard)
    except Exception as exc:  # pragma: no cover - accounting must never fail a response
        print("[ROXIRA][QUOTA-WARN] accounting skipped: %s" % exc, file=sys.stderr)
    return response


# ---- wallet endpoints (/api/v1/auth/wallet) ------------------------------
# Mounted from the auth module so the quota cache and the wallet share one
# process-wide source of truth: a top-up is visible to the middleware instantly.
try:
    if _QUOTA_AVAILABLE:
        from output_apps.ecosystem_core.src.factory.user_auth_models import wallet_router as _wallet_router

        app.include_router(_wallet_router)
        print("[ROXIRA] wallet endpoints mounted: /api/v1/auth/wallet/{balance,top-up}", file=sys.stderr)
    else:
        print("[ROXIRA][WALLET-WARN] wallet endpoints disabled (auth module unavailable)", file=sys.stderr)
except Exception as _wallet_exc:  # pragma: no cover - additive feature
    print("[ROXIRA][WALLET-WARN] wallet mount failed: %s" % _wallet_exc, file=sys.stderr)


@app.get("/system/auth-quota")
async def auth_quota_snapshot(refresh: int = 0):
    """Operational snapshot of the rate limiter / token quota layer.

    ``?refresh=1`` forces a live Tether -> Toman refresh (network call, opt-in).
    """
    if not _QUOTA_AVAILABLE:
        return JSONResponse({"status": "disabled", "reason": "module unavailable"}, status_code=200)
    if refresh:
        _quota_service.refresh_fx_rate(force=True)
    return {"status": "ok", "enabled": bool(_AUTH_ENABLED), **_quota_service.snapshot()}


async def _init_auth_schema() -> None:
    """Create the account/subscription/wallet tables on startup (best effort)."""
    if not _QUOTA_AVAILABLE or os.getenv("ROXIRA_AUTH_INIT_DB", "1") == "0":
        return
    try:
        from output_apps.ecosystem_core.src.factory.user_auth_models import init_auth_db
        ready = await init_auth_db()
        print("[ROXIRA] auth schema ready: %s" % ready, file=sys.stderr)
    except Exception as exc:  # pragma: no cover - must never block startup
        print("[ROXIRA][AUTH-DB-WARN] %s" % exc, file=sys.stderr)


# Registered on the low-level startup list (no deprecated on_event decorator).
app.router.on_startup.append(_init_auth_schema)

# اتصال خودکار تمامی روترهای فعال پلتفرم (با لاگ کامل خطاها - بدون شکست بی‌صدا)
modules_dir = BASE_DIR / "output_apps" / "generated_modules"
SKIP_MODULES = {"enterprisedashboard_module"}  # روت‌های / و /dashboard توسط dispatcher اصلی سرو می‌شوند
loaded_routers = 0
failed_imports = []
loaded_rel_paths = set()


def _load_router_module(rel: str) -> bool:
    """Import `rel` and mount its `router`; True when a router was registered."""
    global loaded_routers
    try:
        m = importlib.import_module(rel)
    except Exception as exc:
        failed_imports.append(rel)
        print("[ROXIRA][LOAD-FAIL] %s: %s" % (rel, exc), file=sys.stderr)
        return False
    loaded_rel_paths.add(rel)
    if hasattr(m, "router"):
        app.include_router(m.router)
        loaded_routers += 1
        return True
    return False


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
            _load_router_module(rel)
else:
    print("[ROXIRA][FATAL] modules dir not found: %s" % modules_dir, file=sys.stderr)
# ============ Guaranteed routers (revenue / contract critical) ============
# These are also picked up by the walk above, but they are asserted explicitly so
# a change to the discovery logic or SKIP_MODULES can never silently drop them.
# `loaded_rel_paths` prevents a double include_router() (duplicate routes/docs).
GUARANTEED_ROUTERS = [
    "output_apps.generated_modules.enterprise.inquiry_module",  # POST /api/v1/enterprise/inquiry
]
for rel in GUARANTEED_ROUTERS:
    if rel in loaded_rel_paths:
        continue
    if not _load_router_module(rel):
        print("[ROXIRA][FATAL] guaranteed router missing: %s" % rel, file=sys.stderr)

print("[ROXIRA] routers loaded: %d | failed: %s" % (loaded_routers, failed_imports), file=sys.stderr)

# ============ MCP Tool Server (mounted under /mcp) ============
# Exposes the Software Foundry + legal vector retrieval to MCP clients:
#     GET  /mcp/sse        -> SSE transport (endpoint event + keepalive)
#     POST /mcp/messages   -> SSE session inbox (?session_id=...)
#     GET  /mcp/tools      -> tool catalogue (convenience, non-protocol)
#     POST /mcp            -> stateless JSON-RPC 2.0 (also via stdio entrypoint)
# Mounted by default; the router uses its own /mcp prefix so the generated_modules
# discovery and every existing route above keep their exact paths.  Any import or
# mount failure is isolated here so it can never take down the unified server.
# Set ROXIRA_MCP_MOUNT=0 to skip the mount entirely.
if os.getenv("ROXIRA_MCP_MOUNT", "1") != "0":
    try:
        from output_apps.ecosystem_core.src.factory.mcp_server import create_mcp_router
        app.include_router(create_mcp_router())
        print("[ROXIRA] MCP tool server mounted at /mcp (sse=/mcp/sse, messages=/mcp/messages, tools=/mcp/tools)", file=sys.stderr)
    except Exception as exc:
        print("[ROXIRA][MCP-FAIL] %s" % exc, file=sys.stderr)
else:
    print("[ROXIRA] MCP tool server disabled (ROXIRA_MCP_MOUNT=0)", file=sys.stderr)

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

# ============ Post-auth app shells (heavy interactive tools live here, behind login) ============
ROXIRA_APP_HTML = _read_landing("roxira_index.html", _FALLBACK_ROXIRA)
GHAZI_APP_HTML = _read_landing("ghazi_index.html", _FALLBACK_GHAZI)



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

@app.get("/app")
@app.get("/portal")
async def app_dispatcher(request: Request):
    """میز کار پس از ورود (ابزارهای سنگین: محاسبات، استعلام‌ها) — جدا از لندینگ عمومی."""
    host = (request.headers.get("host") or "").lower()
    if "ghazi" in host or "smartjudge" in host:
        return HTMLResponse(content=GHAZI_APP_HTML, status_code=200)
    return HTMLResponse(content=ROXIRA_APP_HTML, status_code=200)

# ============ SEO Indexing Infrastructure (robots.txt + sitemap.xml) ============
@app.get("/robots.txt")
async def robots_txt():
    content = "User-agent: *\nAllow: /\n\nSitemap: https://ghazihoushmand.ir/sitemap.xml\nSitemap: https://roxira.ir/sitemap.xml\n"
    return PlainTextResponse(content=content, media_type="text/plain")

@app.get("/sitemap.xml")
async def sitemap_xml():
    urls = [
        "https://ghazihoushmand.ir/",
        "https://ghazihoushmand.ir/app",
        "https://roxira.ir/",
        "https://roxira.ir/app",
    ]
    now = "2026-09-06"
    entries = "".join(
        f"<url><loc>{u}</loc><lastmod>{now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>"
        for u in urls
    )
    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return Response(content=xml, media_type="application/xml")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

app.include_router(zibal_root_payment)
