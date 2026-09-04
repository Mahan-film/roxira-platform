import sys
import time
import requests
import redis
from qdrant_client import QdrantClient

def test_redis_connection():
    try:
        r = redis.Redis(host='127.0.0.1', port=6379, socket_connect_timeout=2)
        r.ping()
        print("  ✅ اتصال به Redis 7 و مدیریت حافظه سشن: موفق (PONG)")
        return True
    except Exception as e:
        print(f"  ❌ خطای اتصال به Redis: {e}")
        return False

def test_qdrant_collections():
    try:
        client = QdrantClient(host="127.0.0.1", port=6333, timeout=3)
        collections = [c.name for c in client.get_collections().collections]
        expected = [
            "iran_laws_bge_m3",
            "judicial_precedents",
            "judiciary_circulars",
            "legal_advisory_opinions",
            "software_factory_code_vectors"
        ]
        all_passed = True
        for col in expected:
            if col in collections:
                info = client.get_collection(col)
                print(f"  ✅ کالکشن [{col}]: فعال (تعداد بردارها: {info.points_count})")
            else:
                print(f"  ❌ کالکشن [{col}] یافت نشد.")
                all_passed = False
        return all_passed
    except Exception as e:
        print(f"  ❌ خطای اتصال به Qdrant: {e}")
        return False

def test_verhoeff_moadian():
    # جدول‌های استاندارد گروه نامتقارن دی‌هدرال D_5
    d_table = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
        [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
        [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
        [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
        [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
        [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
        [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
        [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
        [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    ]
    p_table = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
        [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
        [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
        [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
        [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
        [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
        [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
    ]
    inv_table = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]

    def generate_check_digit(num_str):
        c = 0
        reversed_num = list(map(int, reversed(num_str)))
        for i, digit in enumerate(reversed_num):
            c = d_table[c][p_table[(i + 1) % 8][digit]]
        return inv_table[c]

    test_input = "111811904500000000001"
    check_digit = generate_check_digit(test_input)
    if check_digit == 3:
        print("  ✅ آزمون الگوریتم Verhoeff (D5) سامانه مودیان: پاس شد (Check Digit: 3)")
        return True
    else:
        print(f"  ❌ خطای الگوریتم Verhoeff: مقدار تولیدی {check_digit} با مقدار مورد انتظار 3 همخوانی ندارد.")
        return False

def test_api_endpoints():
    base_url = "http://127.0.0.1:8000"
    endpoints = [
        ("GET", "/health", 200),
        ("GET", "/api/v1/mcp/tools", 200),
        ("POST", "/api/v1/apps/judge/classify-court", 200, {"amount_irr": 850000000, "is_financial": True}),
        ("POST", "/api/v1/apps/iran-compliance/sayad/validate", 200, {"sayad_id": "1234567890123456"}),
        ("POST", "/api/v1/apps/judge/calculate-delay-damages", 200, {"principal_amount": 100000000, "due_year": 1400, "due_month": 1, "settle_year": 1405, "settle_month": 1})
    ]
    
    all_passed = True
    for method, path, expected_status, *payload in endpoints:
        start_t = time.time()
        try:
            if method == "GET":
                res = requests.get(f"{base_url}{path}", timeout=5)
            else:
                res = requests.post(f"{base_url}{path}", json=payload[0] if payload else {}, timeout=5)
            
            elapsed = (time.time() - start_t) * 1000
            if res.status_code == expected_status:
                print(f"  ✅ [{method}] {path} -> کد {res.status_code} ({elapsed:.1f}ms)")
            else:
                print(f"  ❌ [{method}] {path} -> کد دریافتی {res.status_code} (انتظار: {expected_status})")
                all_passed = False
        except Exception as e:
            print(f"  ❌ [{method}] {path} -> خطای ارتباط: {e}")
            all_passed = False
    return all_passed

if __name__ == "__main__":
    print("======================================================================")
    print("🔍 اجرای ارزیابی سرتاسری زیرساخت، وکتورها و الگوریتم‌های حاکمیتی")
    print("======================================================================")
    
    p1 = test_redis_connection()
    p2 = test_qdrant_collections()
    p3 = test_verhoeff_moadian()
    p4 = test_api_endpoints()
    
    print("======================================================================")
    if p1 and p2 and p3 and p4:
        print("🎯 وضعیت کل پلتفرم: ۱۰۰٪ تایید شده و آماده اجرای پروژه‌های خودکار.")
    else:
        print("⚠️ برخی آزمون‌ها با خطا مواجه شدند. نیاز به بررسی لاگ‌ها وجود دارد.")
    print("======================================================================")
