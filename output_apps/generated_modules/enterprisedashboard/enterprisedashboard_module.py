import os
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="", tags=["پرتال‌های تفکیک‌شده روکسیرا و قاضی هوشمند"])

GHAZI_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سامانه قاضی هوشمند | پلتفرم استدلال و تحلیل حقوقی</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
        body { font-family: Vazirmatn, system-ui, sans-serif; }
        .hero-bg {
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 27, 75, 0.95)), 
                        url('https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1920&q=80');
            background-size: cover;
            background-position: center;
        }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <header class="border-b border-amber-500/20 bg-slate-900/90 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-600 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/20">⚖️</div>
            <div>
                <h1 class="text-xl font-extrabold bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">سامانه قاضی هوشمند (Smart Judge)</h1>
                <p class="text-xs text-amber-200/70">پایگاه جامع آرای دیوان عالی و قوانین قوه قضاییه</p>
            </div>
        </div>
        <div>
            <button onclick="openAuthModal()" class="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-lg shadow-amber-500/30">
                🔑 ورود / ثبت‌نام وکلا و کارشناسان
            </button>
        </div>
    </header>

    <div id="authModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-amber-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-amber-400 text-lg">ورود امن به سامانه قاضی هوشمند</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-slate-200 text-xl">✕</button>
            </div>
            <div id="authStep1" class="space-y-3">
                <input id="authPhone" type="tel" value="09129367796" placeholder="شماره همراه" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100">
                <input id="authEmail" type="email" value="mahanpikasso@gmail.com" placeholder="ایمیل" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100">
                <button onclick="requestOTP('ghazi')" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">
                    ارسال کد تایید پیامکی (الگوی قاضی هوشمند)
                </button>
            </div>
            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-amber-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="123456" class="w-full bg-slate-950 border border-amber-500 text-lg px-3 py-2 rounded-xl text-center font-bold text-amber-400">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">تایید و ورود به میز کار</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <section class="hero-bg border-b border-amber-500/20 py-20 px-6 text-center space-y-6">
        <h1 class="text-3xl md:text-5xl font-black max-w-4xl mx-auto leading-tight">
            استدلال حقوقی هوشمند و تحلیل خودکار پرونده‌های قضایی
        </h1>
        <p class="text-slate-300 max-w-2xl mx-auto text-sm">
            مجهز به بیش از ۳٬۷۷۰ رکورد برداری آرای وحدت رویه، قوانین مدنی، چک و دادگاه صلح.
        </p>
        <div>
            <button onclick="openAuthModal()" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-8 py-3.5 rounded-2xl text-sm shadow-xl shadow-amber-500/30">
                ورود به سامانه استعلام و محاسبات
            </button>
        </div>
    </section>

    <script>
        function openAuthModal() { document.getElementById('authModal').classList.remove('hidden'); }
        function closeAuthModal() { document.getElementById('authModal').classList.add('hidden'); }
        async function requestOTP(target) {
            const phone = document.getElementById('authPhone').value;
            const email = document.getElementById('authEmail').value;
            const res = await fetch('/api/v1/auth/request-otp', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({phone_number: phone, email: email, target_service: target})
            });
            const data = await res.json();
            if(res.ok) {
                document.getElementById('authStep1').classList.add('hidden');
                document.getElementById('authStep2').classList.remove('hidden');
                document.getElementById('otpSentMsg').innerHTML = data.message;
            }
        }
        async function verifyOTP() {
            const phone = document.getElementById('authPhone').value;
            const code = document.getElementById('authOtpCode').value;
            const res = await fetch('/api/v1/auth/verify-otp', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({phone_number: phone, code: code})
            });
            if(res.ok) {
                document.getElementById('authAlert').classList.remove('hidden');
                document.getElementById('authAlert').innerHTML = "✅ ورود موفقیت‌آمیز بود.";
                setTimeout(() => closeAuthModal(), 1000);
            }
        }
    </script>
</body>
</html>
"""

ROXIRA_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>پلتفرم سازمانی روکسیرا | Roxira Enterprise OS</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
        body { font-family: Vazirmatn, system-ui, sans-serif; }
        .hero-roxira {
            background: linear-gradient(135deg, rgba(2, 6, 23, 0.94), rgba(15, 23, 42, 0.95)), 
                        url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1920&q=80');
            background-size: cover;
            background-position: center;
        }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-2xl shadow-lg shadow-cyan-500/20">R</div>
            <div>
                <h1 class="text-xl font-extrabold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">ROXIRA ENTERPRISE OS</h1>
                <p class="text-xs text-slate-400">سامانه ERP، مدیریت زنجیره تامین و استخراج اسناد تجاری</p>
            </div>
        </div>
        <div>
            <button onclick="openAuthModal()" class="px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-slate-950 transition shadow-lg shadow-cyan-500/30">
                👤 ورود / ثبت‌نام سازمانی
            </button>
        </div>
    </header>

    <div id="authModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-cyan-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-cyan-400 text-lg">ورود به پلتفرم سازمانی روکسیرا</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-slate-200 text-xl">✕</button>
            </div>
            <div id="authStep1" class="space-y-3">
                <input id="authPhone" type="tel" value="09129367796" placeholder="شماره تلفن همراه" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100">
                <input id="authEmail" type="email" value="mahanpikasso@gmail.com" placeholder="ایمیل سازمانی" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100">
                <button onclick="requestOTP('roxira')" class="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">
                    ارسال کد تایید پیامکی (الگوی روکسیرا)
                </button>
            </div>
            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-cyan-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="123456" class="w-full bg-slate-950 border border-cyan-500 text-lg px-3 py-2 rounded-xl text-center font-bold text-cyan-400">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">ورود به داشبورد</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <section class="hero-roxira border-b border-slate-800 py-20 px-6 text-center space-y-6">
        <h1 class="text-3xl md:text-5xl font-black max-w-4xl mx-auto leading-tight">
            کارخانه نرم‌افزاری و سامانه مدیریت منابع سازمانی
        </h1>
        <p class="text-slate-300 max-w-2xl mx-auto text-sm">
            حسابداری IFRS، مدیریت سرنخ‌های CRM، انبارداری و اتصال به سامانه مودیان.
        </p>
        <div>
            <button onclick="openAuthModal()" class="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-8 py-3.5 rounded-2xl text-sm shadow-xl shadow-cyan-500/30">
                ورود به پنل مدیریت منابع
            </button>
        </div>
    </section>

    <script>
        function openAuthModal() { document.getElementById('authModal').classList.remove('hidden'); }
        function closeAuthModal() { document.getElementById('authModal').classList.add('hidden'); }
        async function requestOTP(target) {
            const phone = document.getElementById('authPhone').value;
            const email = document.getElementById('authEmail').value;
            const res = await fetch('/api/v1/auth/request-otp', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({phone_number: phone, email: email, target_service: target})
            });
            const data = await res.json();
            if(res.ok) {
                document.getElementById('authStep1').classList.add('hidden');
                document.getElementById('authStep2').classList.remove('hidden');
                document.getElementById('otpSentMsg').innerHTML = data.message;
            }
        }
        async function verifyOTP() {
            const phone = document.getElementById('authPhone').value;
            const code = document.getElementById('authOtpCode').value;
            const res = await fetch('/api/v1/auth/verify-otp', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({phone_number: phone, code: code})
            });
            if(res.ok) {
                document.getElementById('authAlert').classList.remove('hidden');
                document.getElementById('authAlert').innerHTML = "✅ ورود موفقیت‌آمیز بود.";
                setTimeout(() => closeAuthModal(), 1000);
            }
        }
    </script>
</body>
</html>
"""

@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def serve_dynamic_portal(request: Request):
    host = request.headers.get("host", "").lower()
    if "ghazi" in host or "smartjudge" in host:
        return HTMLResponse(content=GHAZI_HTML, status_code=200)
    return HTMLResponse(content=ROXIRA_HTML, status_code=200)
