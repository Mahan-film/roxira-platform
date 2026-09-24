from __future__ import annotations

import json
import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

NODES_DATA = [
    # قانون مدنی - تعهدات و قراردادها
    {
        "node_id": "CIVIL-ART-10",
        "node_type": "ARTICLE",
        "title": "ماده ۱۰ قانون مدنی",
        "category": "CIVIL",
        "content": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.",
        "metadata": {"keywords": ["آزادی قراردادها", "اصل حاکمیت اراده", "اعتبار قرارداد"]}
    },
    {
        "node_id": "CIVIL-ART-219",
        "node_type": "ARTICLE",
        "title": "ماده ۲۱۹ قانون مدنی",
        "category": "CIVIL",
        "content": "عقودی که بر طبق قانون واقع شده باشد بین متعاملین و قائم‌مقام آنها لازم‌الاتباع است مگر اینکه به رضای طرفین اقاله یا به علت قانونی فسخ شود.",
        "metadata": {"keywords": ["لزوم قرارداد", "اصل لزوم", "اقاله", "فسخ"]}
    },
    {
        "node_id": "CIVIL-ART-221",
        "node_type": "ARTICLE",
        "title": "ماده ۲۲۱ قانون مدنی",
        "category": "CIVIL",
        "content": "اگر کسی تعهد اقدام به امری را بکند یا تعهد نماید که از انجام امری خودداری کند در صورت تخلف مسئول خسارت طرف مقابل است.",
        "metadata": {"keywords": ["مسئولیت قراردادی", "خسارت عدم انجام تعهد"]}
    },
    {
        "node_id": "CIVIL-ART-230",
        "node_type": "ARTICLE",
        "title": "ماده ۲۳۰ قانون مدنی",
        "category": "ARTICLE",
        "content": "اگر در ضمن معامله شرط شده باشد که در صورت تخلف متخلف مبلغی به عنوان خسارت تادیه نماید حاکم نمی‌تواند او را به بیشتر یا کمتر از آنچه که ملزم شده است محکوم کند.",
        "metadata": {"keywords": ["وجه التزام", "خسارت مقطوع قراردادی", "تعدیل‌ناپذیری"]}
    },
    {
        "node_id": "CIVIL-ART-399",
        "node_type": "ARTICLE",
        "title": "ماده ۳۹۹ قانون مدنی",
        "category": "CIVIL",
        "content": "در عقد بیع ممکن است شرط شود که در مدت معین برای بایع یا مشتری یا هر دو یا شخص خارجی اختیار فسخ معامله باشد.",
        "metadata": {"keywords": ["خیار شرط", "فسخ بیع", "مهلت فسخ"]}
    },
    {
        "node_id": "CIVIL-ART-401",
        "node_type": "ARTICLE",
        "title": "ماده ۴۰۱ قانون مدنی",
        "category": "ARTICLE",
        "content": "اگر برای خیار شرط مدت معین نشده باشد هم شرط خیار و هم بیع باطل است.",
        "metadata": {"keywords": ["بطلان عقد", "بطلان شرط", "خیار شرط مجهول"]}
    },

    # آیین دادرسی مدنی
    {
        "node_id": "PROC-ART-51",
        "node_type": "ARTICLE",
        "title": "ماده ۵۱ قانون آیین دادرسی مدنی",
        "category": "PROCEDURE",
        "content": "دادخواست باید به زبان فارسی در روی برگ‌های چاپی مخصوص نوشته شده و حاوی مشخصات خواهان، خوانده، تعیین خواسته و بهای آن، و ادله اثبات دعوا باشد.",
        "metadata": {"keywords": ["شرایط دادخواست", "مستندات قانونی", "بهای خواسته"]}
    },
    {
        "node_id": "PROC-ART-348",
        "node_type": "ARTICLE",
        "title": "ماده ۳۴۸ قانون آیین دادرسی مدنی",
        "category": "PROCEDURE",
        "content": "جهات تجدیدنظرخواهی: ادعای عدم اعتبار مستندات دادگاه، ادعای فقدان شرایط قانونی شهادت شهود، عدم توجه قاضی به دلایل ابرازی، عدم صلاحیت قاضی یا دادگاه، و مخالفت رای با موازین شرعی و مقررات قانونی.",
        "metadata": {"keywords": ["جهات تجدیدنظر", "اعتراض به دادنامه", "مهلت ۲۰ روزه"]}
    },

    # قانون صدور چک و اسناد تجاری
    {
        "node_id": "CHECK-ART-23",
        "node_type": "ARTICLE",
        "title": "ماده ۲۳ قانون اصلاح قانون صدور چک",
        "category": "COMMERCIAL",
        "content": "دارنده چک می‌تواند با ارائه گواهینامه عدم پرداخت از دادگاه صالح بدون نیاز به رسیدگی ماهوی، صدور اجرائیه نسبت به وجه چک و حق‌الوکاله را درخواست نماید.",
        "metadata": {"keywords": ["اجرائیه مستقیم چک", "گواهی عدم پرداخت", "چک صیادی"]}
    },

    # آرای وحدت رویه هیات عمومی دیوان عالی کشور
    {
        "node_id": "PRECEDENT-805",
        "node_type": "PRECEDENT",
        "title": "رای وحدت رویه شماره ۸۰۵ دیوان عالی کشور",
        "category": "CIVIL",
        "content": "تعیین وجه التزام قراردادی به عنوان خسارت تاخیر تادیه، حتی بیش از نرخ تورم اعلامی بانک مرکزی، نافذ و معتبر است و دادگاه ملزم به صدور حکم بر اساس همان مبلغ توافق‌شده می‌باشد.",
        "metadata": {"year": "1399", "subject": "اعتبار وجه التزام مازاد بر تورم"}
    },
    {
        "node_id": "PRECEDENT-811",
        "node_type": "PRECEDENT",
        "title": "رای وحدت رویه شماره ۸۱۱ دیوان عالی کشور",
        "category": "CIVIL",
        "content": "در صورت مستحق‌للغیر درآمدن مبیع و بطلان بیع، بایع باید خسارت ناشی از کاهش ارزش ثمن را بر اساس نرخ تورم به مشتری مسترد نماید.",
        "metadata": {"year": "1400", "subject": "رد ثمن به نرخ روز در بیع باطل"}
    }
]

EDGES_DATA = [
    # ارتباط اصل لزوم با ماده ۱۰
    ("CIVIL-ART-219", "CIVIL-ART-10", "REFERENCES", 1.0, "اصل لزوم مبتنی بر اصل صحت و نفوذ قراردادهاست"),
    
    # ارتباط خسارت عدم انجام تعهد با وجه التزام
    ("CIVIL-ART-230", "CIVIL-ART-221", "MODIFIES", 1.0, "ماده ۲۳۰ خسارت مقطوع را جایگزین ارزیابی کارشناسی ماده ۲۲۱ می‌کند"),
    
    # حکومت رای وحدت رویه ۸۰۵ بر ماده ۲۳۰
    ("PRECEDENT-805", "CIVIL-ART-230", "GOVERNED_BY_PRECEDENT", 1.0, "رای ۸۰۵ تایید می‌کند وجه التزام مشمول محدودیت‌های ربا و تورم نیست"),
    
    # بطلان عقد در صورت مجهول بودن مدت خیار شرط
    ("CIVIL-ART-401", "CIVIL-ART-399", "EXCEPTED_BY", 1.0, "عدم تعیین مدت در ماده ۳۹۹ موجب بطلان قطعی به استناد ماده ۴۰۱ می‌شود"),
    
    # ارتباط دادخواست بدوی با تجدیدنظرخواهی
    ("PROC-ART-348", "PROC-ART-51", "REFERENCES", 0.9, "نقایص دادخواست و عدم توجه به ادله مندرج در ماده ۵۱ از جهات ماده ۳۴۸ است"),
    
    # ضمانت اجرای خسارت در چک
    ("CHECK-ART-23", "CIVIL-ART-230", "REFERENCES", 0.8, "مطالبه خسارت قراردادی چک علاوه بر اصل وجه")
]

def seed_graph():
    print("=== SEEDING GRAPH KNOWLEDGE BASE ===")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # درج نودها
            for node in NODES_DATA:
                cur.execute("""
                    INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE
                    SET content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata;
                """, (
                    node["node_id"],
                    node["node_type"],
                    node["title"],
                    node["category"],
                    node["content"],
                    json.dumps(node["metadata"], ensure_ascii=False)
                ))
            
            # درج یال‌ها
            for src, tgt, rel, weight, desc in EDGES_DATA:
                cur.execute("""
                    INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (source_node_id, target_node_id, relation_type) DO UPDATE
                    SET weight = EXCLUDED.weight,
                        description = EXCLUDED.description;
                """, (src, tgt, rel, weight, desc))

            conn.commit()
            
            cur.execute("SELECT count(*) FROM graph_nodes;")
            nodes_cnt = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM graph_edges;")
            edges_cnt = cur.fetchone()[0]

    print(f"✅ GRAPH_KNOWLEDGE_SEEDED: {nodes_cnt} Nodes & {edges_cnt} Directed Edges Active.")

if __name__ == "__main__":
    seed_graph()
