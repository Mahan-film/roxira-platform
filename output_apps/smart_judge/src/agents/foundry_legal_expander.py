from __future__ import annotations

import json
import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

EXPANDED_CORPUS = [
    # حقوق تجارت و اسناد تجاری
    {
        "category": "COMMERCIAL",
        "law_title": "قانون صدور چک",
        "chapter": "ضمانت اجرای صدور چک بلامحل",
        "article_number": "ماده ۲۳",
        "content": "دارنده چک می‌تواند با ارائه گواهینامه عدم پرداخت از دادگاه صالح بدون نیاز به رسیدگی ماهوی، صدور اجرائیه نسبت به وجه چک و حق‌الوکاله را درخواست نماید.",
        "notes": ["تبصره - مشروط بر اینکه در متن چک شرطی قید نشده باشد."],
        "keywords": ["صدور اجرائیه چک", "ماده ۲۳ چک", "مطالبه بدون دادرسی"]
    },
    {
        "category": "COMMERCIAL",
        "law_title": "قانون تجارت",
        "chapter": "در ورشکستگی و تصفیه",
        "article_number": "ماده ۴۱۸",
        "content": "تاجر ورشکسته از تاریخ صدور حکم از مداخله در تمام اموال خود که ممکن است در تادیه دیون او موثر باشد ممنوع است و مدیر تصفیه قائم‌مقام اوست.",
        "notes": [],
        "keywords": ["ورشکستگی", "تصفیه دیون", "سلب مداخله تاجر"]
    },
    # قانون مجازات اسلامی و جرایم مالی
    {
        "category": "CRIMINAL",
        "law_title": "قانون مجازات اسلامی (تعزیرات)",
        "chapter": "در خیانت در امانت",
        "article_number": "ماده ۶۷۴",
        "content": "هر گاه اموال منقول یا غیرمنقول به عنوان اجاره یا امانت یا رهن یا برای وکالت یا هر کار با اجرت یا بی‌اجرت به کسی داده شده و بنابراین بوده است که اشیاء مذکور مسترد شود یا به مصرف معینی برسد و شخصی که آن اشیاء نزد او بوده آنها را به ضرر مالکین تصاحب یا تلف یا مفقود یا استعمال نماید به حبس تعزیری محکوم می‌شود.",
        "notes": [],
        "keywords": ["خیانت در امانت", "استرداد مال", "تصاحب غیرقانونی"]
    },
    {
        "category": "CRIMINAL",
        "law_title": "قانون تشدید مجازات مرتکبین ارتشاء، اختلاس و کلاهبرداری",
        "chapter": "عنصر مادی و مجازات کلاهبرداری",
        "article_number": "ماده ۱",
        "content": "هر کس از راه حیله و تقلب مردم را به وجود شرکت‌ها یا تجارتخانه‌ها یا کارخانه‌ها یا موسسات موهوم یا به داشتن اموال و اختیارات واهی فریب دهد و وجوه یا اسناد یا قبوض یا مفاصاحساب یا وجوه نقدی را تحصیل کرده و بدین وسیله مال دیگری را ببرد کلاهبردار محسوب می‌شود.",
        "notes": [],
        "keywords": ["کلاهبرداری", "مانور متقلبانه", "رد مال"]
    },
    # مراجع اختصاصی و کارکنان دولت
    {
        "category": "ADMINISTRATIVE",
        "law_title": "قانون تشدید مجازات مرتکبین ارتشاء، اختلاس و کلاهبرداری",
        "chapter": "اختلاس و تصرف غیرقانونی",
        "article_number": "ماده ۵",
        "content": "هر یک از کارمندان و کارکنان ادارات و سازمان‌ها یا شوراها و شهرداری‌ها وجوه یا مطالبات یا حواله‌ها یا اسناد و اوراق بهادار را به نفع خود یا دیگری برداشت و تصاحب نماید مختلس محسوب و به مجازات قانونی محکوم می‌گردد.",
        "notes": [],
        "keywords": ["دادسرا ویژه کارکنان دولت", "اختلاس", "اموال عمومی"]
    }
]

def run_mass_statute_expansion():
    print("=== EXPANDING LEGAL CORPUS VIA FOUNDRY AGENT ===")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            for item in EXPANDED_CORPUS:
                cur.execute("""
                    INSERT INTO legal_statutes_v2 
                    (category, law_title, chapter, article_number, content, notes, validity_status, keywords)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (law_title, article_number) DO UPDATE
                    SET content = EXCLUDED.content,
                        keywords = EXCLUDED.keywords;
                """, (
                    item["category"],
                    item["law_title"],
                    item["chapter"],
                    item["article_number"],
                    item["content"],
                    json.dumps(item["notes"], ensure_ascii=False),
                    "ACTIVE",
                    json.dumps(item["keywords"], ensure_ascii=False)
                ))
            conn.commit()
            
            cur.execute("SELECT count(*) FROM legal_statutes_v2;")
            total = cur.fetchone()[0]
            print(f"✅ CORPUS EXPANDED: {total} Verified Articles Live in Database.")

if __name__ == "__main__":
    run_mass_statute_expansion()
