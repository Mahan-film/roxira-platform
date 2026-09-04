import os
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="", tags=["میز کار و پرتال‌های تفکیک‌شده روکسیرا و قاضی هوشمند"])

# -------------------------------------------------------------
# ۱. قالب اختصاصی سامانه قاضی هوشمند (ghazihoushmand.ir)
# -------------------------------------------------------------
GHAZI_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سامانه قاضی هوشمند و استدلال حقوقی | GhaziHoushmand</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style> body { font-family: Vazirmatn, system-ui, sans-serif; } </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <!-- Header -->
    <header class="border-b border-amber-900/40 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-600 flex items-center justify-center font-black text-xl text-slate-950 shadow-lg shadow-amber-500/20">⚖️</div>
            <div>
                <h1 class="text-lg font-bold bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">سامانه قاضی هوشمند (Smart Judge)</h1>
                <p class="text-xs text-slate-400">دستیار استدلال حقوقی، تحلیل دادنامه و جستجوی وحدت رویه</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button onclick="openAuthModal()" class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-lg shadow-amber-500/20">
                👤 ورود / ثبت‌نام وکلا و کارشناسان
            </button>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                ۳٬۷۷۰ سند فعال
            </span>
        </div>
    </header>

    <!-- Modal Auth -->
    <div id="authModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-amber-400 text-base">ورود امن به سامانه قاضی هوشمند</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            <p class="text-xs text-slate-400">ثبت هم‌زمان ایمیل و شماره همراه جهت دریافت پیامک تایید الزامی است.</p>
            
            <div id="authStep1" class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-300 mb-1">شماره همراه</label>
                    <input id="authPhone" type="tel" value="09129367796" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500">
                </div>
                <div>
                    <label class="block text-xs text-slate-300 mb-1">ایمیل رسمی</label>
                    <input id="authEmail" type="email" value="mahanpikasso@gmail.com" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500">
                </div>
                <button onclick="requestOTP('ghazi')" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">
                    ارسال کد تایید پیامکی (الگوی قاضی هوشمند)
                </button>
                <button onclick="loginGoogle()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition border border-slate-700 flex items-center justify-center gap-2">
                    <span>ورود با حساب گوگل</span>
                </button>
            </div>

            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-amber-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="123456" class="w-full bg-slate-950 border border-slate-700 text-sm px-3 py-2.5 rounded-xl text-center font-bold tracking-widest text-amber-400 focus:outline-none">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">تایید و ورود</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto p-6 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">آرای وحدت رویه دیوان عالی</p>
                <h3 class="text-2xl font-black text-amber-400 mt-2">۸۵۰ رای</h3>
                <p class="text-xs text-emerald-400 mt-1">به‌روزرسانی تا سال ۱۴۰۵</p>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">قوانین موضوعه کشور</p>
                <h3 class="text-2xl font-black text-slate-100 mt-2">۱,۳۰۵ ماده</h3>
                <p class="text-xs text-slate-400 mt-1">مدنی، کیفری، چک و دادگاه صلح</p>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">بخشنامه‌ها و نظریات مشورتی</p>
                <h3 class="text-2xl font-black text-amber-400 mt-2">۵۹۹ سند</h3>
                <p class="text-xs text-slate-400 mt-1">اداره کل حقوقی قوه قضاییه</p>
            </div>
        </div>

        <!-- Smart Legal Tools -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Delay Damages -->
            <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <h2 class="font-bold text-slate-200 flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    محاسبه‌گر خسارت تاخیر تادیه (ماده ۵۲۲ - شاخص بانک مرکزی)
                </h2>
                <div class="space-y-3">
                    <input id="calcAmount" type="number" value="1000000000" placeholder="مبلغ اصل خواسته (ریال)" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2 rounded-lg text-slate-100">
                    <div class="grid grid-cols-2 gap-2">
                        <input id="calcStart" type="number" value="1398" placeholder="سال سررسید" class="bg-slate-950 border border-slate-700 text-xs px-3 py-2 rounded-lg text-slate-100">
                        <input id="calcEnd" type="number" value="1404" placeholder="سال محاسبه" class="bg-slate-950 border border-slate-700 text-xs px-3 py-2 rounded-lg text-slate-100">
                    </div>
                    <button onclick="calcDamages()" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-lg text-xs transition">محاسبه آنلاین خسارت</button>
                    <div id="damagesRes" class="text-xs text-slate-300 pt-1"></div>
                </div>
            </div>

            <!-- Court Classifier -->
            <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <h2 class="font-bold text-slate-200 flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                    تشخیص صلاحیت مرجع قضایی (دادگاه صلح / عمومی حقوقی)
                </h2>
                <div class="space-y-3">
                    <select id="disputeType" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2 rounded-lg text-slate-100">
                        <option value="FINANCIAL">دعاوی مالی و مطالبه وجه</option>
                        <option value="COMMERCIAL">دعاوی تجاری و شرکت‌ها</option>
                        <option value="FAMILY">دعاوی خانوادگی و امور حسبی</option>
                    </select>
                    <input id="claimAmount" type="number" value="800000000" placeholder="مبلغ خواسته (ریال)" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2 rounded-lg text-slate-100">
                    <button onclick="classifyCourt()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-100 font-bold py-2 rounded-lg text-xs transition">استعلام مرجع صالح</button>
                    <div id="courtRes" class="text-xs text-slate-300 pt-1"></div>
                </div>
            </div>
        </div>

        <!-- Search Bar -->
        <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <h2 class="font-bold text-slate-200">موتور جستجوی هیبریدی در پایگاه قوانین و آرا</h2>
            <div class="flex gap-2">
                <input id="legalQuery" value="مسئولیت ضامن و ظهرنویس در چک صیادی و خسارت تاخیر" class="flex-1 bg-slate-950 border border-slate-700 px-3 py-2 text-xs rounded-xl focus:outline-none focus:border-amber-400">
                <button onclick="searchLegal()" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2 text-xs rounded-xl transition">جستجوی ۴گانه</button>
            </div>
            <div id="legalResult" class="text-xs text-slate-300 leading-relaxed p-4 bg-slate-950 rounded-xl border border-slate-800"></div>
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
            alertBox.innerHTML = "در حال ارسال پیامک با الگوی قاضی هوشمند...";
            
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
                } else {
                    alertBox.innerHTML = "خطا: " + (data.detail || "اطلاعات نامعتبر است.");
                }
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
            const data = await res.json();
            if(res.ok) {
                document.getElementById('authAlert').innerHTML = "✅ ورود موفق! خوش آمدید.";
                setTimeout(() => closeAuthModal(), 1200);
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
            document.getElementById('damagesRes').innerHTML = `ارزش روز خواسته: <b>${d.updated_value_to_date.toLocaleString()} ریال</b> | خسارت تاخیر: <b>${d.total_delay_damages.toLocaleString()} ریال</b>`;
        }

        async function classifyCourt() {
            const t = document.getElementById('disputeType').value;
            const a = document.getElementById('claimAmount').value;
            const res = await fetch('/api/v1/apps/judge/classify-court', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({dispute_type: t, claim_amount_irr: parseFloat(a)})
            });
            const d = await res.json();
            document.getElementById('courtRes').innerHTML = `مرجع صالح رسیدگی: <b class="text-emerald-400">${d.competent_authority}</b> (${d.jurisdiction_notes})`;
        }

        async function searchLegal() {
            const q = document.getElementById('legalQuery').value;
            const res = await fetch('/api/v1/apps/judge/unified-search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({query: q, limit: 2})
            });
            const d = await res.json();
            document.getElementById('legalResult').innerHTML = `تعداد ${d.total_found} مستند حقوقی استخراج شد.<br>نمونه رویه منطبق: <b>${d.precedents_matches[0]?.title || "یافت شد"}</b>`;
        }
    </script>
</body>
</html>
"""

# -------------------------------------------------------------
# ۲. قالب اختصاصی سامانه سازمانی روکسیرا (roxira.net / roxira.ir)
# -------------------------------------------------------------
ROXIRA_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>پلتفرم سازمانی روکسیرا | Roxira Enterprise OS</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style> body { font-family: Vazirmatn, system-ui, sans-serif; } </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <!-- Header -->
    <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-xl shadow-lg shadow-cyan-500/20">R</div>
            <div>
                <h1 class="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">ROXIRA ENTERPRISE OS</h1>
                <p class="text-xs text-slate-400">سامانه جامع ERP، مدیریت زنجیره تامین، CRM و مودیان مالیاتی</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button onclick="openAuthModal()" class="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition shadow-lg shadow-cyan-500/10">
                👤 ورود / ثبت‌نام سازمانی
            </button>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                ۱۷ ماژول فعال
            </span>
        </div>
    </header>

    <!-- Modal Auth -->
    <div id="authModal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-slate-100 text-base">ورود به پرتال سازمانی روکسیرا</h3>
                <button onclick="closeAuthModal()" class="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            <p class="text-xs text-slate-400">ثبت هم‌زمان ایمیل سازمانی و شماره همراه برای احراز هویت الزامی است.</p>
            
            <div id="authStep1" class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-300 mb-1">شماره تلفن همراه</label>
                    <input id="authPhone" type="tel" value="09129367796" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500">
                </div>
                <div>
                    <label class="block text-xs text-slate-300 mb-1">ایمیل سازمانی</label>
                    <input id="authEmail" type="email" value="mahanpikasso@gmail.com" class="w-full bg-slate-950 border border-slate-700 text-xs px-3 py-2.5 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500">
                </div>
                <button onclick="requestOTP('roxira')" class="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">
                    ارسال کد تایید پیامکی (الگوی روکسیرا)
                </button>
                <button onclick="loginGoogle()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition border border-slate-700 flex items-center justify-center gap-2">
                    <span>ورود با حساب گوگل</span>
                </button>
            </div>

            <div id="authStep2" class="space-y-3 hidden">
                <p class="text-xs text-cyan-400" id="otpSentMsg"></p>
                <input id="authOtpCode" type="text" placeholder="123456" class="w-full bg-slate-950 border border-slate-700 text-sm px-3 py-2.5 rounded-xl text-center font-bold tracking-widest text-cyan-400 focus:outline-none">
                <button onclick="verifyOTP()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition">تایید و ورود به داشبورد</button>
            </div>
            <div id="authAlert" class="text-xs pt-1 hidden"></div>
        </div>
    </div>

    <!-- Main Container -->
    <main class="max-w-7xl mx-auto p-6 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">تراز مالی دوبل (IFRS / GAAP)</p>
                <h3 class="text-2xl font-black text-slate-100 mt-2">۲۴,۸۵۰,۰۰۰,۰۰۰ <span class="text-xs font-normal text-slate-400">ریال</span></h3>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">فرصت‌های فعال CRM</p>
                <h3 class="text-2xl font-black text-cyan-400 mt-2">۱۸ معامله</h3>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">موجودی انبار (FIFO)</p>
                <h3 class="text-2xl font-black text-indigo-400 mt-2">۱,۴۲۰ قلم</h3>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">سامانه مودیان و صیاد</p>
                <h3 class="text-2xl font-black text-emerald-400 mt-2">متصل به PKI</h3>
            </div>
        </div>

        <!-- Document Parser Section -->
        <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <h2 class="font-bold text-slate-200">استخراج دسته‌ای اسناد و تبدیل به Markdown / JSON (تا ۱۰ فایل)</h2>
            <div class="border-2 border-dashed border-slate-700 rounded-2xl p-6 text-center bg-slate-950/40">
                <input type="file" id="docUpload" multiple class="hidden" onchange="uploadDocs(this.files)">
                <label for="docUpload" class="cursor-pointer block space-y-2">
                    <p class="text-sm font-medium text-slate-200">فایل‌های PDF، اسکن و فاکتورها را انتخاب کنید</p>
                    <p class="text-xs text-slate-400">پردازش ساختاری با موتور IBM Docling Core</p>
                </label>
            </div>
            <div id="docResult" class="hidden text-xs font-mono p-4 bg-slate-950 rounded-xl border border-slate-800 max-h-40 overflow-y-auto"></div>
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
            alertBox.innerHTML = "در حال ارسال پیامک با الگوی روکسیرا...";
            
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
                } else {
                    alertBox.innerHTML = "خطا: " + (data.detail || "اطلاعات نامعتبر است.");
                }
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
            const data = await res.json();
            if(res.ok) {
                document.getElementById('authAlert').innerHTML = "✅ ورود موفق! خوش آمدید.";
                setTimeout(() => closeAuthModal(), 1200);
            }
        }

        async function uploadDocs(files) {
            if(!files.length) return;
            const box = document.getElementById('docResult');
            box.classList.remove('hidden');
            box.innerHTML = "در حال پردازش و تبدیل اسناد...";
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
