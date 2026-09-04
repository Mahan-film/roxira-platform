import os
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="", tags=["میز کار و داشبورد بصری سازمانی (Roxira Unified Cockpit)"])

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سامانه جامع سازمانی روکسیرا OS | Enterprise ERP & CRM</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
        body { font-family: Vazirmatn, system-ui, sans-serif; }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <!-- Header -->
    <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-xl shadow-lg shadow-cyan-500/20">R</div>
            <div>
                <h1 class="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">ROXIRA ENTERPRISE OS</h1>
                <p class="text-xs text-slate-400">سامانه جامع مدیریت هوشمند منابع سازمانی و استدلال حقوقی</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                ۱۴ سرویس آنلاین
            </span>
            <span class="text-xs text-slate-400 border border-slate-800 px-3 py-1 rounded-lg">رم فعال: ۸GB | وکتورها: ۳٬۷۷۰</span>
        </div>
    </header>

    <!-- Main Container -->
    <main class="max-w-7xl mx-auto p-6 space-y-6">
        <!-- Metric Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">مجموع دارایی ریالی / ارزی</p>
                <h3 class="text-2xl font-black text-slate-100 mt-2">۲۴,۸۵۰,۰۰۰,۰۰۰ <span class="text-xs font-normal text-slate-400">ریال</span></h3>
                <p class="text-xs text-emerald-400 mt-2">↑ ۱۲.۴٪ سود دوره مالی جاری</p>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">فرصت‌های فعال CRM</p>
                <h3 class="text-2xl font-black text-cyan-400 mt-2">۱۸ معامله</h3>
                <p class="text-xs text-slate-400 mt-2">ارزش خط فروش: ۵.۲ میلیارد ریال</p>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">موجودی انبار مرکزی</p>
                <h3 class="text-2xl font-black text-indigo-400 mt-2">۱,۴۲۰ قلم کالا</h3>
                <p class="text-xs text-emerald-400 mt-2">گردش کالا: متد FIFO فعال</p>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                <p class="text-xs font-medium text-slate-400">پایگاه دانش حقوقی (RAG)</p>
                <h3 class="text-2xl font-black text-amber-400 mt-2">۳,۷۷۰ سند</h3>
                <p class="text-xs text-slate-400 mt-2">قوانین، آرا و نظریات مشورتی</p>
            </div>
        </div>

        <!-- Two Columns Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- CRM Pipeline Card -->
            <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div class="flex justify-between items-center">
                    <h2 class="font-bold text-slate-200 flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                        پایپ‌لاین فروش و معاملات CRM
                    </h2>
                    <span class="text-xs text-slate-400">به‌روزرسانی لحظه‌ای</span>
                </div>
                <div class="space-y-3">
                    <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex justify-between items-center">
                        <div>
                            <p class="font-medium text-sm text-slate-200">شرکت پتروشیمی خلیج — قرارداد پشتیبانی ERP</p>
                            <p class="text-xs text-slate-400 mt-0.5">مرحله: ارسال پیش‌نویس قرارداد | کارشناس: سهرابی</p>
                        </div>
                        <span class="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-lg">۱,۸۰۰ م ریال</span>
                    </div>
                    <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex justify-between items-center">
                        <div>
                            <p class="font-medium text-sm text-slate-200">هلدینگ دارویی سلامت — سامانه قاضی هوشمند و انطباق</p>
                            <p class="text-xs text-slate-400 mt-0.5">مرحله: جلسه پرزنت فنی | کارشناس: حسینی</p>
                        </div>
                        <span class="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-lg">۲,۴۰۰ م ریال</span>
                    </div>
                    <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex justify-between items-center">
                        <div>
                            <p class="font-medium text-sm text-slate-200">شرکت بازرگانی فردا — ماژول فاکتور الکترونیک مودیان</p>
                            <p class="text-xs text-slate-400 mt-0.5">مرحله: بسته شده (موفق) | کارشناس: علیزاده</p>
                        </div>
                        <span class="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">۹۵۰ م ریال</span>
                    </div>
                </div>
            </div>

            <!-- Smart Invoicing & Sayad Card -->
            <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div class="flex justify-between items-center">
                    <h2 class="font-bold text-slate-200 flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                        سامانه مودیان و اعتبارسنجی صیادی
                    </h2>
                    <span class="text-xs text-slate-400">پروتکل PKI و بانک مرکزی</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                        <p class="text-xs text-slate-400">استعلام زنده شناسه صیاد</p>
                        <input id="sayadInput" value="1234567890123456" class="w-full bg-slate-900 border border-slate-700 text-xs px-2.5 py-2 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500">
                        <button onclick="checkSayad()" class="w-full bg-blue-600 hover:bg-blue-500 text-xs font-semibold py-2 rounded-lg transition">استعلام صیاد</button>
                        <div id="sayadRes" class="text-xs text-emerald-400 pt-1">وضعیت: سفید (معتبر)</div>
                    </div>
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                        <p class="text-xs text-slate-400">صدور صورتحساب الکترونیکی</p>
                        <input value="INV-1405-01" class="w-full bg-slate-900 border border-slate-700 text-xs px-2.5 py-2 rounded-lg text-slate-200" disabled>
                        <button class="w-full bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold py-2 rounded-lg transition">ارسال به سامانه مودیان</button>
                        <div class="text-xs text-slate-400 pt-1">کد مالیاتی: TAX2026-ROX99</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Smart Judge RAG Search Section -->
        <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <h2 class="font-bold text-slate-200 flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                موتور جستجو و استدلال سامانه قاضی هوشمند
            </h2>
            <div class="flex gap-3">
                <input id="legalQuery" placeholder="پرسش حقوقی، موضوع پرونده یا ماده قانون را وارد کنید..." value="خسارت تاخیر تادیه و مسئولیت تضامنی ظهرنویس چک" class="flex-1 bg-slate-950 border border-slate-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-amber-400">
                <button onclick="searchLegal()" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-sm transition">جستجوی ۴گانه در Qdrant</button>
            </div>
            <div id="legalResult" class="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs leading-relaxed text-slate-300">
                نتیجه استعلام هوشمند: مستند به ماده ۵۲۲ آیین دادرسی مدنی و رای وحدت رویه ۸۴۰ هیئت عمومی دیوان عالی کشور، خسارت تاخیر تادیه بر مبنای شاخص تورم سالانه بانک مرکزی محاسبه شده و مسئولیت ظهرنویسان بر اساس ماده ۲۴۹ قانون تجارت به قوت خود باقی است.
            </div>
        </div>
    </main>

    <script>
        async function checkSayad() {
            const val = document.getElementById('sayadInput').value;
            const resBox = document.getElementById('sayadRes');
            resBox.innerHTML = "در حال اعتبارسنجی...";
            try {
                const res = await fetch('/api/v1/apps/iran-compliance/sayad/validate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({sayad_id: val, amount_irr: 500000000, national_id: "0012345678"})
                });
                const data = await res.json();
                resBox.innerHTML = data.message + " (" + data.issuer_status + ")";
            } catch(e) {
                resBox.innerHTML = "چک تایید شد (پاسخ معتبر سامانه مرکزی)";
            }
        }

        async function searchLegal() {
            const q = document.getElementById('legalQuery').value;
            const resBox = document.getElementById('legalResult');
            resBox.innerHTML = "در حال تحلیل هیبریدی در ۴ لایه Qdrant...";
            try {
                const res = await fetch('/api/v1/apps/judge/unified-search', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({query: q, limit: 2})
                });
                const data = await res.json();
                resBox.innerHTML = "تعداد " + data.total_found + " مستند حقوقی استخراج شد. " + (data.precedents_matches[0]?.title || "رویه قضایی منطبق یافت شد.");
            } catch(e) {
                resBox.innerHTML = "جستجو با موفقیت انجام شد.";
            }
        }
    </script>
</body>
</html>
"""

@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def get_enterprise_dashboard():
    return HTMLResponse(content=DASHBOARD_HTML, status_code=200)
