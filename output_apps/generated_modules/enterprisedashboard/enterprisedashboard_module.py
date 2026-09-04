import os
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="", tags=["پرتال‌های تفکیک‌شده روکسیرا و قاضی هوشمند"])

# ----------------------------------------------------------------------
# پرتال اختصاصی قاضی هوشمند (صرفاً سامانه هوشمند مشاوره حقوقی و وکالت)
# ----------------------------------------------------------------------
GHAZI_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سامانه قاضی هوشمند | مشاوره حقوقی و دستیار تحلیل دادنامه با هوش مصنوعی</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
        body { font-family: Vazirmatn, system-ui, sans-serif; }
        .legal-bg {
            background: linear-gradient(135deg, rgba(10, 15, 30, 0.95), rgba(20, 25, 45, 0.95)), 
                        url('https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1920&q=80');
            background-size: cover;
            background-position: center;
        }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <!-- Header -->
    <header class="border-b border-amber-500/30 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-600 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/20">⚖️</div>
            <div>
                <h1 class="text-xl font-extrabold bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">سامانه قاضی هوشمند</h1>
                <p class="text-xs text-amber-200/70">دستیار هوشمند مشاوره حقوقی، استدلال قضایی و تحلیل لوایح</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button onclick="openAuthModal()" class="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-lg shadow-amber-500/30 ring-2 ring-amber-400/40">
                👤 ورود / ثبت‌نام مشاوره حقوقی
            </button>
        </div>
    </header>

    <!-- Modal Login -->
    <div id="authModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-amber-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-amber-400 text-lg">ورود به سامانه قاضی هوشمند</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-slate-200 text-xl font-bold">✕</button>
            </div>
            <p class="text-xs text-slate-300">برای دریافت مشاوره حقوقی، ثبت شماره همراه و ایمیل الزامی است:</p>
            
            <div id="authStep1" class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-300 mb-1">شماره تلفن همراه (جهت دریافت کد پیامکی)</label>
                    <input id="authPhone" type="tel" value="09129367796" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500">
                </div>
                <div>
                    <label class="block text-xs text-slate-300 mb-1">پست الکترونیکی (ایمیل)</label>
                    <input id="authEmail" type="email" value="mahanpikasso@gmail.com" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500">
                </div>
                <button onclick="requestOTP('ghazi')" class="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 text-slate-950 font-black py-3 rounded-xl text-sm transition shadow-lg shadow-amber-500/20">
                    ارسال کد تایید پیامکی (الگوی قاضی هوشمند)
                </button>
                <button onclick="loginGoogle()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition border border-slate-700 flex items-center justify-center gap-2">
                    ورود سریع با اکانت Google
                </button>
            </div>

            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-amber-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="123456" class="w-full bg-slate-950 border border-amber-500 text-lg px-3 py-2 rounded-xl text-center font-bold tracking-widest text-amber-400 focus:outline-none">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">تایید و ورود به پنل مشاوره</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <!-- Hero Section -->
    <section class="legal-bg border-b border-amber-500/20 py-16 px-6 text-center space-y-6">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span>⚖️ متصل به پایگاه داده ۳٬۷۷۰ ماده قانونی و رای وحدت رویه دیوان عالی کشور</span>
        </div>
        <h1 class="text-3xl md:text-5xl font-black max-w-4xl mx-auto leading-tight">
            سامانه مشاوره حقوقی هوشمند و تحلیل پرونده‌های قضایی
        </h1>
        <p class="text-slate-300 max-w-2xl mx-auto text-sm leading-relaxed">
            تنظیم هوشمند لوایح دفاعیه، جستجوی رویه قضایی، بررسی انطباق چک صیادی و محاسبه دقیق تاخیر تادیه با نرخ تورم بانک مرکزی.
        </p>
        <div class="flex justify-center gap-4 pt-2">
            <button onclick="openAuthModal()" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-8 py-3.5 rounded-2xl text-sm shadow-xl shadow-amber-500/30 transition">
                شروع مشاوره و تحلیل پرونده
            </button>
        </div>
    </section>

    <!-- Main Legal Advisory Tools -->
    <main class="max-w-7xl mx-auto p-6 space-y-6">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- محاسبه‌گر تاخیر تادیه -->
            <div class="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
                <h2 class="font-bold text-slate-200 text-base flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    محاسبه‌گر خسارت تاخیر تادیه (ماده ۵۲۲ - شاخص تورم بانک مرکزی)
                </h2>
                <input id="calcAmount" type="number" value="1000000000" placeholder="مبلغ اصل خواسته (ریال)" class="w-full bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                <div class="grid grid-cols-2 gap-2">
                    <input id="calcStart" type="number" value="1398" placeholder="سال سررسید" class="bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                    <input id="calcEnd" type="number" value="1404" placeholder="سال محاسبه" class="bg-slate-950 border border-slate-700 text-xs p-3 rounded-xl text-slate-100">
                </div>
                <button onclick="calcDamages()" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">محاسبه آنلاین شاخص روز</button>
                <div id="damagesRes" class="text-xs text-amber-300 font-semibold pt-1"></div>
            </div>

            <!-- موتور جستجوی آرا و قوانین -->
            <div class="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
                <h2 class="font-bold text-slate-200 text-base flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                    مشاوره هوشمند بر مبنای آرای دیوان عالی کشور
                </h2>
                <div class="flex gap-2">
                    <input id="legalQuery" value="مسئولیت ظهرنویس چک صیادی و خسارت تاخیر" class="flex-1 bg-slate-950 border border-slate-700 px-3 py-2.5 text-xs rounded-xl focus:outline-none focus:border-amber-400">
                    <button onclick="searchLegal()" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2 text-xs rounded-xl transition">استعلام حقوقی</button>
                </div>
                <div id="legalResult" class="text-xs text-slate-300 leading-relaxed p-4 bg-slate-950 rounded-xl border border-slate-800/80 min-h-[90px]">
                    نتیجه استعلام قوانین و آرا پس از جستجو در اینجا نمایش می‌یابد...
                </div>
            </div>
        </div>
    </main>

    <script>
        function openAuthModal() { document.getElementById('authModal').classList.remove('hidden'); }
        function closeAuthModal() { document.getElementById('authModal').classList.add('hidden'); }

        async function requestOTP(target) {
            const phone = document.getElementById('authPhone').value;
            const email = document.getElementById('authEmail').value;
            const alertBox = document.getElementById('authAlert');
            alertBox.classList.remove('hidden');
            alertBox.innerHTML = "⏳ در حال ارسال پیامک با الگوی قاضی هوشمند...";
            try {
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
                    alertBox.classList.add('hidden');
                } else { alertBox.innerHTML = "خطا: " + (data.detail || "اطلاعات نامعتبر است."); }
            } catch(e) { alertBox.innerHTML = "خطا در اتصال به سرور."; }
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
                document.getElementById('authAlert').innerHTML = "✅ ورود موفق! در حال انتقال به پنل مشاوره...";
                setTimeout(() => closeAuthModal(), 1000);
            }
        }

        async function calcDamages() {
            const amt = document.getElementById('calcAmount').value;
            const s = document.getElementById('calcStart').value;
            const e = document.getElementById('calcEnd').value;
            const res = await fetch('/api/v1/apps/judge/calculate-delay-damages', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({principal_amount_irr: parseFloat(amt), start_year: parseInt(s), end_year: parseInt(e)})
            });
            const d = await res.json();
            document.getElementById('damagesRes').innerHTML = `ارزش روز: ${d.updated_value_to_date.toLocaleString()} ریال | خسارت تاخیر: ${d.total_delay_damages.toLocaleString()} ریال`;
        }

        async function searchLegal() {
            const q = document.getElementById('legalQuery').value;
            const res = await fetch('/api/v1/apps/judge/unified-search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({query: q, limit: 2})
            });
            const d = await res.json();
            document.getElementById('legalResult').innerHTML = `تعداد ${d.total_found} مستند استخراج شد.<br><b>${d.precedents_matches[0]?.title || "رویه قضایی منطبق استخراج گردید."}</b>`;
        }
    </script>
</body>
</html>
"""

# ----------------------------------------------------------------------
# پرتال سازمانی روکسیرا (ERP, CRM, انبارداری و استخراج اسناد)
# ----------------------------------------------------------------------
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
    <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-2xl shadow-lg shadow-cyan-500/20">R</div>
            <div>
                <h1 class="text-xl font-extrabold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">ROXIRA ENTERPRISE OS</h1>
                <p class="text-xs text-slate-400">سامانه جامع ERP، مدیریت منابع سازمانی و استخراج اسناد تجاری</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button onclick="openAuthModal()" class="px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-slate-950 transition shadow-lg shadow-cyan-500/30 ring-2 ring-cyan-400/40">
                👤 ورود / ثبت‌نام سازمانی
            </button>
        </div>
    </header>

    <!-- Modal Login -->
    <div id="authModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-cyan-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-cyan-400 text-lg">ورود به پلتفرم سازمانی روکسیرا</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-slate-200 text-xl font-bold">✕</button>
            </div>
            <p class="text-xs text-slate-300">برای دسترسی به میز کار سازمانی، شماره همراه و ایمیل را وارد کنید:</p>
            
            <div id="authStep1" class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-300 mb-1">شماره تلفن همراه</label>
                    <input id="authPhone" type="tel" value="09129367796" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500">
                </div>
                <div>
                    <label class="block text-xs text-slate-300 mb-1">ایمیل سازمانی</label>
                    <input id="authEmail" type="email" value="mahanpikasso@gmail.com" class="w-full bg-slate-950 border border-slate-700 text-sm px-3.5 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500">
                </div>
                <button onclick="requestOTP('roxira')" class="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-slate-950 font-black py-3 rounded-xl text-sm transition shadow-lg shadow-cyan-500/20">
                    ارسال کد تایید پیامکی (الگوی روکسیرا)
                </button>
                <button onclick="loginGoogle()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition border border-slate-700">
                    ورود با حساب کاربری Google
                </button>
            </div>

            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-cyan-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="123456" class="w-full bg-slate-950 border border-cyan-500 text-lg px-3 py-2 rounded-xl text-center font-bold tracking-widest text-cyan-400 focus:outline-none">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-sm transition">تایید و ورود به داشبورد</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <!-- Hero Section -->
    <section class="hero-roxira border-b border-slate-800 py-16 px-6 text-center space-y-6">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            <span>🚀 مجهز به استانداردهای بین‌المللی IFRS، US GAAP و سامانه مودیان</span>
        </div>
        <h1 class="text-3xl md:text-5xl font-black max-w-4xl mx-auto leading-tight">
            سامانه یکپارچه مدیریت منابع سازمانی (ERP) و ارتباط با مشتری (CRM)
        </h1>
        <p class="text-slate-300 max-w-2xl mx-auto text-sm leading-relaxed">
            مدیریت دفتر کل دوطرفه، پایپ‌لاین فروش، انبارداری با متد FIFO و استخراج دسته‌ای اسناد مالی با IBM Docling.
        </p>
        <div class="flex justify-center gap-4 pt-2">
            <button onclick="openAuthModal()" class="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-8 py-3.5 rounded-2xl text-sm shadow-xl shadow-cyan-500/30 transition">
                ورود به پنل مدیریت منابع
            </button>
        </div>
    </section>

    <!-- Main ERP / DocParser Container -->
    <main class="max-w-7xl mx-auto p-6 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">تراز مالی دوبل</p>
                <h3 class="text-2xl font-black text-slate-100 mt-2">۲۴,۸۵۰,۰۰۰,۰۰۰ <span class="text-xs font-normal text-slate-400">ریال</span></h3>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">فرصت‌های فعال CRM</p>
                <h3 class="text-2xl font-black text-cyan-400 mt-2">۱۸ معامله</h3>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">موجودی انبار (FIFO)</p>
                <h3 class="text-2xl font-black text-indigo-400 mt-2">۱,۴۲۰ قلم کالا</h3>
            </div>
        </div>

        <div class="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
            <h2 class="font-bold text-slate-200 text-base">موتور پردازش دسته‌ای اسناد (۵ تا ۱۰ فایل هم‌زمان)</h2>
            <div class="border-2 border-dashed border-slate-700 rounded-2xl p-8 text-center bg-slate-950/50 hover:border-cyan-500 transition cursor-pointer">
                <input type="file" id="batchDocInput" multiple class="hidden" onchange="uploadDocs(this.files)">
                <label for="batchDocInput" class="cursor-pointer block space-y-2">
                    <p class="text-sm font-semibold text-slate-200">فایل‌های PDF، اسکن و فاکتورها را اینجا رها کنید</p>
                    <p class="text-xs text-slate-400">تبدیل آنی به فرمت ساختاریافته Markdown و JSON</p>
                </label>
            </div>
            <div id="parseResult" class="hidden text-xs font-mono p-4 bg-slate-950 rounded-xl border border-slate-800 max-h-48 overflow-y-auto"></div>
        </div>
    </main>

    <script>
        function openAuthModal() { document.getElementById('authModal').classList.remove('hidden'); }
        function closeAuthModal() { document.getElementById('authModal').classList.add('hidden'); }

        async function requestOTP(target) {
            const phone = document.getElementById('authPhone').value;
            const email = document.getElementById('authEmail').value;
            const alertBox = document.getElementById('authAlert');
            alertBox.classList.remove('hidden');
            alertBox.innerHTML = "⏳ در حال ارسال پیامک با الگوی روکسیرا (FarazSMS)...";
            try {
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
                    alertBox.classList.add('hidden');
                } else { alertBox.innerHTML = "خطا: " + (data.detail || "اطلاعات نامعتبر است."); }
            } catch(e) { alertBox.innerHTML = "خطا در اتصال به سرور."; }
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
                document.getElementById('authAlert').innerHTML = "✅ ورود موفق به پرتال سازمانی روکسیرا.";
                setTimeout(() => closeAuthModal(), 1000);
            }
        }

        async function uploadDocs(files) {
            if(!files.length) return;
            const box = document.getElementById('parseResult');
            box.classList.remove('hidden');
            box.innerHTML = "در حال تبدیل اسناد...";
            const formData = new FormData();
            for(let i=0; i<Math.min(files.length, 10); i++) formData.append('files', files[i]);
            const res = await fetch('/api/v1/apps/document-parser/batch-extract', { method: 'POST', body: formData });
            const data = await res.json();
            box.innerHTML = JSON.stringify(data, null, 2);
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
