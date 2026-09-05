import os, sys, importlib, uvicorn, pathlib
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

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

GHAZI_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>قاضی هوشمند | سامانه لوکس استدلال قضایی — ghazihoushmand.ir</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
        body{font-family:Vazirmatn,sans-serif;background:radial-gradient(1200px 600px at 50% -10%, #1a1508 0%, #050505 60%);color:#f8fafc;}
        .gold-text{background:linear-gradient(135deg,#f7e08a 0%,#d4af37 45%,#a97c1f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;}
        .gold-box{background:linear-gradient(160deg,rgba(30,25,12,.92),rgba(10,10,10,.95));border:1px solid rgba(212,175,55,.35);box-shadow:0 0 30px rgba(212,175,55,.08), inset 0 1px 0 rgba(247,224,138,.15);}
        .gold-btn{background:linear-gradient(135deg,#f7e08a,#d4af37);color:#1a1508;box-shadow:0 4px 18px rgba(212,175,55,.35);}
        .gold-btn:hover{filter:brightness(1.08);}
        .gold-btn:disabled{opacity:.55;cursor:not-allowed;filter:none;}
        .gold-input{background:#0a0a0a;border:1px solid rgba(212,175,55,.3);}
        .gold-input:focus{outline:none;border-color:#d4af37;box-shadow:0 0 12px rgba(212,175,55,.25);}
        .gold-border-b{border-bottom:1px solid rgba(212,175,55,.35);}
        .gold-border-t{border-top:1px solid rgba(212,175,55,.35);}
        .gold-line{height:1px;background:linear-gradient(90deg,transparent,#d4af37,transparent);}
    </style>
</head>
<body class="min-h-screen flex flex-col justify-between">
    <header class="gold-border-b bg-black/70 backdrop-blur px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div class="flex items-center gap-3">
            <span class="text-3xl">⚖️</span>
            <div>
                <h1 class="text-lg font-black gold-text">سامانه تخصصی قاضی هوشمند</h1>
                <p class="text-[11px] text-amber-200/60">ghazihoushmand.ir — مرجع استدلال قضایی، آرای وحدت رویه دیوان عالی و دادگاه‌های صلح</p>
            </div>
        </div>
        <button onclick="openModal()" class="gold-btn px-5 py-2.5 rounded-xl text-xs font-bold transition">🔑 ورود / ثبت‌نام وکلا</button>
    </header>

    <div id="authModal" class="fixed inset-0 bg-black/85 backdrop-blur-md z-50 hidden flex items-center justify-center p-4">
        <div class="gold-box rounded-3xl max-w-md w-full p-6 space-y-4">
            <div class="flex justify-between items-center">
                <h3 class="font-bold gold-text text-base">ورود پیامکی (OTP)</h3>
                <button onclick="closeModal()" class="text-amber-200/60 hover:text-white text-xl font-bold">✕</button>
            </div>
            <div class="gold-line"></div>
            <div id="step1" class="space-y-3">
                <div>
                    <label class="block text-xs text-amber-200/60 mb-1">شماره تلفن همراه:</label>
                    <input id="pNum" type="tel" inputmode="numeric" maxlength="11" placeholder="شماره موبایل" class="gold-input w-full text-sm p-3 rounded-xl text-white text-center font-mono">
                </div>
                <div>
                    <label class="block text-xs text-amber-200/60 mb-1">ایمیل (اختیاری):</label>
                    <input id="pEmail" type="email" placeholder="you@example.com" class="gold-input w-full text-xs p-2.5 rounded-xl text-white text-left font-mono">
                </div>
                <button id="btnSendOtp" onclick="sendOtp()" class="gold-btn w-full font-bold py-3 rounded-xl text-sm transition">ارسال کد تایید پیامکی</button>
            </div>
            <div id="step2" class="space-y-3 hidden">
                <p id="otpMsg" class="text-xs text-amber-300 text-center"></p>
                <div>
                    <label class="block text-xs text-amber-200/60 mb-1">کد ۶ رقمی تایید:</label>
                    <input id="oCode" type="text" inputmode="numeric" maxlength="6" placeholder="------" class="gold-input w-full text-xl p-2.5 rounded-xl text-center text-amber-300 font-bold tracking-widest font-mono">
                </div>
                <button id="btnVerify" onclick="verifyOtp()" class="gold-btn w-full font-bold py-3 rounded-xl text-sm transition">تایید و ورود به میز کار</button>
                <div class="flex justify-between items-center text-xs pt-1">
                    <button onclick="backToStep1()" class="text-amber-200/60 hover:text-amber-300">← ویرایش شماره همراه</button>
                    <button id="btnResend" onclick="sendOtp()" disabled class="text-amber-200/40"></button>
                </div>
            </div>
            <div id="alertBox" class="text-xs p-2.5 rounded-xl hidden text-center font-medium"></div>
        </div>
    </div>

    <main class="max-w-6xl mx-auto p-6 space-y-8 flex-grow">
        <section class="gold-box p-8 rounded-3xl text-center space-y-4">
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">⚖️ متصل به ۳٬۷۷۰ رکورد برداری قوانین، آرای وحدت رویه و بخشنامه‌ها</div>
            <h2 class="text-2xl md:text-4xl font-black gold-text">سامانه هوشمند استدلال قضایی و تحلیل پرونده‌ها</h2>
            <div class="gold-line max-w-md mx-auto"></div>
            <p class="text-xs md:text-sm text-amber-100/60 max-w-2xl mx-auto leading-relaxed">محاسبه آنلاین خسارت تاخیر تادیه (ماده ۵۲۲)، تشخیص صلاحیت دادگاه‌های صلح و استعلام برداری (وکتور) از منابع فقهی و حقوقی.</p>
        </section>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="gold-box p-6 rounded-2xl space-y-4">
                <h3 class="font-bold gold-text text-sm">۱. محاسبه‌گر تاخیر تادیه (ماده ۵۲۲)</h3>
                <input id="calcAmount" type="number" placeholder="مبلغ اصل خواسته (ریال)" class="gold-input w-full text-xs p-2.5 rounded-xl text-white font-mono">
                <div class="grid grid-cols-2 gap-2">
                    <input id="calcStart" type="number" placeholder="سال سررسید" class="gold-input text-xs p-2 rounded-xl text-white font-mono">
                    <input id="calcEnd" type="number" placeholder="سال محاسبه" class="gold-input text-xs p-2 rounded-xl text-white font-mono">
                </div>
                <button id="btnCalc" onclick="calcDamages()" class="gold-btn w-full font-bold py-2.5 rounded-xl text-xs transition">محاسبه آنلاین خسارت</button>
                <div id="resDamages" class="text-xs text-amber-200/80 font-semibold min-h-[30px]"></div>
            </div>

            <div class="gold-box p-6 rounded-2xl space-y-4">
                <h3 class="font-bold gold-text text-sm">۲. تشخیص صلاحیت دادگاه صلح</h3>
                <input id="courtAmount" type="number" placeholder="مبلغ خواسته (ریال)" class="gold-input w-full text-xs p-2.5 rounded-xl text-white font-mono">
                <button id="btnCourt" onclick="checkCourt()" class="gold-btn w-full font-bold py-2.5 rounded-xl text-xs transition">بررسی صلاحیت مرجع</button>
                <div id="resCourt" class="text-xs text-emerald-300 font-semibold min-h-[30px]"></div>
            </div>

            <div class="gold-box p-6 rounded-2xl space-y-4">
                <h3 class="font-bold gold-text text-sm">۳. استعلام وکتور قوانین (Qdrant)</h3>
                <input id="queryTxt" placeholder="موضوع حقوقی (مثلاً: چک صیادی)" class="gold-input w-full text-xs p-2.5 rounded-xl text-white">
                <button id="btnLaw" onclick="searchLaw()" class="gold-btn w-full font-bold py-2.5 rounded-xl text-xs transition">استعلام برداری منابع</button>
                <div id="resLaw" class="text-xs text-slate-300 max-h-32 overflow-y-auto min-h-[30px] leading-relaxed"></div>
            </div>
        </div>
    </main>

    <footer class="gold-border-t py-4 text-center text-xs text-amber-200/40">سامانه تخصصی قاضی هوشمند — ghazihoushmand.ir © ۱۴۰۵</footer>

    <script>
        function openModal(){ document.getElementById('authModal').classList.remove('hidden'); }
        function closeModal(){ document.getElementById('authModal').classList.add('hidden'); }
        function backToStep1(){
            document.getElementById('step2').classList.add('hidden');
            document.getElementById('step1').classList.remove('hidden');
            document.getElementById('alertBox').classList.add('hidden');
        }
        function showAlert(msg, ok){
            var box = document.getElementById('alertBox');
            box.classList.remove('hidden');
            box.className = 'text-xs p-2.5 rounded-xl text-center font-medium border ' + (ok
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-300 border-rose-500/30');
            box.innerHTML = msg;
        }
        function setRes(html){ document.getElementById('resDamages').innerHTML = html; }

        var resendTimer = null;
        function startResend(){
            var btn = document.getElementById('btnResend');
            var t = 90;
            btn.disabled = true;
            if(resendTimer) clearInterval(resendTimer);
            resendTimer = setInterval(function(){
                btn.innerHTML = 'ارسال مجدد کد (' + t + ' ثانیه)';
                t--;
                if(t < 0){ clearInterval(resendTimer); btn.disabled = false; btn.innerHTML = 'ارسال مجدد کد'; }
            }, 1000);
            btn.innerHTML = 'ارسال مجدد کد (۹۰ ثانیه)';
        }

        async function sendOtp(){
            var phone = document.getElementById('pNum').value.trim();
            var email = document.getElementById('pEmail').value.trim();
            if(!/^09\\d{9}$/.test(phone)){ showAlert('شماره موبایل باید ۱۱ رقم بوده و با ۰۹ شروع شود.', false); return; }
            var btn = document.getElementById('btnSendOtp');
            btn.disabled = true; btn.innerHTML = 'در حال ارسال پیامک...';
            try {
                var payload = {phone_number: phone, target_service: 'ghazi'};
                if(email) payload.email = email;
                var res = await fetch('/api/v1/auth/request-otp', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                var data = await res.json();
                if(res.ok){
                    document.getElementById('step1').classList.add('hidden');
                    document.getElementById('step2').classList.remove('hidden');
                    document.getElementById('otpMsg').innerHTML = data.message || 'کد تایید ارسال شد.';
                    showAlert('پیامک با موفقیت ارسال شد.', true);
                    startResend();
                } else {
                    showAlert(data.detail || 'خطا در ارسال پیامک.', false);
                }
            } catch(ex){ showAlert('خطای ارتباط با سرور.', false); }
            finally { btn.disabled = false; btn.innerHTML = 'ارسال کد تایید پیامکی'; }
        }

        async function verifyOtp(){
            var phone = document.getElementById('pNum').value.trim();
            var code = document.getElementById('oCode').value.trim();
            if(!/^\\d{4,6}$/.test(code)){ showAlert('کد تایید ۴ تا ۶ رقمی را وارد کنید.', false); return; }
            var btn = document.getElementById('btnVerify');
            btn.disabled = true; btn.innerHTML = 'در حال اعتبارسنجی...';
            try {
                var res = await fetch('/api/v1/auth/verify-otp', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone_number: phone, code: code})
                });
                var data = await res.json();
                if(res.ok){
                    showAlert('✅ ورود با موفقیت انجام شد. خوش آمدید!', true);
                    setTimeout(function(){ closeModal(); }, 1200);
                } else {
                    showAlert(data.detail || 'کد نامعتبر است.', false);
                }
            } catch(ex){ showAlert('خطا در تایید کد.', false); }
            finally { btn.disabled = false; btn.innerHTML = 'تایید و ورود به میز کار'; }
        }

        async function calcDamages(){
            var a = document.getElementById('calcAmount').value;
            var s = document.getElementById('calcStart').value;
            var en = document.getElementById('calcEnd').value;
            if(!a){ setRes('مبلغ اصل خواسته را وارد کنید.'); return; }
            if(!s || !en){ setRes('سال سررسید و سال محاسبه را وارد کنید.'); return; }
            var btn = document.getElementById('btnCalc');
            btn.disabled = true; btn.innerHTML = 'در حال محاسبه...';
            try {
                var res = await fetch('/api/v1/apps/judge/calculate-delay-damages', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({principal_amount_irr: parseFloat(a), start_year: parseInt(s), end_year: parseInt(en)})
                });
                var d = await res.json();
                if(res.ok){
                    setRes('ارزش روز: <b class="text-amber-300">' + Number(d.updated_value_to_date || 0).toLocaleString() + ' ریال</b><br>خسارت تاخیر تادیه: <b class="text-emerald-300">' + Number(d.total_delay_damages || 0).toLocaleString() + ' ریال</b><br><span class="text-amber-200/50">' + (d.legal_basis || '') + '</span>');
                } else { setRes('خطا در محاسبه.'); }
            } catch(ex){ setRes('خطای ارتباط با سرور.'); }
            finally { btn.disabled = false; btn.innerHTML = 'محاسبه آنلاین خسارت'; }
        }

        async function checkCourt(){
            var a = document.getElementById('courtAmount').value;
            var box = document.getElementById('resCourt');
            if(!a){ box.innerHTML = 'مبلغ خواسته را وارد کنید.'; return; }
            var btn = document.getElementById('btnCourt');
            btn.disabled = true; btn.innerHTML = 'در حال بررسی...';
            try {
                var res = await fetch('/api/v1/apps/judge/classify-court', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({dispute_type: 'FINANCIAL_DEBT', claim_amount_irr: parseFloat(a)})
                });
                var d = await res.json();
                if(res.ok){
                    box.innerHTML = 'مرجع صالح: <b class="text-amber-300">' + (d.competent_authority || 'دادگاه صلح') + '</b><br><span class="text-emerald-200/70">' + (d.jurisdiction_notes || '') + '</span>';
                } else { box.innerHTML = 'خطا در تعیین صلاحیت.'; }
            } catch(ex){ box.innerHTML = 'خطای ارتباط با سرور.'; }
            finally { btn.disabled = false; btn.innerHTML = 'بررسی صلاحیت مرجع'; }
        }

        async function searchLaw(){
            var q = document.getElementById('queryTxt').value.trim();
            var box = document.getElementById('resLaw');
            if(!q){ box.innerHTML = 'موضوع حقوقی را وارد کنید.'; return; }
            var btn = document.getElementById('btnLaw');
            btn.disabled = true; btn.innerHTML = 'در حال استعلام...';
            box.innerHTML = 'در حال جستجوی برداری در منابع حقوقی...';
            try {
                var res = await fetch('/api/v1/apps/judge/unified-search', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({query: q, limit: 3})
                });
                var d = await res.json();
                if(res.ok){
                    var html = '<b class="text-amber-300">' + (d.total_found || 0) + ' مدرک حقوقی یافت شد</b>';
                    html += '<br><span class="text-amber-200/60">📜 قوانین: ' + (d.laws_matches || []).length + ' | ⚖️ وحدت رویه: ' + (d.precedents_matches || []).length + ' | 📋 نظریات: ' + (d.advisory_matches || []).length + ' | 📢 بخشنامه‌ها: ' + (d.circulars_matches || []).length + '</span>';
                    var all = [].concat(d.laws_matches || [], d.precedents_matches || [], d.advisory_matches || [], d.circulars_matches || []).slice(0, 4);
                    for(var i = 0; i < all.length; i++){
                        var p = all[i] || {};
                        var t = p.title || p.subject || p.source || p.doc_type || '';
                        if(!t && p.text) t = String(p.text).slice(0, 60);
                        if(!t) t = 'سند حقوقی شماره ' + (i + 1);
                        html += '<br><span class="text-slate-300">• ' + String(t).slice(0, 90) + '</span>';
                    }
                    box.innerHTML = html;
                } else { box.innerHTML = 'خطا در استعلام وکتور.'; }
            } catch(ex){ box.innerHTML = 'خطای ارتباط با سرور.'; }
            finally { btn.disabled = false; btn.innerHTML = 'استعلام برداری منابع'; }
        }
    </script>
</body>
</html>"""

ROXIRA_HTML = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>روکسیرا OS | سامانه جامع ERP و مدیریت منابع سازمانی</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
    <style>body{font-family:Vazirmatn,sans-serif;background-color:#020617;color:#f8fafc;}</style>
</head>
<body class="min-h-screen bg-slate-950 flex flex-col justify-between">
    <header class="border-b border-cyan-500/30 bg-slate-900/90 px-6 py-4 flex justify-between items-center">
        <div class="flex items-center gap-3">
            <span class="text-2xl font-black text-cyan-400">R</span>
            <div>
                <h1 class="text-lg font-bold text-cyan-400">ROXIRA ENTERPRISE OS</h1>
                <p class="text-xs text-slate-400">سامانه ERP سازمانی، مدیریت زنجیره تامین و سامانه مودیان</p>
            </div>
        </div>
        <a href="https://ghazihoushmand.ir" class="text-xs text-amber-400 border border-amber-400/40 px-3 py-1.5 rounded-lg">سامانه قاضی هوشمند ⚖️</a>
    </header>
    <main class="max-w-4xl mx-auto py-16 px-4 text-center space-y-4 flex-grow">
        <h2 class="text-3xl font-extrabold text-white">کارخانه نرم‌افزاری خودمختار و مدیریت منابع سازمانی</h2>
        <p class="text-slate-400 text-xs">اتوماسیون انبارداری FIFO، حسابداری دوبل IFRS و سامانه مودیان مالیاتی.</p>
    </main>
    <footer class="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        Roxira OS Global Platform © 2026
    </footer>
</body>
</html>"""

@app.get("/health")
async def health():
    return {
        "status": "ONLINE",
        "service": "roxira-unified-server",
        "version": "3.6.0",
        "portals": ["ghazihoushmand.ir", "roxira.net"],
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
