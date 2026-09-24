#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
استقرار زیرساخت «اعاده دادرسی» و گره‌های انتظامی/نظامی در دیتابیس تولیدی رُخیرا.

اقدامات:
  ۱) ایجاد جدول user_retrial_requests — ثبت درخواست‌های اعاده دادرسی با احراز هویت
     (SMS/EMAIL) و سهمیه‌بندی (شمارش درخواست‌های هر user_id در بازه زمانی).
  ۲) افزودن گره‌های انتظامی و نظامی به گراف قضایی (graph_nodes):
     - ART-MILITARY-41          → ماده ۴۱ قانون مجازات جرایم نیروهای مسلح
     - RULING-867               → رأی وحدت رویه ۸۶۷ دیوان عالی (نوع PRECEDENT)
     - ART-JUDGES-DISCIPLINARY  → قانون نظارت بر رفتار قضات
     - ART-LAWYERS-DISCIPLINARY → آیین‌نامه انتظامی کانون وکلا و مرکز وکلا
  ۳) افزودن یال RULING-867 --INTERPRETS--> ART-MILITARY-41 به graph_edges.

نحوه اجرا (داخل کانتینر برنامه — scripts/ در کانتینر mount نمی‌شود):
    docker exec -i roxira_app_prod python - < scripts/setup_retrial_and_disciplinary.py

اسکیمای مرجع (دیتابیس تولیدی):
  graph_nodes (node_id PK, node_type, title, category, content, metadata jsonb, created_at)
  graph_edges (source_node_id, target_node_id, relation_type) PK + FK به graph_nodes
"""
from __future__ import annotations

import json
import os
import sys

import psycopg  # psycopg نسخه ۳ — psycopg2 در ایمیج تولیدی نصب نیست

RETRIAL_NODE_IDS = (
    "ART-MILITARY-41",
    "RULING-867",
    "ART-JUDGES-DISCIPLINARY",
    "ART-LAWYERS-DISCIPLINARY",
)


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


# ─────────────────────────────────────────────────────────────────────────────
# ۱) جدول ثبت درخواست‌های اعاده دادرسی با سهمیه و احراز هویت
# ─────────────────────────────────────────────────────────────────────────────
CREATE_RETRIAL_TABLE = """
CREATE TABLE IF NOT EXISTS user_retrial_requests (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    email VARCHAR(150),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_type VARCHAR(20),              -- 'SMS' یا 'EMAIL'
    case_type VARCHAR(30) NOT NULL,             -- 'CRIMINAL_474' | 'CIVIL_426' | 'SPECIAL_477'
    case_description TEXT NOT NULL,
    verdict_summary TEXT,
    eligibility_score INT DEFAULT 0,
    matched_clause VARCHAR(100),
    draft_petition TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

CREATE_IDX_USER = """
CREATE INDEX IF NOT EXISTS idx_user_retrial_requests_user_id
ON user_retrial_requests (user_id)
"""

CREATE_IDX_CREATED = """
CREATE INDEX IF NOT EXISTS idx_user_retrial_requests_created_at
ON user_retrial_requests (created_at)
"""

# ─────────────────────────────────────────────────────────────────────────────
# ۲) گره‌های انتظامی/نظامی گراف قضایی — (node_id, node_type, title, category, content, metadata)
# ─────────────────────────────────────────────────────────────────────────────
GRAPH_NODES = [
    (
        "ART-MILITARY-41",
        "ARTICLE",
        "ماده ۴۱ قانون مجازات جرایم نیروهای مسلح",
        "MILITARY",
        "تیراندازی عمدی برخلاف ضوابط مستوجب مجازات است و شلیک سهوی صرفاً دارای مسئولیت مدنی است.",
        {"active": True, "source": "retrial_disciplinary_setup"},
    ),
    (
        "RULING-867",
        "PRECEDENT",
        "رأی وحدت رویه ۸۶۷ دیوان عالی",
        "PRECEDENT",
        "شلیک سهوی فرد نظامی وصف مجرمانه نداشته و صرفاً مسئولیت مدنی دارد.",
        {"active": True, "source": "retrial_disciplinary_setup"},
    ),
    (
        "ART-JUDGES-DISCIPLINARY",
        "ARTICLE",
        "قانون نظارت بر رفتار قضات",
        "DISCIPLINARY",
        "تخلفات انتظامی قضات و مراجع رسیدگی در دادگاه عالی انتظامی قضات.",
        {"active": True, "source": "retrial_disciplinary_setup"},
    ),
    (
        "ART-LAWYERS-DISCIPLINARY",
        "ARTICLE",
        "آیین‌نامه انتظامی کانون وکلا و مرکز وکلا",
        "DISCIPLINARY",
        "مقررات حاکم بر تخلفات حرفه‌ای و دادگاه‌های انتظامی وکلا و کارشناسان.",
        {"active": True, "source": "retrial_disciplinary_setup"},
    ),
]

# ─────────────────────────────────────────────────────────────────────────────
# ۳) یال‌های گراف — (source_node_id, target_node_id, relation_type, weight, description)
# ─────────────────────────────────────────────────────────────────────────────
GRAPH_EDGES = [
    (
        "RULING-867",
        "ART-MILITARY-41",
        "INTERPRETS",
        1.0,
        "تفسیر مضیق شلیک سهوی نظامیان به نفع متهم",
    ),
]


def main() -> int:
    dsn = build_dsn()
    # نمایش نقطه اتصال بدون افشای رمز عبور
    safe_dsn = dsn.split("@")[-1] if "@" in dsn else dsn
    print(f"⏳ اتصال به دیتابیس: {safe_dsn}")

    try:
        with psycopg.connect(dsn, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                # ۱) جدول و اندیس‌های درخواست اعاده دادرسی
                cur.execute(CREATE_RETRIAL_TABLE)
                cur.execute(CREATE_IDX_USER)
                cur.execute(CREATE_IDX_CREATED)

                # ۲) درج/به‌روزرسانی گره‌های گراف (idempotent)
                for node_id, node_type, title, category, content, meta in GRAPH_NODES:
                    cur.execute(
                        """
                        INSERT INTO graph_nodes
                            (node_id, node_type, title, category, content, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (node_id) DO UPDATE
                        SET node_type = EXCLUDED.node_type,
                            title     = EXCLUDED.title,
                            category  = EXCLUDED.category,
                            content   = EXCLUDED.content,
                            metadata  = EXCLUDED.metadata
                        """,
                        (node_id, node_type, title, category, content,
                         json.dumps(meta, ensure_ascii=False)),
                    )

                # ۳) درج یال‌های گراف — گره‌ها پیش از یال‌ها ثبت شده‌اند (نیاز FK)
                for src, tgt, rel, weight, desc in GRAPH_EDGES:
                    cur.execute(
                        """
                        INSERT INTO graph_edges
                            (source_node_id, target_node_id, relation_type, weight, description)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (source_node_id, target_node_id, relation_type) DO UPDATE
                        SET weight      = EXCLUDED.weight,
                            description = EXCLUDED.description
                        """,
                        (src, tgt, rel, weight, desc),
                    )

            conn.commit()

            # ۴) راستی‌آزمایی پس از commit
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name = 'user_retrial_requests';"
                )
                table_exists = cur.fetchone()[0]

                cur.execute("SELECT COUNT(*) FROM user_retrial_requests;")
                retrial_rows = cur.fetchone()[0]

                cur.execute(
                    "SELECT COUNT(*) FROM graph_nodes WHERE node_id = ANY(%s);",
                    (list(RETRIAL_NODE_IDS),),
                )
                nodes_count = cur.fetchone()[0]

                cur.execute(
                    "SELECT COUNT(*) FROM graph_edges "
                    "WHERE source_node_id = %s AND target_node_id = %s AND relation_type = %s;",
                    (GRAPH_EDGES[0][0], GRAPH_EDGES[0][1], GRAPH_EDGES[0][2]),
                )
                edges_count = cur.fetchone()[0]

        print("✅ جداول اعاده دادرسی و گره‌های انتظامی/نظامی با موفقیت در دیتابیس مستقر شدند.")
        print(f"   user_retrial_requests: {'موجود' if table_exists else 'ناموجود!'} | ردیف‌ها: {retrial_rows}")
        print(f"   graph_nodes (انتظامی/نظامی): {nodes_count}/{len(RETRIAL_NODE_IDS)}")
        print(f"   graph_edges (INTERPRETS): {edges_count}/{len(GRAPH_EDGES)}")

        if table_exists and nodes_count == len(RETRIAL_NODE_IDS) and edges_count == len(GRAPH_EDGES):
            print("✅ VERIFICATION=PASS")
            return 0
        print("⚠️ VERIFICATION=FAIL — خروجی مورد انتظار حاصل نشد.")
        return 1

    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ ارور در ثبت دیتابیس: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

