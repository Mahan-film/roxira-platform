from __future__ import annotations

import json
import pathlib
import sys
import psycopg
from typing import List, Dict, Any

CURRENT_DIR = pathlib.Path.cwd()
ROOT_DIRS = [CURRENT_DIR, pathlib.Path("/Users/mac/Developer/project-foundry-worktrees/fnd-ops-00"), pathlib.Path("/Users/mac/Developer/project-foundry")]
for r in ROOT_DIRS:
    if str(r) not in sys.path:
        sys.path.insert(0, str(r))
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

CORE_LEGAL_CORPUS = [
    {
        "law_title": "قانون مدنی",
        "category": "CIVIL",
        "articles": [
            {"art": "10", "text": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.", "refs": []},
            {"art": "190", "text": "برای صحت هر معامله شرایط ذیل اساسی است: ۱- قصد طرفین و رضای آنها ۲- اهلیت طرفین ۳- موضوع معین که مورد معامله باشد ۴- مشروعیت جهت معامله.", "refs": [("CIVIL", "10")]},
            {"art": "219", "text": "عقودی که بر طبق قانون واقع شده باشد بین متعاملین و قائم‌مقام آنها لازم‌الاتباع است مگر اینکه به رضای طرفین اقاله یا به علت قانونی فسخ شود.", "refs": [("CIVIL", "10"), ("CIVIL", "190")]},
            {"art": "220", "text": "عقود نه فقط متعاملین را به اجرای چیزی که در آن تصریح شده است ملزم می‌نماید بلکه متعاملین به کلیه نتایجی هم که به موجب عرف و عادت یا به موجب قانون از عقد حاصل می‌شود ملزم می‌باشند.", "refs": [("CIVIL", "219")]},
            {"art": "221", "text": "اگر کسی تعهد اقدام به امری را بکند یا تعهد نماید که از انجام امری خودداری کند در صورت تخلف مسئول خسارت طرف مقابل است مشروط بر اینکه جبران خسارت تصریح شده و یا تعهد عرفاً به منزله تصریح باشد و یا بر حسب قانون موجب ضمان باشد.", "refs": [("CIVIL", "219")]},
            {"art": "222", "text": "در صورت عدم ایفای تعهد با رعایت ماده ۲۲۱ حاکم می‌تواند به متعهدله اجازه دهد که خود او عمل را انجام دهد و متعهد را به تادیه مخارج آن محکوم نماید.", "refs": [("CIVIL", "221")]},
            {"art": "223", "text": "هر معامله که واقع شود محمول بر صحت است مگر اینکه فساد آن معلوم شود.", "refs": [("CIVIL", "190")]},
            {"art": "226", "text": "در مورد عدم ایفای تعهدات از طرف یکی از متعاملین طرف دیگر نمی‌تواند ادعای خسارت نماید مگر اینکه برای ایفای تعهد مدتی مقرر بوده و مدت مزبور منقضی شده باشد.", "refs": [("CIVIL", "221")]},
            {"art": "230", "text": "اگر در ضمن معامله شرط شده باشد که در صورت تخلف متخلف مبلغی به عنوان خسارت تادیه نماید حاکم نمی‌تواند او را به بیشتر یا کمتر از آنچه که ملزم شده است محکوم کند.", "refs": [("CIVIL", "221"), ("CIVIL", "226")]},
            {"art": "338", "text": "بیع عبارت است از تملیک عین به عوض معلوم.", "refs": [("CIVIL", "190"), ("CIVIL", "219")]},
            {"art": "362", "text": "آثار بیعی که صحیحاً واقع شده باشد از قرار ذیل است: ۱- مشتری مالک مبیع و بایع مالک ثمن می‌شود ۲- عقد بیع بایع را ضامن درک مبیع و مشتری را ضامن درک ثمن قرار می‌دهد ۳- عقد بیع بایع را به تسلیم مبیع ملزم می‌نماید ۴- عقد بیع مشتری را به تادیه ثمن ملزم می‌کند.", "refs": [("CIVIL", "338")]},
            {"art": "399", "text": "در عقد بیع ممکن است شرط شود که در مدت معین برای بایع یا مشتری یا هر دو یا شخص خارجی اختیار فسخ معامله باشد.", "refs": [("CIVIL", "219"), ("CIVIL", "362")]},
            {"art": "401", "text": "اگر برای خیار شرط مدت معین نشده باشد هم شرط خیار و هم بیع باطل است.", "refs": [("CIVIL", "399"), ("CIVIL", "190")]}
        ]
    },
    {
        "law_title": "قانون آیین دادرسی مدنی",
        "category": "PROCEDURE",
        "articles": [
            {"art": "51", "text": "دادخواست باید به زبان فارسی در روی برگ‌های چاپی مخصوص نوشته شده و حاوی مشخصات خواهان، خوانده، تعیین خواسته و ادله باشد.", "refs": []},
            {"art": "84", "text": "در موارد زیر خوانده می‌تواند ضمن پاسخ نسبت به ماهیت دعوا ایراد کند: ۱- دادگاه صلاحیت نداشته باشد ۲- دعوا بین همان اشخاص قبلاً اقامه شده باشد...", "refs": [("PROCEDURE", "51")]},
            {"art": "348", "text": "جهات تجدیدنظرخواهی: ادعای عدم اعتبار مستندات، فقدان شرایط شهود، عدم توجه به دلایل، عدم صلاحیت قاضی و مخالفت با موازین قانونی.", "refs": [("PROCEDURE", "51"), ("PROCEDURE", "84")]},
            {"art": "515", "text": "خواهان حق دارد ضمن تقدیم دادخواست یا در اثنای دادرسی جبران خسارات ناشی از دادرسی یا تاخیر ادای دین را مطالبه نماید.", "refs": [("PROCEDURE", "51"), ("CIVIL", "221"), ("CIVIL", "230")]}
        ]
    },
    {
        "law_title": "قانون صدور چک",
        "category": "COMMERCIAL",
        "articles": [
            {"art": "23", "text": "دارنده چک می‌تواند با ارائه گواهینامه عدم پرداخت از دادگاه صالح بدون نیاز به رسیدگی ماهوی، صدور اجرائیه را درخواست نماید.", "refs": [("PROCEDURE", "515"), ("CIVIL", "230")]}
        ]
    }
]

def run_mass_ingestion():
    print("========================================================")
    print("⚡ RUNNING MASS LEGAL CORPUS INGESTION (TWO-PASS PIPELINE)")
    print("========================================================")

    nodes_inserted = 0
    edges_inserted = 0
    all_refs_to_link = []

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # گام اول: درج تضمینی تمام نودها
            print("[*] PASS 1: Ingesting All Knowledge Graph Nodes...")
            for corpus in CORE_LEGAL_CORPUS:
                law_title = corpus["law_title"]
                cat = corpus["category"]
                
                for item in corpus["articles"]:
                    art_num = item["art"]
                    node_id = f"{cat}-ART-{art_num}"
                    content = f"ماده {art_num} - {item['text']}"
                    keywords = [w for w in item["text"].split() if len(w) > 4][:6]

                    cur.execute("""
                        INSERT INTO graph_nodes (node_id, node_type, title, category, content, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (node_id) DO UPDATE
                        SET content = EXCLUDED.content,
                            metadata = EXCLUDED.metadata;
                    """, (
                        node_id,
                        "ARTICLE",
                        f"ماده {art_num} {law_title}",
                        cat,
                        content,
                        json.dumps({"law_title": law_title, "keywords": keywords}, ensure_ascii=False)
                    ))
                    nodes_inserted += 1

                    for target_cat, target_art in item["refs"]:
                        all_refs_to_link.append((node_id, f"{target_cat}-ART-{target_art}", art_num, target_art))

            # گام دوم: اتصال ایمن یال‌های ارجاعی با بررسی موجود بودن نود مقصد
            print(f"[*] PASS 2: Linking {len(all_refs_to_link)} Directed Cross-References...")
            for src_id, tgt_id, src_art, tgt_art in all_refs_to_link:
                cur.execute("SELECT 1 FROM graph_nodes WHERE node_id = %s;", (tgt_id,))
                if cur.fetchone():
                    cur.execute("""
                        INSERT INTO graph_edges (source_node_id, target_node_id, relation_type, weight, description)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (source_node_id, target_node_id, relation_type) DO NOTHING;
                    """, (
                        src_id,
                        tgt_id,
                        "REFERENCES",
                        1.0,
                        f"ارجاع موضوعی ماده {src_art} به ماده {tgt_art}"
                    ))
                    edges_inserted += 1

            conn.commit()
            
            cur.execute("SELECT count(*) FROM graph_nodes;")
            total_db_nodes = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM graph_edges;")
            total_db_edges = cur.fetchone()[0]

    print("\n--------------------------------------------------------")
    print(f"✅ CORPUS INGESTION SUCCESS: {total_db_nodes} Nodes & {total_db_edges} Graph Edges Live.")
    print("========================================================\n")

if __name__ == "__main__":
    run_mass_ingestion()
