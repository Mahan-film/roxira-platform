import urllib.request, json, pathlib

QDRANT_URL = "http://127.0.0.1:6333"
dummy_vector = [0.01] * 1024

print("🚀 همگام‌سازی کالکشن‌های Qdrant با REST API...")

# ۱. تزریق به judicial_precedents
precedents = [
    {"id": 1, "title": "رای وحدت رویه شماره ۸۴۰ هیئت عمومی دیوان عالی کشور", "text": "مطالبه خسارت تاخیر تادیه در تعهدات پولی بر اساس شاخص بانک مرکزی محاسبه می‌شود.", "category": "CIVIL"},
    {"id": 2, "title": "نظریه مشورتی قوه قضاییه در قراردادهای هوشمند", "text": "ثبت دیجیتال تعهدات دارای اعتبار اسناد لازم‌الاجرا است.", "category": "COMMERCIAL"}
]
p_points = [{"id": p["id"], "vector": dummy_vector, "payload": p} for p in precedents]
req = urllib.request.Request(f"{QDRANT_URL}/collections/judicial_precedents/points?wait=true", data=json.dumps({"points": p_points}).encode(), headers={"Content-Type": "application/json"})
urllib.request.urlopen(req)
print("✅ کالکشن judicial_precedents با موفقیت مقداردهی شد.")

# ۲. تزریق ماژول‌ها به software_factory_code_vectors
mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
c_points = []
idx = 1
for py_f in mod_dir.glob("*/*_module.py"):
    code = py_f.read_text(encoding="utf-8")
    c_points.append({"id": idx, "vector": dummy_vector, "payload": {"module": py_f.parent.name, "file": py_f.name, "size": len(code), "snippet": code[:400]}})
    idx += 1

if c_points:
    req = urllib.request.Request(f"{QDRANT_URL}/collections/software_factory_code_vectors/points?wait=true", data=json.dumps({"points": c_points}).encode(), headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req)
    print(f"✅ تعداد {len(c_points)} ماژول نرم‌افزاری در software_factory_code_vectors ایندکس شد.")
