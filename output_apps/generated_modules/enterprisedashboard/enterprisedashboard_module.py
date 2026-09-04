import os
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="", tags=["پرتال‌های تفکیک‌شده"])

GHAZI_HTML = """<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>سامانه قاضی هوشمند | پلتفرم استدلال و تحلیل حقوقی</title><script src="https://cdn.tailwindcss.com"></script><link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet"><style>body{font-family:Vazirmatn,sans-serif;background-color:#030712;color:#f8fafc;}</style></head><body class="min-h-screen"><header class="border-b border-amber-500/30 bg-slate-900/90 px-6 py-4 flex justify-between items-center"><h1 class="text-xl font-bold text-amber-400">⚖️ سامانه تخصصی قاضی هوشمند</h1><span class="text-xs bg-amber-500/20 text-amber-300 px-3 py-1 rounded-lg border border-amber-500/40">نسخه وکلا و کارشناسان</span></header><main class="max-w-4xl mx-auto py-16 px-4 text-center space-y-6"><h2 class="text-3xl font-extrabold text-white">پایگاه استدلال حقوقی و تحلیل آرای دیوان عالی</h2><p class="text-slate-400 text-sm">مجهز به موتور بازیابی وکتور قوانین مدنی، چک و دادگاه صلح.</p></main></body></html>"""

ROXIRA_HTML = """<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>پلتفرم سازمانی روکسیرا | Roxira Enterprise OS</title><script src="https://cdn.tailwindcss.com"></script><link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet"><style>body{font-family:Vazirmatn,sans-serif;background-color:#020617;color:#f8fafc;}</style></head><body class="min-h-screen"><header class="border-b border-cyan-500/30 bg-slate-900/90 px-6 py-4 flex justify-between items-center"><h1 class="text-xl font-bold text-cyan-400">🚀 ROXIRA ENTERPRISE OS</h1><span class="text-xs bg-cyan-500/20 text-cyan-300 px-3 py-1 rounded-lg border border-cyan-500/40">ERP & Software Factory</span></header><main class="max-w-4xl mx-auto py-16 px-4 text-center space-y-6"><h2 class="text-3xl font-extrabold text-white">کارخانه نرم‌افزاری خودمختار و مدیریت منابع سازمانی</h2><p class="text-slate-400 text-sm">حسابداری IFRS، انطباق با سامانه مودیان و پردازش دسته‌ای اسناد تجاری.</p></main></body></html>"""

@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def serve_dynamic_portal(request: Request):
    host = request.headers.get("host", "").lower()
    if "ghazi" in host or "smartjudge" in host:
        return HTMLResponse(content=GHAZI_HTML, status_code=200)
    return HTMLResponse(content=ROXIRA_HTML, status_code=200)
