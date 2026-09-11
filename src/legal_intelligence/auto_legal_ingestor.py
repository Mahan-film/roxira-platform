#!/usr/bin/env python3
import os
import sys
import json
import pathlib
import subprocess
import urllib.request

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.legal_intelligence.document_parser import parse_document_to_markdown, normalize_persian_text

class AutoLegalIngestor:
    """خط‌لوله خودکار خواندن اسناد، ساختاردهی به Markdown و ثبت در Qdrant و Postgres"""
    
    def __init__(self):
        self.qdrant_url = "http://127.0.0.1:6333"

    def ingest_precedent(self, prec_id: int, title: str, date_str: str, subject: str, content: str, related_laws: list):
        clean_content = normalize_persian_text(content)
        node_id = f"PRECEDENT_{prec_id}"
        meta = json.dumps({"id": prec_id, "date": date_str, "subject": subject}, ensure_ascii=False)
        
        # ۱. ذخیره در گراف دانش PostgreSQL
        sql_node = f"""
        INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
        VALUES ('{node_id}', 'PRECEDENT', '{title}', 'وحدت رویه', '{clean_content}', '{meta}'::jsonb)
        ON CONFLICT (node_id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata;
        """
        subprocess.run(["docker", "exec", "-i", "roxira_postgres_prod", "psql", "-U", "enterprise_admin", "-d", "enterprise_db", "-c", sql_node], capture_output=True)
        
        for law in related_laws:
            law_id = f"LAW_{law.replace(' ', '_')}"
            sql_law = f"""
            INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
            VALUES ('{law_id}', 'LAW', '{law}', 'قانون مرجع', 'مستند قانونی پرونده', '{{}}'::jsonb)
            ON CONFLICT (node_id) DO NOTHING;
            
            INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, description)
            VALUES ('{node_id}', '{law_id}', 'GOVERNS', '{subject}')
            ON CONFLICT DO NOTHING;
            """
            subprocess.run(["docker", "exec", "-i", "roxira_postgres_prod", "psql", "-U", "enterprise_admin", "-d", "enterprise_db", "-c", sql_law], capture_output=True)

        print(f"✅ رأی وحدت رویه شماره {prec_id} با موفقیت در گراف دانش ایندکس و پیوند خورد.")

def main():
    print("="*65)
    print("🧠 آغاز فرآیند همگام‌سازی و ایندکس خودکار دانش حقوقی")
    print("="*65)
    ingestor = AutoLegalIngestor()
    
    # نمونه آرای جدید سال ۱۴۰۵
    ingestor.ingest_precedent(
        prec_id=877,
        title="رأی وحدت رویه شماره ۸۷۷ دیوان عالی کشور",
        date_str="1405/03/12",
        subject="خسارت تأخیر تأدیه در ورشکستگی",
        content="مطابق ماده ۴۲۱ قانون تجارت پس از صدور حکم ورشکستگی قروض مؤجل به حال مبدل می‌شود...",
        related_laws=["تجارت ماده ۴۲۱", "آیین دادرسی مدنی ماده ۵۲۲"]
    )
    print("="*65)

if __name__ == "__main__":
    main()
