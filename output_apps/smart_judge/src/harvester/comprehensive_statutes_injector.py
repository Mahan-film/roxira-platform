from __future__ import annotations

import json
import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

MASSIVE_STATUTES_CORPUS = [
    # قانون مدنی - ضمان، ودیعه، عاریه، وکالت و رهن
    {"id": "CIVIL-ART-656", "title": "ماده ۶۵۶ قانون مدنی", "cat": "CIVIL", "content": "وکالت عقدی است که به موجب آن یکی از طرفین طرف دیگر را برای انجام امری نایب خود می‌نماید.", "refs": ["CIVIL-ART-10", "CIVIL-ART-219"]},
    {"id": "CIVIL-ART-678", "title": "ماده ۶۷۸ قانون مدنی", "cat": "CIVIL", "content": "وکالت به طرق ذیل مرتفع می‌شود: ۱- به عزل موکل ۲- به استعفای وکیل ۳- به موت یا به جنون وکیل یا موکل.", "refs": ["CIVIL-ART-656"]},
    {"id": "CIVIL-ART-683", "title": "ماده ۶۸۳ قانون مدنی", "cat": "CIVIL", "content": "هر گاه متعلق وکالت از بین برود یا موکل عملی را که مورد وکالت است خود انجام دهد وکالت منفسخ می‌شود.", "refs": ["CIVIL-ART-678"]},
    {"id": "CIVIL-ART-684", "title": "ماده ۶۸۴ قانون مدنی", "cat": "CIVIL", "content": "عقد ضمان عبارت است از اینکه شخصی مالی را که بر ذمه دیگری است به عهده بگیرد.", "refs": ["CIVIL-ART-219"]},
    {"id": "CIVIL-ART-698", "title": "ماده ۶۹۸ قانون مدنی", "cat": "CIVIL", "content": "بعد از اینکه ضمان صحیحاً واقع شد ذمه مضمون‌عنه از دین بری و ذمه ضامن به مضمون‌له مشغول می‌شود (نقل ذمه).", "refs": ["CIVIL-ART-684"]},
    {"id": "CIVIL-ART-771", "title": "ماده ۷۷۱ قانون مدنی", "cat": "CIVIL", "content": "رهن عقدی است که به موجب آن مدیون مالی را برای وثیقه به داین می‌دهد.", "refs": ["CIVIL-ART-219"]},
    {"id": "CIVIL-ART-777", "title": "ماده ۷۷۷ قانون مدنی", "cat": "CIVIL", "content": "در ضمن عقد رهن یا به موجب عقد علیحده ممکن است راهن مرتهن را وکیل کند که اگر در موعد مقرر دین را ادا ننمود از عین مرهونه طلب خود را استیفاء کند.", "refs": ["CIVIL-ART-771", "CIVIL-ART-656"]},

    # قانون آیین دادرسی مدنی - تامین خواسته و دستور موقت
    {"id": "PROC-ART-108", "title": "ماده ۱۰۸ قانون آیین دادرسی مدنی", "cat": "PROCEDURE", "content": "خواهان می‌تواند قبل از تقدیم دادخواست یا ضمن دادخواست راجع به اصل دعوا یا در جریان دادرسی تا وقتی که حکم قطعی صادر نشده است در موارد مصرحه درخواست تامین خواسته نماید.", "refs": ["PROC-ART-51"]},
    {"id": "PROC-ART-117", "title": "ماده ۱۱۷ قانون آیین دادرسی مدنی", "cat": "PROCEDURE", "content": "قرار تامین باید فوری به خوانده ابلاغ و پس از آن اجرا شود مگر در مواردی که ابلاغ فوری موجب تضییع حق گردد که ابتدا اجرا و سپس ابلاغ می‌شود.", "refs": ["PROC-ART-108"]},
    {"id": "PROC-ART-310", "title": "ماده ۳۱۰ قانون آیین دادرسی مدنی", "cat": "PROCEDURE", "content": "در اموری که تعیین تکلیف آن فوریت دارد دادگاه به درخواست ذینفع دستور موقت صادر می‌نماید.", "refs": ["PROC-ART-108"]},

    # قانون تجارت - شرکت‌های تجاری و مسئولیت مدیران
    {"id": "COMM-ART-116", "title": "ماده ۱۱۶ قانون تجارت", "cat": "COMMERCIAL", "content": "شرکت تضامنی شرکتی است که در تحت اسم مخصوص برای امور تجارتی بین دو یا چند نفر با مسئولیت تضامنی تشکیل می‌شود.", "refs": ["COMM-ART-249"]},
    {"id": "COMM-ART-142", "title": "ماده ۱۴۲ لایحه اصلاحی قانون تجارت", "cat": "COMMERCIAL", "content": "مدیران و مدیرعامل شرکت در مقابل شرکت و اشخاص ثالث نسبت به تخلف از مقررات قانونی یا اساسنامه منفرداً یا مشترکاً مسئول جبران خسارت می‌باشند.", "refs": ["CIVIL-RESP-ART-1"]}
]

def inject_comprehensive_statutes():
    print("=== INJECTING EXTENDED STATUTES CORPUS INTO GRAPH ===")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # ۱. درج نودها
            for item in MASSIVE_STATUTES_CORPUS:
                cur.execute("""
                    INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE
                    SET content = EXCLUDED.content;
                """, (
                    item["id"],
                    "ARTICLE",
                    item["title"],
                    item["cat"],
                    item["content"],
                    json.dumps({"keywords": [w for w in item["content"].split() if len(w) > 4][:5]}, ensure_ascii=False)
                ))

            # ۲. درج یال‌ها
            for item in MASSIVE_STATUTES_CORPUS:
                for target_id in item.get("refs", []):
                    cur.execute("SELECT 1 FROM graph_nodes WHERE node_id = %s;", (target_id,))
                    if cur.fetchone():
                        cur.execute("""
                            INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (source_node_id, target_node_id, relation_type) DO NOTHING;
                        """, (item["id"], target_id, "REFERENCES", 1.0, f"پیوند موضوعی {item['id']} به {target_id}"))

            conn.commit()
            
            cur.execute("SELECT count(*) FROM graph_nodes;")
            total_n = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM graph_edges;")
            total_e = cur.fetchone()[0]

    print(f"✅ INGESTION_SUCCESS: Total Knowledge Graph Nodes = {total_n} | Edges = {total_e}")

if __name__ == "__main__":
    inject_comprehensive_statutes()
