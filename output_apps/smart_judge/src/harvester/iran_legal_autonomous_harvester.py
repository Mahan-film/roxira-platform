"""
ROXIRA AUTONOMOUS IRANIAN LEGAL HARVESTER & GRAPHRAG BUILDER
"""
import os
import json
import psycopg
from typing import List, Dict, Any
from src.roxira_config import postgres_dsn

def get_db_url() -> str:
    if os.getenv("DATABASE_URL"):
        return os.getenv("DATABASE_URL")
    
    in_docker = os.path.exists("/.dockerenv") or os.getenv("POSTGRES_HOST") == "postgres_prod"
    default_host = "postgres_prod" if in_docker else "127.0.0.1"
    default_port = "5432" if in_docker else "5434"
    
    pg_host = os.getenv("POSTGRES_HOST", default_host)
    pg_port = os.getenv("POSTGRES_PORT", default_port)
    return postgres_dsn(host=pg_host, port=pg_port)

class AutonomousLegalHarvesterEngine:
    COMPREHENSIVE_STATUTES = [
        {"node_id": "CIVIL-ART-10", "title": "ماده ۱۰ قانون مدنی", "category": "CIVIL_CONTRACTS", "content": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند نافذ است."},
        {"node_id": "CIVIL-ART-190", "title": "ماده ۱۹۰ قانون مدنی", "category": "CIVIL_CONTRACTS", "content": "شرایط اساسی صحت معامله: قصد، اهلیت، موضوع معین و مشروعیت جهت."},
        {"node_id": "CIVIL-ART-219", "title": "ماده ۲۱۹ قانون مدنی", "category": "CIVIL_CONTRACTS", "content": "عقودی که بر طبق قانون واقع شده باشد لازم‌الاتباع است."},
        {"node_id": "CIVIL-ART-230", "title": "ماده ۲۳۰ قانون مدنی", "category": "CIVIL_CONTRACTS", "content": "عدم امکان تعدیل وجه التزام قراردادی توسط حاکم."},
        {"node_id": "CIVIL-ART-396", "title": "ماده ۳۹۶ قانون مدنی", "category": "CIVIL_RESCISSION", "content": "خیارات ده‌گانه فسخ معاملات."},
        {"node_id": "CHECK-ART-23", "title": "ماده ۲۳ قانون صدور چک", "category": "COMMERCIAL_CHECK", "content": "صدور اجرائیه مستقیم چک صیادی بدون دادرسی ماهوی."},
        {"node_id": "PEACE-COURT-ART-4", "title": "ماده ۴ قانون شوراهای حل اختلاف ۱۴۰۲", "category": "PEACE_COURT", "content": "صلاحیت دادگاه صلح در دعاوی مالی تا سقف ۱۰۰ میلیون تومان."},
        {"node_id": "PEACE-COURT-ART-5", "title": "ماده ۵ قانون شوراهای حل اختلاف ۱۴۰۲", "category": "PEACE_COURT", "content": "قطعیت آراء دادگاه صلح تا ۵۰ میلیون تومان و فرجه تجدیدنظر مازاد آن."},
        {"node_id": "REG-MANDATORY-1403", "title": "ماده ۱ قانون الزام به ثبت رسمی ۱۴۰۳", "category": "REGISTRATION_LAW", "content": "بی‌اعتباری اسناد عادی در املاک دارای سند تک‌برگ."},
        {"node_id": "MEHRIYEH-REG-113", "title": "بند ب ماده ۱۱۳ قانون برنامه ششم", "category": "FAMILY_EXECUTION", "content": "الزام مراجعه اولیه به اجرای ثبت برای مطالبه مهریه."},
        {"node_id": "DISCIPLINARY-JUDGES-ART-14", "title": "ماده ۱۴ نظارت بر رفتار قضات ۱۳۹۰", "category": "DISCIPLINARY", "content": "صلاحیت دادسرا و دادگاه عالی انتظامی قضات در رسیدگی به شکایات انتظامی."},
        {"node_id": "PRECEDENT-805", "title": "رای وحدت رویه ۸۰۵ دیوان عالی", "category": "PRECEDENT", "content": "اعتبار وجه التزام قراردادی مازاد بر نرخ تورم بانک مرکزی."},
        {"node_id": "PRECEDENT-811", "title": "رای وحدت رویه ۸۱۱ دیوان عالی", "category": "PRECEDENT", "content": "استرداد ثمن به نرخ روز در بیع باطل."},
        {"node_id": "PROC-ART-522", "title": "ماده ۵۲۲ قانون آیین دادرسی مدنی", "category": "CIVIL_PROCEDURE", "content": "خسارت تاخیر تادیه بر مبنای شاخص تورم بانک مرکزی."}
    ]

    DIRECTED_EDGES = [
        ("PEACE-COURT-ART-5", "PEACE-COURT-ART-4", "MODIFIES", 1.0, "تعیین قطعیت تا ۵۰ میلیون تومان"),
        ("REG-MANDATORY-1403", "CIVIL-ART-10", "EXCEPTS", 1.0, "تخصیص ماده ۱۰ در اسناد عادی املاک"),
        ("MEHRIYEH-REG-113", "CIVIL-ART-190", "GOVERNS", 1.0, "الزام اجرای ثبت قبل از دادگاه"),
        ("PRECEDENT-805", "CIVIL-ART-230", "GOVERNED_BY_PRECEDENT", 1.0, "حاکمیت رای ۸۰۵ بر وجه التزام"),
        ("PRECEDENT-811", "PROC-ART-522", "REFERENCES", 1.0, "محاسبه ارزش روز ثمن با شاخص تورم")
    ]

    @classmethod
    def harvest_and_ingest_all(cls) -> Dict[str, Any]:
        db_url = get_db_url()
        ingested = 0
        with psycopg.connect(db_url, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                # ۱. ساخت جداول در صورت عدم وجود
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS graph_nodes (
                        node_id VARCHAR(128) PRIMARY KEY,
                        node_type VARCHAR(64) DEFAULT 'ARTICLE',
                        title VARCHAR(512) NOT NULL,
                        category VARCHAR(128),
                        content TEXT NOT NULL,
                        metadata JSONB DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS graph_edges (
                        source_node_id VARCHAR(128) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
                        target_node_id VARCHAR(128) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
                        relation_type VARCHAR(64) NOT NULL,
                        weight FLOAT DEFAULT 1.0,
                        description TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        PRIMARY KEY (source_node_id, target_node_id, relation_type)
                    );
                """)
                # ۲. تزریق نودها
                for n in cls.COMPREHENSIVE_STATUTES:
                    cur.execute("""
                        INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                        VALUES (%s, 'ARTICLE', %s, %s, %s, %s)
                        ON CONFLICT (node_id) DO UPDATE SET content = EXCLUDED.content, title = EXCLUDED.title;
                    """, (n["node_id"], n["title"], n["category"], n["content"], json.dumps({"active": True}, ensure_ascii=False)))
                    ingested += 1
                # ۳. تزریق یال‌ها
                for src, tgt, rel, weight, desc in cls.DIRECTED_EDGES:
                    cur.execute("""
                        INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (source_node_id, target_node_id, relation_type) DO UPDATE SET description = EXCLUDED.description;
                    """, (src, tgt, rel, weight, desc))
                conn.commit()

        return {"status": "SUCCESS", "nodes_ingested": ingested}

if __name__ == "__main__":
    res = AutonomousLegalHarvesterEngine.harvest_and_ingest_all()
    print("✅ Legal Statutes Ingested:", res["nodes_ingested"])
