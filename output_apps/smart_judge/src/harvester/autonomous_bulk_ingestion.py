from __future__ import annotations

import re
import json
import psycopg
from typing import List, Dict, Any
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

# بدنه جامع ابواب تفصیلی قوانین مدنی، تجاری، کیفری و دادرسی
FULL_LEGAL_BOOKS = [
    # ۱. قانون مدنی - اموال، تعهدات، عقود معین، سقوط تعهدات، ارث و وصیت
    {"id": "CIVIL-ART-30", "title": "ماده ۳۰ قانون مدنی", "cat": "CIVIL", "content": "هر مالکی نسبت به مایملک خود حق همه‌گونه تصرف و انتفاع دارد مگر در مواردی که قانون استثناء کرده باشد (قاعده تسلیط).", "refs": ["CIVIL-ART-10"]},
    {"id": "CIVIL-ART-35", "title": "ماده ۳۵ قانون مدنی", "cat": "CIVIL", "content": "تصرف به عنوان مالکیت دلیل مالکیت است مگر اینکه خلاف آن ثابت شود (قاعده ید).", "refs": ["CIVIL-ART-30"]},
    {"id": "CIVIL-ART-140", "title": "ماده ۱۴۰ قانون مدنی", "cat": "CIVIL", "content": "تملک حاصل می‌شود: ۱- به احیاء اراضی موات ۲- به وسیله عقود و تعهدات ۳- به وسیله اخذ به شفعه ۴- به ارث.", "refs": ["CIVIL-ART-10", "CIVIL-ART-219"]},
    {"id": "CIVIL-ART-264", "title": "ماده ۲۶۴ قانون مدنی", "cat": "CIVIL", "content": "تعهدات به یکی از طرق ذیل ساقط می‌شود: ۱- به وفای به عهد ۲- به اقاله ۳- به ابراء ۴- به تبدیل تعهد ۵- به تهاتر ۶- به مالکیت مافی‌الذمه.", "refs": ["CIVIL-ART-219"]},
    {"id": "CIVIL-ART-277", "title": "ماده ۲۷۷ قانون مدنی", "cat": "CIVIL", "content": "متعهد نمی‌تواند متعهدله را مجبور به قبول قسمتی از موضوع تعهد نماید ولی حاکم می‌تواند با توجه به وضعیت مدیون مهلت عادله یا قرار اقساط دهد (اعسار و تقسیط).", "refs": ["CIVIL-ART-264"]},
    {"id": "CIVIL-ART-289", "title": "ماده ۲۸۹ قانون مدنی", "cat": "CIVIL", "content": "ابراء عبارت از این است که دائن از حق خود به اختیار صرف‌نظر نماید.", "refs": ["CIVIL-ART-264"]},
    {"id": "CIVIL-ART-292", "title": "ماده ۲۹۲ قانون مدنی", "cat": "CIVIL", "content": "تبدیل تعهد در موارد ذیل حاصل می‌شود: ۱- وقتی که متعهد و متعهدله به تبدیل تعهد اصلی به تعهد جدیدی تراضی نمایند ۲- وقتی که متعهد جدیدی جایگزین متعهد سابق شود ۳- وقتی که متعهدله مافی‌الذمه را به شخص دیگری منتقل نماید.", "refs": ["CIVIL-ART-264"]},
    {"id": "CIVIL-ART-295", "title": "ماده ۲۹۵ قانون مدنی", "cat": "CIVIL", "content": "تهاتر قهری است و بدون اینکه طرفین تراضی نمایند حاصل می‌شود همین که دو نفر در مقابل یکدیگر تا مقدار مماثل مدیون باشند.", "refs": ["CIVIL-ART-264"]},
    {"id": "CIVIL-ART-457", "title": "ماده ۴۵۷ قانون مدنی", "cat": "CIVIL", "content": "هر بیع لازم است مگر اینکه یکی از خیارات در آن ثابت شود.", "refs": ["CIVIL-ART-219", "CIVIL-ART-399"]},
    {"id": "CIVIL-ART-474", "title": "ماده ۴۷۴ قانون مدنی", "cat": "CIVIL", "content": "مستاجر می‌تواند عین مستاجره را به دیگری اجاره دهد مگر اینکه در عقد اجاره خلاف آن شرط شده باشد.", "refs": ["CIVIL-ART-10", "CIVIL-ART-219"]},

    # ۲. قانون اجرای احکام مدنی و آیین دادرسی
    {"id": "EXEC-ART-1", "title": "ماده ۱ قانون اجرای احکام مدنی", "cat": "PROCEDURE", "content": "هیچ حکمی از احکام دادگاه‌های دادگستری به موقع اجرا گذارده نمی‌شود مگر اینکه قطعی شده یا قرار اجرای موقت آن صادر شده باشد.", "refs": ["PROC-ART-51"]},
    {"id": "EXEC-ART-4", "title": "ماده ۴ قانون اجرای احکام مدنی", "cat": "PROCEDURE", "content": "اجرای حکم با صدور اجرائیه به عمل می‌آید مگر اینکه در قانون ترتیب دیگری مقرر شده باشد.", "refs": ["EXEC-ART-1"]},
    {"id": "EXEC-ART-34", "title": "ماده ۳۴ قانون اجرای احکام مدنی", "cat": "PROCEDURE", "content": "همین که اجرائیه به محکوم‌علیه ابلاغ شد محکوم‌علیه مکلف است ظرف ده روز مفاد آن را به موقع اجرا بگذارد یا ترتیبی برای پرداخت محکوم‌به بدهد یا مالی معرفی کند.", "refs": ["EXEC-ART-4"]},
    {"id": "PROC-ART-198", "title": "ماده ۱۹۸ قانون آیین دادرسی مدنی", "cat": "PROCEDURE", "content": "در صورتی که حق یا دینی بر عهده کسی ثابت شد، اصل بر بقای آن است مگر اینکه خلاف آن ثابت شود (استصحاب).", "refs": ["CIVIL-ART-264"]},
    {"id": "PROC-ART-202", "title": "ماده ۲۰۲ قانون آیین دادرسی مدنی", "cat": "PROCEDURE", "content": "هر گاه کسی اقرار به امری نماید که دلیل حقانیت طرف است، دلیل دیگری برای ثبوت آن لازم نیست.", "refs": ["PROC-ART-198"]},
    {"id": "PROC-ART-522", "title": "ماده ۵۲۲ قانون آیین دادرسی مدنی", "cat": "PROCEDURE", "content": "در دعاویی که موضوع آن دین و از نوع وجه رایج بوده و با مطالبه داین و تمکن مدیون، مدیون از پرداخت امتناع نموده، دادگاه با رعایت تناسب تغییر شاخص سالانه بانک مرکزی خسارت تاخیر تادیه را محاسبه می‌نماید.", "refs": ["CIVIL-ART-221", "CIVIL-ART-230"]},

    # ۳. قانون مجازات اسلامی و جرایم مالی/رایانه‌ای
    {"id": "CRIM-ART-2", "title": "ماده ۲ قانون مجازات اسلامی", "cat": "CRIMINAL", "content": "هر رفتاری اعم از فعل یا ترک فعل که در قانون برای آن مجازات تعیین شده است جرم محسوب می‌شود (اصل قانونی بودن جرایم و مجازات‌ها).", "refs": []},
    {"id": "CRIM-ART-13", "title": "ماده ۱۳ قانون جرایم رایانه‌ای", "cat": "CRIMINAL", "content": "هر کس به طور غیرمجاز از سامانه‌های رایانه‌ای یا مخابراتی با ارتکاب اعمالی از قبیل وارد کردن، تغییر، محو، ایجاد یا متوقف کردن داده‌ها وجوه یا اموال یا امتیازات مالی را برای خود یا دیگری تحصیل کند کلاهبردار رایانه‌ای محسوب می‌شود.", "refs": ["CRIM-ART-2"]},
    {"id": "CRIM-ART-674", "title": "ماده ۶۷۴ قانون تعزیرات", "cat": "CRIMINAL", "content": "خیانت در امانت: هر گاه اموال منقول یا غیرمنقول به عنوان اجاره، امانت، رهن یا وکالت داده شده و بنا بر استرداد بوده و شخص آنها را تصاحب، تلف، مفقود یا استعمال کند به حبس محکوم می‌گردد.", "refs": ["CIVIL-ART-656", "CIVIL-ART-771"]},

    # ۴. حقوق تجارت، شرکت‌ها و ورشکستگی
    {"id": "COMM-ART-1", "title": "ماده ۱ قانون تجارت", "cat": "COMMERCIAL", "content": "تاجر کسی است که شغل معمولی خود را معاملات تجارتی قرار بدهد.", "refs": []},
    {"id": "COMM-ART-2", "title": "ماده ۲ قانون تجارت", "cat": "COMMERCIAL", "content": "معاملات تجارتی ذاتی: خرید یا تحصیل هر نوع مال منقول به قصد فروش یا اجاره، تصدی به حمل و نقل، تاسیس کارخانه، عملیات صرافی و بانکی، معاملات برواتی و کشتی‌رانی.", "refs": ["COMM-ART-1"]},
    {"id": "COMM-ART-412", "title": "ماده ۴۱۲ قانون تجارت", "cat": "COMMERCIAL", "content": "ورشکستگی تاجر یا شرکت تجارتی در نتیجه توقف از تادیه وجوهی که بر عهده اوست حاصل می‌شود.", "refs": ["COMM-ART-1", "COMM-ART-249"]},
    {"id": "COMM-ART-588", "title": "ماده ۵۸۸ قانون تجارت", "cat": "COMMERCIAL", "content": "شخص حقوقی می‌تواند دارای کلیه حقوق و تکالیفی شود که قانون برای افراد قائل است مگر حقوق و وظایفی که بالطبیعه فقط انسان ممکن است دارای آن باشد.", "refs": ["COMM-ART-1"]}
]

def run_mass_autonomous_corpus_ingestion():
    print("========================================================")
    print("⚡ RUNNING AUTONOMOUS BULK CORPUS HARVESTER & GRAPH LOADER")
    print("========================================================")

    nodes_count = 0
    edges_count = 0

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # مرحله ۱: درج نودها
            for item in FULL_LEGAL_BOOKS:
                keywords = [w for w in item["content"].split() if len(w) > 4][:5]
                cur.execute("""
                    INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE
                    SET content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata;
                """, (
                    item["id"],
                    "ARTICLE",
                    item["title"],
                    item["cat"],
                    item["content"],
                    json.dumps({"keywords": keywords}, ensure_ascii=False)
                ))
                nodes_count += 1

            # مرحله ۲: اتصال یال‌های ارجاعی
            for item in FULL_LEGAL_BOOKS:
                for target_id in item.get("refs", []):
                    cur.execute("SELECT 1 FROM graph_nodes WHERE node_id = %s;", (target_id,))
                    if cur.fetchone():
                        cur.execute("""
                            INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (source_node_id, target_node_id, relation_type) DO NOTHING;
                        """, (item["id"], target_id, "REFERENCES", 1.0, f"پیوند ارجاعی {item['id']} به {target_id}"))
                        edges_count += 1

            conn.commit()

            cur.execute("SELECT count(*) FROM graph_nodes;")
            total_db_nodes = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM graph_edges;")
            total_db_edges = cur.fetchone()[0]

    print("\n--------------------------------------------------------")
    print(f"✅ CORPUS EXPANSION COMPLETE: {total_db_nodes} Nodes & {total_db_edges} Graph Edges Live in System.")
    print("========================================================\n")

if __name__ == "__main__":
    run_mass_autonomous_corpus_ingestion()
