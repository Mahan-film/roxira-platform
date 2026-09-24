#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ابزار تزریق متون قوانین به زیرساخت حقوقی رُخیرا (Legal Data Ingestor).

اقدامات:
  ۱) چانک‌بندی هوشمند متن قوانین بر اساس شماره مواد (ارقام فارسی/لاتین).
     تبصره‌ها و بندها ضمیمه چانک ماده مربوطه حفظ می‌شوند.
  ۲) تزریق مواد به گراف PostgreSQL (graph_nodes) با upsert روی node_id.
  ۳) اطمینان از آماده بودن کالکشن برداری Qdrant (iran_laws_bge_m3 —
     ابعاد ۱۰۲۴ و فاصله Cosine مطابق استاندارد BGE-M3).

نکات زیرساختی (مهم — تفاوت با پیش‌نویس اولیه):
  - درایور دیتابیس: psycopg نسخه ۳ (psycopg2 در ایمیج تولیدی نصب نیست).
  - ستون‌های مرجع graph_nodes: (node_id, node_type, title, category, content, metadata).
  - تعامل با Qdrant از طریق REST API (کتابخانه qdrant_client در کانتینر نصب نیست؛
    رویه رایج codebase همان REST است — مطابق crawlers / qdrant_manager).
  - هیچ وکتور ساختگی تولید نمی‌شود؛ payload آماده برای اتصال embedder واقعی
    (bge-m3) ساخته می‌شود (مطابق اصل bulk_legal_ingestion).

نحوه اجرای smoke-test داخل کانتینر:
    docker exec -i roxira_app_prod python - < scripts/legal_data_ingestor.py

smoke-test ایمن است: از namespace دسته «DEMO» استفاده می‌کند (metadata:
active=false, sample=true) و هیچ namespace قانون واقعی (مانند CIVIL-ART-*
که به قانون مدنی تعلق دارد) را بازنویسی یا آلوده نمی‌کند.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

import psycopg  # psycopg نسخه ۳ — psycopg2 در ایمیج تولیدی نصب نیست

DEFAULT_COLLECTION = "iran_laws_bge_m3"
VECTOR_SIZE = 1024  # استاندارد مدل تعبیه‌سازی BGE-M3
VECTOR_DISTANCE = "Cosine"

# تبدیل ارقام فارسی به لاتین (برای ساخت node_id یکدست)
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")

# الگوی اصلی تفکیک مواد: «ماده 12-» / «ماده ۱۲:» / «ماده ۷.» (با جداکننده) —
# جداکننده الزامی است تا ارجاعات داخل متن (مثل «مطابق ماده 19») به‌اشتباه تفکیک نشوند.
ARTICLE_HEADER_RE = re.compile(r"(ماده\s+[0-9۰-۹]+[\s\u200c]*[-–—:.٫])")
# الگوی جایگزین: ماده در ابتدای سطر بدون جداکننده (کم‌خطر — انکر ابتدای خط)
ARTICLE_HEADER_RE_LOOSE = re.compile(r"(?m)^(ماده\s+[0-9۰-۹]+)")
ARTICLE_NUM_RE = re.compile(r"[0-9۰-۹]+")


def build_dsn() -> str:
    """اولویت اتصال: DATABASE_URL سپس متغیرهای POSTGRES_* (مطابق docker-compose.prod.yml)."""
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    host = os.getenv("POSTGRES_HOST", "postgres_prod")
    port = os.getenv("POSTGRES_PORT", "5432")
    user = os.getenv("POSTGRES_USER", "enterprise_admin")
    password = os.environ["POSTGRES_PASSWORD"]
    db = os.getenv("POSTGRES_DB", "enterprise_db")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def parse_and_chunk_law(raw_text: str, law_title: str, category: str) -> list:
    """چانک‌بندی هوشمند متن قوانین بر اساس شماره مواد و تبصره‌ها.

    هر چانک: {"node_id", "article_number", "title", "category", "text"}
    تبصره‌ها/بندها چون در ادامه متن ماده می‌آیند، ضمیمه همان ماده باقی می‌مانند.
    """
    parts = re.split(ARTICLE_HEADER_RE, raw_text)
    if len(parts) < 3:  # هیچ ماده‌ای با جداکننده پیدا نشد — تلاش با الگوی سطر-محور
        parts = re.split(ARTICLE_HEADER_RE_LOOSE, raw_text)

    chunks: list = []
    for i in range(1, len(parts), 2):
        header = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        num_match = ARTICLE_NUM_RE.search(header)
        art_num = num_match.group(0).translate(PERSIAN_DIGITS) if num_match else "0"

        chunks.append({
            "node_id": f"{category}-ART-{art_num}",
            "article_number": art_num,
            "title": f"{law_title} - ماده {art_num}",
            "category": category,
            "text": f"{header} {body}".strip(),
        })
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# لایه Qdrant — تعامل از طریق REST (کتابخانه qdrant_client در کانتینر نصب نیست)
# ─────────────────────────────────────────────────────────────────────────────
def _qdrant_hosts() -> list:
    """اولویت‌بندی هاست‌ها مطابق رویه crawlers (با حذف تکراری‌ها)."""
    candidates = [
        os.getenv("QDRANT_HOST", "qdrant_prod"),
        "qdrant_prod",
        "roxira_qdrant_prod",
        "127.0.0.1",
        "localhost",
    ]
    seen, hosts = set(), []
    for h in candidates:
        if h and h not in seen:
            seen.add(h)
            hosts.append(h)
    return hosts


def _qdrant_request(host: str, port: str, path: str, method: str = "GET",
                    payload: dict | None = None, timeout: int = 10) -> dict:
    url = f"http://{host}:{port}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ensure_qdrant_collection(collection_name: str = DEFAULT_COLLECTION) -> dict:
    """اتصال به Qdrant، ایجاد کالکشن در صورت نبود و گزارش وضعیت بردارها."""
    port = os.getenv("QDRANT_PORT", "6333")
    last_err = None
    for host in _qdrant_hosts():
        try:
            collections = _qdrant_request(host, port, "/collections")
            names = [c["name"] for c in collections.get("result", {}).get("collections", [])]
            created = False
            if collection_name not in names:
                _qdrant_request(
                    host, port, f"/collections/{collection_name}", method="PUT",
                    payload={"vectors": {"size": VECTOR_SIZE, "distance": VECTOR_DISTANCE}},
                )
                created = True
            info = _qdrant_request(host, port, f"/collections/{collection_name}").get("result", {})
            return {
                "ok": True,
                "host": host,
                "collection": collection_name,
                "created": created,
                "points_count": info.get("points_count", 0),
                "status": info.get("status", "unknown"),
            }
        except Exception as exc:  # تلاش با هاست بعدی
            last_err = exc
            continue
    return {"ok": False, "collection": collection_name, "error": str(last_err)}


def build_qdrant_payloads(chunks: list, start_id: int = 1) -> list:
    """ساخت payload آماده ثبت در Qdrant (بدون وکتور) — قرارداد canonical_corpus_loader.

    پس از اتصال embedder واقعی (bge-m3)، هر آیتم فقط نیاز به کلید "vector"
    با بردار ۱۰۲۴ بعدی دارد تا با PUT /points ثبت شود.
    """
    payloads = []
    for idx, c in enumerate(chunks, start=start_id):
        payloads.append({
            "id": idx,
            "component_id": c["node_id"],
            "title": c["title"],
            "text": c["text"],
            "category": c["category"],
        })
    return payloads


# ─────────────────────────────────────────────────────────────────────────────
# لایه PostgreSQL — گراف دانش حقوقی
# ─────────────────────────────────────────────────────────────────────────────
def ingest_to_postgres(chunks: list, law_title: str, is_sample: bool = False) -> dict:
    """درج مواد در graph_nodes با upsert روی node_id (ستون‌های مرجع schema واقعی)."""
    if not chunks:
        return {"ok": False, "error": "هیچ چانکی برای درج وجود ندارد."}

    dsn = build_dsn()
    with psycopg.connect(dsn, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            for c in chunks:
                meta = {
                    "active": not is_sample,
                    "sample": is_sample,
                    "source": "legal_data_ingestor",
                    "law_title": law_title,
                }
                cur.execute(
                    """
                    INSERT INTO graph_nodes
                        (node_id, node_type, title, category, content, metadata)
                    VALUES (%s, 'ARTICLE', %s, %s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE
                    SET title    = EXCLUDED.title,
                        category = EXCLUDED.category,
                        content  = EXCLUDED.content,
                        metadata = EXCLUDED.metadata
                    """,
                    (c["node_id"], c["title"], c["category"], c["text"],
                     json.dumps(meta, ensure_ascii=False)),
                )
        conn.commit()

        # راستی‌آزمایی پس از commit
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM graph_nodes WHERE node_id = ANY(%s);",
                ([c["node_id"] for c in chunks],),
            )
            verified = cur.fetchone()[0]

    return {"ok": verified == len(chunks), "inserted": len(chunks), "verified": verified,
            "node_ids": [c["node_id"] for c in chunks]}


def ingest_to_postgres_and_qdrant(chunks: list, law_title: str = "",
                                  is_sample: bool = False,
                                  collection_name: str = DEFAULT_COLLECTION) -> dict:
    """تزریق هم‌زمان به گراف PostgreSQL و آماده‌سازی کالکشن Qdrant."""
    pg_result = ingest_to_postgres(chunks, law_title, is_sample)
    if pg_result.get("ok"):
        print(f"✅ تعداد {pg_result['inserted']} ماده در پایگاه داده گراف PostgreSQL ثبت شد "
              f"(تأیید: {pg_result['verified']}).")
    else:
        print(f"⚠️ ارور در ثبت گراف پستگرس: {pg_result.get('error', 'تأیید ناموفق')}")

    q_result = ensure_qdrant_collection(collection_name)
    if q_result.get("ok"):
        print("✅ اتصال به Qdrant برقرار و کالکشن آماده دریافت وکتورها است "
              f"({q_result['collection']} | {q_result['points_count']} بردار فعّال | "
              f"host={q_result['host']}).")
    else:
        print(f"⚠️ ارور در اتصال به Qdrant: {q_result.get('error', 'نامشخص')}")

    payloads = build_qdrant_payloads(chunks)
    return {"postgres": pg_result, "qdrant": q_result, "payloads_ready": len(payloads)}


if __name__ == "__main__":
    # smoke-test — دسته «DEMO» عمداً از namespace قوانین واقعی (CIVIL و ...)
    # جدا است تا محتوای نمونه هرگز جایگزین مواد واقعی نشود.
    sample_law_text = """
    ماده 1- کلیه دعاوی مالی تا سقف یک میلیارد ریال در صلاحیت دادگاه صلح است.
    ماده 2- رسیدگی به دعاوی غیرمالی بر اساس مقررات آیین دادرسی مدنی خواهد بود.
    """
    chunks = parse_and_chunk_law(sample_law_text, "قانون نمونه", "DEMO")
    print(f"📦 {len(chunks)} چانک از متن نمونه استخراج شد: "
          f"{[c['node_id'] for c in chunks]}")

    result = ingest_to_postgres_and_qdrant(chunks, law_title="قانون نمونه", is_sample=True)

    ok = result["postgres"].get("ok") and result["qdrant"].get("ok")
    print("✅ INGESTOR_SMOKE_TEST=PASS" if ok else "⚠️ INGESTOR_SMOKE_TEST=FAIL")
    print(f"   payload آماده برای embedder واقعی (bge-m3): {result['payloads_ready']} رکورد")
    sys.exit(0 if ok else 1)

