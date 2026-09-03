import urllib.request, json, pathlib

QDRANT_URL = "http://127.0.0.1:6333"
dummy_vec = [0.01] * 1024

def upsert_points(col_name, points):
    req = urllib.request.Request(
        f"{QDRANT_URL}/collections/{col_name}/points?wait=true",
        data=json.dumps({"points": points}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT"
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

# ۱. تزریق به judicial_precedents
precedents = [
    {
        "id": 1,
        "vector": dummy_vec,
        "payload": {
            "title": "رای وحدت رویه شماره ۸۴۰ دیوان عالی کشور",
            "text": "محاسبه خسارت تاخیر تادیه بر مبنای نرخ تورم بانک مرکزی از تاریخ سررسید تا پرداخت.",
            "category": "CIVIL",
            "year": "1403"
        }
    },
    {
        "id": 2,
        "vector": dummy_vec,
        "payload": {
            "title": "نظریه مشورتی اداره کل حقوقی قوه قضاییه",
            "text": "اعتبار قانونی اسناد رسمی و ثبت الکترونیکی قراردادها در بستر وب.",
            "category": "COMMERCIAL",
            "year": "1404"
        }
    }
]
upsert_points("judicial_precedents", precedents)
print("✅ کالکشن [judicial_precedents] با موفقیت پر شد.")

# ۲. تزریق به software_factory_code_vectors
mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
code_points = []
idx = 1
for py_f in mod_dir.glob("*/*_module.py"):
    code = py_f.read_text(encoding="utf-8")
    code_points.append({
        "id": idx,
        "vector": dummy_vec,
        "payload": {
            "module": py_f.parent.name,
            "filename": py_f.name,
            "size_bytes": len(code),
            "code_summary": code[:350]
        }
    })
    idx += 1

if code_points:
    upsert_points("software_factory_code_vectors", code_points)
    print(f"✅ تعداد {len(code_points)} ماژول به [software_factory_code_vectors] ایندکس شد.")
