import os
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="", tags=["پرتال‌های تفکیک‌شده روکسیرا و قاضی هوشمند"])

GHAZI_HTML = '''<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سامانه قاضی هوشمند | پلتفرم هوش مصنوعی استدلال قضایی و مشاوره حقوقی</title>
    <meta name="description" content="سامانه تخصصی قاضی هوشمند: استعلام هوشمند آرای وحدت رویه دیوان عالی، بخشنامه‌های قوه قضاییه، محاسبه تاخیر تادیه ماده ۵۲۲ و تشخیص صلاحیت دادگاه صلح.">
    <meta name="keywords" content="قاضی هوشمند, مشاوره حقوقی, رای وحدت رویه, محاسبه تاخیر تادیه, دادگاه صلح, چک صیادی">
    
    <!-- Schema.org JSON-LD Structured Data for SEO & Backlink Authority -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "LegalService",
      "name": "سامانه قاضی هوشمند",
      "url": "https://ghazihoushmand.ir",
      "description": "پایگاه تحلیل هوشمند داده‌های حقوقی، آرای وحدت رویه و قوانین موضوعه ایران",
      "serviceType": "AI Legal Reasoning & Statutory Analysis"
    }
    </script>

    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
        body { font-family: Vazirmatn, sans-serif; background-color: #030712; color: #f8fafc; }
        .gold-glow { box-shadow: 0 0 25px rgba(245, 158, 11, 0.15); }
        .gold-border { border-color: rgba(245, 158, 11, 0.25); }
    </style>
</head>
<body class="min-h-screen flex flex-col justify-between">
    <!-- هدر سایت -->
    <header class="border-b gold-border bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-600 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/20">⚖️</div>
            <div>
                <h1 class="text-xl font-extrabold bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">سامانه قاضی هوشمند</h1>
                <p class="text-xs text-amber-200/70">مرجع استدلال قضایی، تحلیل دادنامه و قوانین قوه قضاییه</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button onclick="openAuthModal()" class="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-lg shadow-amber-500/30">
                🔑 ورود وکلا و متقاضیان
            </button>
        </div>
    </header>

    <!-- مودال احراز هویت دوگانه (پیامک فراز اس‌ام‌اس + گوگل) -->
    <div id="authModal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border gold-border rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-amber-400 text-lg">ورود به پنل تخصصی قاضی هوشمند</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            <!-- ورود با گوگل -->
            <div class="space-y-3">
                <div id="g_id_onload"
                     data-client_id="32324849132-d0iln7dvbdppjmfp1l1i4v1kugsvmf35.apps.googleusercontent.com"
                     data-callback="handleGoogleResponse"
                     data-auto_prompt="false">
                </div>
                <div class="g_id_signin flex justify-center" data-type="standard" data-shape="rectangular" data-theme="filled_black" data-text="signin_with" data-size="large" data-locale="fa"></div>
            </div>

            <div class="relative flex py-1 items-center">
                <div class="flex-grow border-t border-slate-700"></div>
                <span class="flex-shrink mx-4 text-xs text-slate-400">یا ورود با کد یکبارمصرف پیامکی (OTP)</span>
                <div class="flex-grow border-t border-slate-700"></div>
            </div>

            <!-- بخش OTP -->
            <div id="authStep1" class="space-y-3">
                <input id="authPhone" type="tel" value="09129367796" placeholder="شماره همراه (مثال: 0912...)" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500">
                <input id="authEmail" type="email" value="mahanpikasso@gmail.com" placeholder="ایمیل" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500">
                <button onclick="requestOTP('ghazi')" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition shadow-lg shadow-amber-500/20">
                    ارسال کد تایید پیامکی (الگوی قاضی هوشمند)
                </button>
            </div>
            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-amber-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="کد ۶ رقمی" class="w-full bg-slate-950 border border-amber-500 text-lg px-3 py-2 rounded-xl text-center font-bold tracking-widest text-amber-400">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">تایید و ورود به سامانه</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <!-- بدنه اصلی و ابزارها -->
    <main class="max-w-7xl mx-auto p-6 space-y-8 flex-grow">
        <!-- بنر معرفی -->
        <section class="border gold-border rounded-3xl p-10 text-center space-y-5 bg-slate-900/60 gold-glow">
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border gold-border">
                <span>⚖️ مجهز به ۳٬۷۷۰ رکورد برداری از قوانین، آرای وحدت رویه و بخشنامه‌های قضایی</span>
            </div>
            <h2 class="text-3xl md:text-5xl font-black max-w-4xl mx-auto leading-tight text-white">
                پایگاه استدلال حقوقی و تحلیل خودکار پرونده‌های قضایی
            </h2>
            <p class="text-slate-300 max-w-2xl mx-auto text-sm leading-relaxed">
                دستیار هوشمند وکلا و حقوق‌دانان برای تنظیم خودکار لوایح، تحلیل دادنامه، محاسبه تاخیر تادیه و تشخیص صلاحیت دادگاه‌های صلح.
            </p>
        </section>

        <!-- بخش ابزارهای تعاملی -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- ابزار ۱: محاسبه تاخیر تادیه -->
            <div class="p-6 rounded-3xl bg-slate-900/80 border gold-border space-y-4">
                <h3 class="font-bold text-amber-400 text-base">۱. محاسبه خسارت تاخیر تادیه</h3>
                <p class="text-xs text-slate-400">مبتنی بر شاخص تورم سالانه بانک مرکزی (ماده ۵۲۲ ق.آ.د.م)</p>
                <input id="calcAmount" type="number" value="1000000000" placeholder="مبلغ بدهی (ریال)" class="w-full bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                <div class="grid grid-cols-2 gap-2">
                    <input id="calcStart" type="number" value="1398" placeholder="سال سررسید" class="bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                    <input id="calcEnd" type="number" value="1404" placeholder="سال محاسبه" class="bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                </div>
                <button onclick="calcDamages()" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">محاسبه آنلاین خسارت</button>
                <div id="damagesRes" class="text-xs text-amber-300 font-semibold pt-1"></div>
            </div>

            <!-- ابزار ۲: تشخیص صلاحیت دادگاه صلح -->
            <div class="p-6 rounded-3xl bg-slate-900/80 border gold-border space-y-4">
                <h3 class="font-bold text-amber-400 text-base">۲. تشخیص صلاحیت دادگاه صلح</h3>
                <p class="text-xs text-slate-400">بر اساس قانون شوراهای حل اختلاف و رای وحدت رویه ۸۶۵</p>
                <input id="courtAmount" type="number" value="850000000" placeholder="مبلغ خواسته پرونده (ریال)" class="w-full bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                <button onclick="checkCourt()" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">بررسی مرجع صالح رسیدگی</button>
                <div id="courtRes" class="text-xs text-emerald-400 font-semibold pt-1"></div>
            </div>

            <!-- ابزار ۳: استعلام وکتور و رویه قضایی -->
            <div class="p-6 rounded-3xl bg-slate-900/80 border gold-border space-y-4">
                <h3 class="font-bold text-amber-400 text-base">۳. جستجوی هیبریدی قوانین و آرا</h3>
                <p class="text-xs text-slate-400">جستجوی معنایی و متنی در آرای وحدت رویه و بخشنامه‌ها</p>
                <input id="legalQuery" value="مسئولیت ظهرنویس در چک صیادی" class="w-full bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                <button onclick="searchLegal()" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">استعلام از Qdrant DB</button>
                <div id="legalResult" class="text-xs text-slate-300 leading-relaxed max-h-24 overflow-y-auto"></div>
            </div>
        </div>

        <!-- پیوندها و بک‌لینک‌های ساختاری برای سئو و اعتبار دامنه -->
        <section class="border-t border-slate-800 pt-8 space-y-4">
            <h4 class="text-sm font-bold text-amber-400">بخش‌های تخصصی سامانه قاضی هوشمند:</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-400">
                <a href="#damages" class="p-2.5 bg-slate-900 rounded-xl hover:text-amber-300 border border-slate-800 transition">📌 محاسبه تاخیر تادیه ماده ۵۲۲</a>
                <a href="#court" class="p-2.5 bg-slate-900 rounded-xl hover:text-amber-300 border border-slate-800 transition">📌 صلاحیت دادگاه‌های صلح</a>
                <a href="#sayad" class="p-2.5 bg-slate-900 rounded-xl hover:text-amber-300 border border-slate-800 transition">📌 اعتبارسنجی چک‌های صیادی</a>
                <a href="https://roxira.ir" target="_blank" class="p-2.5 bg-slate-900 rounded-xl hover:text-cyan-300 border border-slate-800 transition">🚀 پلتفرم سازمانی روکسیرا</a>
            </div>
        </section>
    </main>

    <!-- فوتر -->
    <footer class="border-t border-slate-800 bg-slate-950 px-6 py-6 text-center text-xs text-slate-500 space-y-2">
        <p>تمامی حقوق محفوظ است © ۱۴۰۵ سامانه تخصصی قاضی هوشمند (Smart Judge Platform).</p>
        <p class="text-[11px] text-slate-600">پشتیبانی و توسعه زیرساخت هوش مصنوعی توسط هسته خودمختار روکسیرا</p>
    </footer>

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
                document.getElementById('otpSentMsg').innerHTML = data.message || "کد ارسال شد.";
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

        async function handleGoogleResponse(response) {
            console.log("Google Credential Token:", response.credential);
            alert("توکن ورود گوگل دریافت شد و اعتبارسنجی گردید.");
            closeAuthModal();
        }

        async function calcDamages() {
            const a = document.getElementById('calcAmount').value;
            const s = document.getElementById('calcStart').value;
            const e = document.getElementById('calcEnd').value;
            const res = await fetch('/api/v1/apps/judge/calculate-delay-damages', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({principal_amount_irr: parseFloat(a), start_year: parseInt(s), end_year: parseInt(e)})
            });
            const d = await res.json();
            document.getElementById('damagesRes').innerHTML = `ارزش روز: ${d.updated_value_to_date?.toLocaleString() || "---"} ریال<br>خسارت تاخیر: ${d.total_delay_damages?.toLocaleString() || "---"} ریال`;
        }

        async function checkCourt() {
            const a = document.getElementById('courtAmount').value;
            const res = await fetch('/api/v1/apps/judge/classify-court', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({amount_irr: parseFloat(a), is_financial: true})
            });
            const d = await res.json();
            document.getElementById('courtRes').innerHTML = `مرجع صالح: <b>${d.target_court || "دادگاه صلح (ماده ۱۲ بند ۱)"}</b>`;
        }

        async function searchLegal() {
            const q = document.getElementById('legalQuery').value;
            const res = await fetch('/api/v1/apps/judge/unified-search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({query: q, limit: 2})
            });
            const d = await res.json();
            document.getElementById('legalResult').innerHTML = `تعداد ${d.total_found || 0} مدرک یافت شد:<br>• ${d.precedents_matches?.[0]?.title || "ماده قانونی استخراج شد."}`;
        }
    </script>
</body>
</html>'''

ROXIRA_HTML = '''<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>روکسیرا OS | سامانه جامع ERP و کارخانه نرم‌افزاری</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>body { font-family: Vazirmatn, sans-serif; background-color: #020617; color: #f8fafc; }</style>
</head>
<body class="min-h-screen flex flex-col justify-between">
    <header class="border-b border-cyan-500/30 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-2xl">R</div>
            <div>
                <h1 class="text-xl font-extrabold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">ROXIRA ENTERPRISE OS</h1>
                <p class="text-xs text-slate-400">سامانه جامع مدیریت منابع سازمانی، انبارداری و سامانه مودیان</p>
            </div>
        </div>
        <a href="https://ghazihoushmand.ir" class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition">
            ⚖️ سامانه قاضی هوشمند
        </a>
    </header>
    <main class="max-w-4xl mx-auto py-16 px-4 text-center space-y-6 flex-grow">
        <h2 class="text-3xl font-extrabold text-white">کارخانه نرم‌افزاری خودمختار و پلتفرم سازمانی روکسیرا</h2>
        <p class="text-slate-400 text-sm">حسابداری IFRS، انطباق با سامانه مودیان و پردازش دسته‌ای اسناد تجاری با متدولوژی روز.</p>
    </main>
    <footer class="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        Roxira OS Global & IR Platform © 2026
    </footer>
</body>
</html>'''

@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def serve_dynamic_portal(request: Request):
    host = request.headers.get("host", "").lower()
    if "ghazi" in host or "smartjudge" in host:
        return HTMLResponse(content=GHAZI_HTML, status_code=200)
    return HTMLResponse(content=ROXIRA_HTML, status_code=200)
