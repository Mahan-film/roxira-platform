#!/usr/bin/env python3
import json
import time
import urllib.request
import subprocess

print("="*75)
print("🔍 ۱. بررسی وضعیت پورت‌ها و فرایندهای کانتینر roxira_app_prod")
print("="*75)

# بررسی فرآیند uvicorn و پورت داخل کانتینر
proc_check = subprocess.run(
    ["docker", "exec", "roxira_app_prod", "sh", "-c", "ps aux | grep uvicorn || true"],
    capture_output=True, text=True
)
print("📌 فرآیندهای در حال اجرا:\n", proc_check.stdout.strip())

# کشف خودکار پیشوند روت فعال در FastAPI
routes_check = subprocess.run(
    ["docker", "exec", "roxira_app_prod", "python3", "-c", """
import sys
sys.path.insert(0, '/app')
try:
    from main import app
    paths = [r.path for r in app.routes if hasattr(r, 'path')]
    target = [p for p in paths if 'build-case-strategy' in p]
    print('FOUND_ROUTE:' + (target[0] if target else 'NONE'))
except Exception as e:
    print('ERROR:' + str(e))
"""],
    capture_output=True, text=True
)
found_line = [l for l in routes_check.stdout.split('\n') if 'FOUND_ROUTE:' in l]
route_path = found_line[0].replace('FOUND_ROUTE:', '').strip() if found_line else 'NONE'
print(f"📍 روت شناسایی‌شده در هسته: {route_path}")

target_url = f"http://127.0.0.1:8000{route_path}" if route_path != 'NONE' else "http://127.0.0.1:8000/build-case-strategy"

TEST_SUITE = [
    {
        "domain": "ورشکستگی و تأخیر تأدیه (تجارت و مدنی)",
        "case": "شرکت الف ورشکسته شده و اموال آن بر اثر تورم افزایش یافته است. بستانکار تقاضای خسارت تأخیر تأدیه طبق ماده ۵۲۲ دارد. وضعیت شانس موفقیت و رأی وحدت رویه ۸۷۷ چیست؟"
    },
    {
        "domain": "تخلفات ارزی و صلاحیت تعزیرات (کیفری اقتصادی)",
        "case": "واردکننده کالا در ارائه اسناد حمل تأخیر داشته و بانک مابه‌التفاوت ارز مطالبه کرده است. صلاحیت رسیدگی با کجاست؟"
    },
    {
        "domain": "تغییر کاربری اراضی زراعی (املاک و کیفری)",
        "case": "پرونده تغییر کاربری غیرمجاز باغ و قلع و قمع بنا در دادگاه مطرح است. صلاحیت رسیدگی با دادگاه صلح است یا دادگاه کیفری دو؟"
    },
    {
        "domain": "ممنوع‌الخروجی جرایم مواد مخدر (حقوق کیفری)",
        "case": "شخصی به اتهام نگهداری مواد مخدر در داخل کشور محکوم شده است. آیا دادگاه می‌تواند وی را ممنوع‌الخروج کند؟"
    },
    {
        "domain": "تخلفات انتظامی قضات و وکلا (نظارتی و انتظامی)",
        "case": "وکیل در تنظیم قرارداد و قاضی در صدور رأی مرتکب تخلف انتظامی شده‌اند. مراجع صالح انتظامی کدامند؟"
    },
    {
        "domain": "داوری و خسارت تأخیر تأدیه در آرای داور",
        "case": "داور در قرارداد تجاری نسبت به اصل خواسته و خسارت تأخیر تأدیه رأی صادر نموده است. وضعیت اجراییه رأی داور چیست؟"
    }
]

print("\n" + "="*75)
print("🚀 ۲. آغاز اجرای آزمون ۶ شاخه تخصصی حقوقی قاضی هوشمند")
print(f"🌐 آدرس هدف: {target_url}")
print("="*75)

success_count = 0
for idx, item in enumerate(TEST_SUITE, 1):
    t0 = time.time()
    payload = {"case_text": item["case"]}
    
    # تست درخواست از طریق کانتینر
    test_cmd = [
        "docker", "exec", "-i", "roxira_app_prod", "python3", "-c", f"""
import urllib.request, json
payload = {json.dumps(payload)}
req = urllib.request.Request(
    '{target_url}',
    data=json.dumps(payload).encode('utf-8'),
    headers={{'Content-Type': 'application/json'}}
)
with urllib.request.urlopen(req, timeout=8) as resp:
    print(resp.read().decode('utf-8'))
"""
    ]
    
    res = subprocess.run(test_cmd, capture_output=True, text=True)
    elapsed = round((time.time() - t0) * 1000, 2)
    
    if res.returncode == 0:
        try:
            data = json.loads(res.stdout.strip())
            success_count += 1
            print(f"\n[{idx}/6] ✅ حوزه: {item['domain']}")
            print(f"   ⏱️ زمان پردازش: {elapsed} ms | وضعیت: {data.get('status', 'SUCCESS')}")
            print(f"   📊 ارزیابی موفقیت: {data.get('success_probability', 'N/A')}")
            precedents = data.get("unified_precedents", [])
            if precedents:
                print(f"   🏛️ رأی استنادی: {precedents[0].get('title', 'N/A')}")
            laws = data.get("statutory_basis", [])
            if laws:
                print(f"   📜 مستندات قانونی: {', '.join([l.get('title', '') for l in laws[:2]])}")
        except Exception:
            print(f"\n[{idx}/6] ⚠️ خروجی غیر JSON: {res.stdout[:150]}")
    else:
        print(f"\n[{idx}/6] ❌ خطا در حوزه {item['domain']}: {res.stderr.strip()[:180]}")

print("\n" + "="*75)
print(f"🏁 نتیجه نهایی: {success_count} از {len(TEST_SUITE)} حوزه با موفقیت کامل ارزیابی و تأیید شدند.")
print("="*75)
