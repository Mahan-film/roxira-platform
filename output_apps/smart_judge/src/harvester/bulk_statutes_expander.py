from __future__ import annotations

import json
import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

EXPANDED_LEGAL_NODES = [
    # قانون مدنی - بیع فضولی و خیارات
    {"id": "CIVIL-ART-247", "title": "ماده ۲۴۷ قانون مدنی", "cat": "CIVIL", "content": "ماده ۲۴۷ - انجام معامله نسبت به مال غیر جز به عنوان ولایت یا وصایت یا وکالت نافذ نیست ولو اینکه صاحب مال باطناً راضی باشد.", "keywords": ["معامله فضولی", "رد معامله", "تنفیذ"]},
    {"id": "CIVIL-ART-259", "title": "ماده ۲۵۹ قانون مدنی", "cat": "CIVIL", "content": "ماده ۲۵۹ - هر گاه معامله‌کننده مالی را که به او واگذار شده به دیگری بفروشد و مالک اصلی معامله اول را رد کند، معامله دوم نیز باطل است.", "keywords": ["رد معامله فضولی", "بطلان معاملات لاحق"]},
    {"id": "CIVIL-ART-301", "title": "ماده ۳۰۱ قانون مدنی", "cat": "CIVIL", "content": "ماده ۳۰۱ - کسی که عمداً یا اشتباهاً چیزی را که مستحق نبوده است دریافت کند ملزم است آن را به مالک تسلیم کند.", "keywords": ["ایفای ناروا", "استرداد مال", "دارا شدن ناعادلانه"]},
    {"id": "CIVIL-ART-308", "title": "ماده ۳۰۸ قانون مدنی", "cat": "CIVIL", "content": "ماده ۳۰۸ - غصب استیلاء بر حق غیر است به نحو عدوان. اثبات ید بر مال غیر بدون مجوز هم در حکم غصب است.", "keywords": ["غصب", "ضمان ید", "ید امانی و ضمانی"]},
    {"id": "CIVIL-ART-416", "title": "ماده ۴۱۶ قانون مدنی", "cat": "CIVIL", "content": "ماده ۴۱۶ - هر یک از متعاملین که در معامله غبن فاحش داشته باشد بعد از علم به غبن می‌تواند معامله را فسخ کند.", "keywords": ["خیار غبن", "غبن فاحش", "فسخ به علت ضرر"]},
    {"id": "CIVIL-ART-417", "title": "ماده ۴۱۷ قانون مدنی", "cat": "CIVIL", "content": "ماده ۴۱۷ - غبن در صورتی فاحش است که عرفاً قابل مسامحه نباشد.", "keywords": ["معیار غبن فاحش", "عرف و عادت"]},

    # مسئولیت مدنی و خسارات
    {"id": "CIVIL-RESP-ART-1", "title": "ماده ۱ قانون مسئولیت مدنی", "cat": "CIVIL", "content": "ماده ۱ - هر کس بدون مجوز قانونی عمداً یا در نتیجه بی‌احتیاطی به جان یا سلامتی یا مال یا آزادی یا حیثیت یا شهرت تجارتی دیگری لطمه‌ای وارد آورد مسئول جبران خسارت ناشی از آن است.", "keywords": ["مسئولیت قهری", "جبران خسارت", "تقصیر"]},

    # قانون تجارت - اسناد تجاری و برات
    {"id": "COMM-ART-249", "title": "ماده ۲۴۹ قانون تجارت", "cat": "COMMERCIAL", "content": "ماده ۲۴۹ - برات‌دهنده، قبول‌کننده برات و ظهرنویس‌ها در مقابل دارنده برات مسئولیت تضامنی دارند. دارنده برات در صورت عدم تادیه می‌تواند به هر کدام از آنها منفرداً یا به چند نفر یا به تمام آنها مجتمعاً رجوع نماید.", "keywords": ["مسئولیت تضامنی", "رجوع به ظهرنویس", "اسناد تجاری"]},
    {"id": "COMM-ART-314", "title": "ماده ۳۱۴ قانون تجارت", "cat": "COMMERCIAL", "content": "ماده ۳۱۴ - مقررات راجعه به برات در خصوص چک نیز لازم‌الرعایه است.", "keywords": ["تطبیق مقررات برات بر چک", "مسئولیت تضامنی چک"]}
]

EXPANDED_LEGAL_EDGES = [
    ("CIVIL-ART-259", "CIVIL-ART-247", "REFERENCES", "بطلان معاملات بعدی بر مبنای اصل رد فضولی"),
    ("CIVIL-ART-308", "CIVIL-ART-301", "MODIFIES", "غصب و اثبات ید غیرقانونی از مصادیق دارا شدن بلاجهت است"),
    ("CIVIL-ART-417", "CIVIL-ART-416", "REFERENCES", "تعریف معیار عرفی غبن فاحش مندرج در ماده ۴۱۶"),
    ("COMM-ART-314", "COMM-ART-249", "REFERENCES", "تسری مسئولیت تضامنی امضاکنندگان برات به صادرکننده و ظهرنویسان چک"),
    ("CHECK-ART-23", "COMM-ART-314", "REFERENCES", "صدور اجرائیه چک بدون اخلال در مسئولیت تضامنی ظهرنویسان")
]

def expand_knowledge_graph():
    print("=== EXPANDING COMPREHENSIVE STATUTES GRAPH ===")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            for n in EXPANDED_LEGAL_NODES:
                cur.execute("""
                    INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE
                    SET content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata;
                """, (n["id"], "ARTICLE", n["title"], n["cat"], n["content"], json.dumps({"keywords": n["keywords"]}, ensure_ascii=False)))

            for src, tgt, rel, desc in EXPANDED_LEGAL_EDGES:
                cur.execute("SELECT 1 FROM graph_nodes WHERE node_id = %s;", (tgt,))
                if cur.fetchone():
                    cur.execute("""
                        INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (source_node_id, target_node_id, relation_type) DO NOTHING;
                    """, (src, tgt, rel, 1.0, desc))
            conn.commit()

            cur.execute("SELECT count(*) FROM graph_nodes;")
            total_n = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM graph_edges;")
            total_e = cur.fetchone()[0]

    print(f"✅ GRAPH_EXPANSION_SUCCESS: {total_n} Nodes & {total_e} Edges in Knowledge Base.")

if __name__ == "__main__":
    expand_knowledge_graph()
