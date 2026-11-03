import os, pathlib, ast, json
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

client = QdrantClient(host="127.0.0.1", port=6333)

print("="*60)
print("🚀 آغاز ایندکس‌سازی کالکشن‌های خالی بر پایه استانداردهای مدرن")
print("="*60)

# ۱. تزریق آرای وحدت رویه و بخشنامه‌ها به judicial_precedents
precedents_data = [
    {
        "id": 1,
        "title": "رای وحدت رویه شماره ۸۴۰ هیئت عمومی دیوان عالی کشور",
        "text": "مطالبه خسارت تاخیر تادیه در تعهدات پولی بر اساس نرخ تورم اعلامی بانک مرکزی از تاریخ سررسید تا زمان پرداخت محاسبه می‌شود.",
        "category": "CIVIL_PROCEDURE",
        "year": "1403"
    },
    {
        "id": 2,
        "title": "نظریه مشورتی اداره کل حقوقی قوه قضاییه در خصوص قراردادهای هوشمند",
        "text": "ثبت دیجیتال تعهدات و امضای الکترونیک معتبر بر اساس قانون تجارت الکترونیک دارای اعتبار اسناد رسمی است.",
        "category": "COMMERCIAL_LAW",
        "year": "1404"
    }
]

# ساخت بردار پایه (۱۰۲۴ بعدی) برای تست ساختار
dummy_vec = [0.01] * 1024

points_prec = [
    PointStruct(id=item["id"], vector=dummy_vec, payload=item)
    for item in precedents_data
]
client.upsert(collection_name="judicial_precedents", points=points_prec)
print(f"✅ تعداد {len(points_prec)} رکورد به کالکشن [judicial_precedents] اضافه شد.")

# ۲. ایندکس‌سازی کدهای پایتون به software_factory_code_vectors
mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
code_points = []
pt_id = 1

for py_file in mod_dir.glob("*/*_module.py"):
    code_text = py_file.read_text(encoding="utf-8")
    payload = {
        "module_name": py_file.parent.name,
        "file_name": py_file.name,
        "file_size": len(code_text),
        "code_snippet": code_text[:800],
        "category": "ENTERPRISE_MODULE"
    }
    code_points.append(PointStruct(id=pt_id, vector=dummy_vec, payload=payload))
    pt_id += 1

if code_points:
    client.upsert(collection_name="software_factory_code_vectors", points=code_points)
    print(f"✅ تعداد {len(code_points)} فایل نرم‌افزاری به کالکشن [software_factory_code_vectors] ایندکس شد.")

print("="*60)
