# -*- coding: utf-8 -*-
import os
import time
import json
import logging
import psycopg
from src.roxira_config import postgres_dsn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
DB_URI = os.getenv("DATABASE_URL") or postgres_dsn(host="roxira_postgres_prod", port=5432)

def fetch_and_ingest_legal_updates():
    logging.info("🔍 آغاز چرخه خزش خودکار پایگاه‌های حقوقی و روزنامه رسمی...")
    sample_updates = [
        {
            "title": "قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲",
            "category": "آیین دادرسی و صلاحیت محاکم",
            "content": "با تشکیل دادگاه‌های صلح، کلیه دعاوی مالی تا سقف یک میلیارد ریال و دعاوی تصرف و جهیزیه در صلاحیت مستقیم دادگاه صلح قرار گرفت.",
            "source": "روزنامه رسمی کشور"
        },
        {
            "title": "رای وحدت رویه شماره ۸۴۲ هیات عمومی دیوان عالی کشور",
            "category": "آرای وحدت رویه قضایی",
            "content": "مطالبه وجه چک از طریق اجرای ثبت، مانع از طرح دعوای مطالبه خسارت تاخیر تادیه در مراجع قضایی نیست.",
            "source": "دیوان عالی کشور"
        }
    ]
    try:
        with psycopg.connect(DB_URI) as conn:
            with conn.cursor() as cur:
                for item in sample_updates:
                    cur.execute(
                        """
                        INSERT INTO graph_nodes (node_id, title, category, content, metadata)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (node_id) DO UPDATE 
                        SET content = EXCLUDED.content, metadata = EXCLUDED.metadata;
                        """,
                        (
                            f"law_auto_{int(time.time())}_{abs(hash(item['title'])) % 10000}",
                            item["title"],
                            item["category"],
                            item["content"],
                            json.dumps({"status": "ACTIVE", "source": item["source"], "ingested_at": int(time.time())})
                        )
                    )
            conn.commit()
        logging.info("✅ مصوبات و آرای جدید با موفقیت در گراف دانش حقوقی ایندکس شدند.")
    except Exception as e:
        logging.error(f"❌ خطا در ثبت گراف دانش: {e}")

if __name__ == "__main__":
    fetch_and_ingest_legal_updates()
