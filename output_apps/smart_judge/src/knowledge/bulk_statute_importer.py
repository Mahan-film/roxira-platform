from __future__ import annotations

import json
import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def upgrade_statutes_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS legal_statutes_v2 (
                    id SERIAL PRIMARY KEY,
                    category VARCHAR(64) NOT NULL, -- CIVIL, CRIMINAL, COMMERCIAL, DISCIPLINARY, ADMINISTRATIVE
                    law_title VARCHAR(128) NOT NULL,
                    chapter VARCHAR(128),
                    article_number VARCHAR(32) NOT NULL,
                    content TEXT NOT NULL,
                    notes JSONB DEFAULT '[]'::jsonb,
                    validity_status VARCHAR(16) DEFAULT 'ACTIVE', -- ACTIVE, REPEALED, AMENDED
                    keywords JSONB DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(law_title, article_number)
                );
                CREATE INDEX IF NOT EXISTS idx_statutes_category ON legal_statutes_v2(category);
                CREATE INDEX IF NOT EXISTS idx_statutes_law ON legal_statutes_v2(law_title);
            """)
            conn.commit()
    print("LEGAL_V2_SCHEMA_UPGRADED=PASS")

def seed_comprehensive_iranian_codes():
    statutes_corpus = [
        # --- قانون آیین دادرسی مدنی ---
        {
            "category": "CIVIL_PROCEDURE",
            "law_title": "قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی",
            "chapter": "باب اول - در صلاحیت دادگاه‌ها",
            "article_number": "ماده ۱۰",
            "content": "رسیدگی نخستین به دعاوی حسب مورد در صلاحیت دادگاه‌های عمومی و انقلاب است مگر در مواردی که قانون مرجع دیگری را تعیین کرده باشد.",
            "notes": [],
            "keywords": ["صلاحیت", "دادگاه عمومی", "رسیدگی نخستین"]
        },
        {
            "category": "CIVIL_PROCEDURE",
            "law_title": "قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی",
            "chapter": "باب دوم - وکالت در دعاوی",
            "article_number": "ماده ۳۵",
            "content": "وکالت در دادگاه‌ها شامل تمام اختیارات راجع به امر دادرسی است جز آنچه را که موکل استثناء کرده باشد، یا توکیل در آن خلاف شرع باشد؛ لیکن در اموری مانند وکالت در مصالحه و سازش، ادعای جعل، تعیین جاعل، ارجاع دعوا به داوری و وکالت در توکیل باید به صراحت در وکالت‌نامه قید شود.",
            "notes": [],
            "keywords": ["وکالت در دعاوی", "اختیارات وکیل", "مصالحه", "داوری"]
        },
        {
            "category": "CIVIL_PROCEDURE",
            "law_title": "قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی",
            "chapter": "باب سوم - دادخواست و شرایط آن",
            "article_number": "ماده ۵۱",
            "content": "دادخواست باید به زبان فارسی در روی برگ‌های چاپی مخصوص نوشته شده و حاوی نام، نام خانوادگی، نام پدر، سن، اقامتگاه و شغل خواهان، خوانده، وکیل، تعیین خواسته و بهای آن، تعهدات و جهات استحقاق و ادله اثبات دعوا باشد.",
            "notes": ["تبصره ۱ - اقامتگاه باید با تمام جزئیات قید گردد."],
            "keywords": ["شرایط شکلی دادخواست", "تقویم خواسته", "جهات استحقاق"]
        },
        # --- قانون مدنی ---
        {
            "category": "CIVIL",
            "law_title": "قانون مدنی",
            "chapter": "قواعد عمومی قراردادها",
            "article_number": "ماده ۱۰",
            "content": "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.",
            "notes": [],
            "keywords": ["اصل آزادی قراردادها", "نفوذ عقد", "حاکمیت اراده"]
        },
        {
            "category": "CIVIL",
            "law_title": "قانون مدنی",
            "chapter": "در خسارات ناشی از عدم اجرای تعهدات",
            "article_number": "ماده ۲۲۱",
            "content": "اگر کسی تعهد اقدام به امری را بکند یا تعهد نماید که از انجام امری خودداری کند، در صورت تخلف، مسئول خسارت طرف مقابل است مشروط بر این که جبران خسارت تصریح شده و یا تعهد عرفاً به منزله تصریح باشد یا بر حسب قانون موجب ضمان باشد.",
            "notes": [],
            "keywords": ["مسئولیت قراردادی", "جبران خسارت", "تخلف از تعهد"]
        },
        {
            "category": "CIVIL",
            "law_title": "قانون مدنی",
            "chapter": "در خسارات ناشی از عدم اجرای تعهدات",
            "article_number": "ماده ۲۳۰",
            "content": "اگر در ضمن معامله شرط شده باشد که در صورت تخلف، متخلف مبلغی به عنوان خسارت تادیه نماید، حاکم نمی‌تواند او را به بیشتر یا کمتر از آنچه شرط شده محکوم کند.",
            "notes": [],
            "keywords": ["وجه التزام", "خسارت عدم انجام تعهد", "تعدیل‌ناپذیری شرط"]
        },
        # --- قانون تجارت ---
        {
            "category": "COMMERCIAL",
            "law_title": "قانون تجارت",
            "chapter": "در اسناد تجاری - برات و سفته و چک",
            "article_number": "ماده ۳۱۰",
            "content": "چک نوشته‌ای است که به موجب آن صادرکننده وجوهی را که نزد محال‌علیه دارد کلاً یا بعضاً مسترد یا به دیگری واگذار می‌نماید.",
            "notes": [],
            "keywords": ["چک", "اسناد تجاری", "استرداد وجه"]
        },
        {
            "category": "COMMERCIAL",
            "law_title": "قانون تجارت",
            "chapter": "مسئولیت تضامنی در اسناد تجارتی",
            "article_number": "ماده ۲۴۹",
            "content": "برات‌دهنده، قبول‌کننده برات و ظهرنویس‌ها در مقابل دارنده برات مسئولیت تضامنی دارند. دارنده برات در صورت عدم تادیه و اعتراض می‌تواند به هر کدام از آنها که بخواهد منفرداً یا به چند نفر یا به تمام آنها مجتمعاً رجوع نماید.",
            "notes": [],
            "keywords": ["مسئولیت تضامنی", "ظهرنویسی", "مطالبه وجه سند تجاری"]
        },
        # --- دادگاه‌ها و مراجع اختصاصی و انتظامی ---
        {
            "category": "DISCIPLINARY",
            "law_title": "قانون نظارت بر رفتار قضات",
            "chapter": "تخلفات و مجازات‌های انتظامی قضات",
            "article_number": "ماده ۱۴",
            "content": "مرتکبان هر یک از تخلفات ذیل با توجه به اهمیت و شرایط جرم به یکی از مجازات‌های انتظامی درجه یک تا چهار محکوم می‌شوند: ۱- درج نکردن مشخصات خود یا امضاء نکردن دادنامه‌ها، ۲- بی‌نظمی در تشکیل جلسات دادگاه، ۳- غیبت غیرموجه، ۴- تاخیر غیرموجه در صدور و ابلاغ رای.",
            "notes": [],
            "keywords": ["دادگاه انتظامی قضات", "تخلفات انتظامی", "تاخیر در صدور رای"]
        },
        {
            "category": "DISCIPLINARY",
            "law_title": "لایحه قانونی استقلال کانون وکلای دادگستری",
            "chapter": "دادسرا و دادگاه انتظامی وکلا",
            "article_number": "ماده ۱۷",
            "content": "هیچ وکیلی را نمی‌توان از شغل وکالت معلق یا ممنوع نمود مگر به موجب حکم قطعی دادگاه انتظامی وکلا.",
            "notes": [],
            "keywords": ["دادگاه انتظامی وکلا", "تعلیق وکیل", "مصونیت شغلی وکیل"]
        },
        {
            "category": "ADMINISTRATIVE",
            "law_title": "قانون دیوان عدالت اداری",
            "chapter": "صلاحیت و اختیارات دیوان",
            "article_number": "ماده ۱۰",
            "content": "صلاحیت و حدود اختیارات دیوان عدالت اداری عبارت است از: ۱- رسیدگی به شکایات و تظلمات و اعتراضات اشخاص حقیقی یا حقوقی از تصمیمات و اقدامات واحدهای دولتی، شهرداری‌ها و سازمان‌های وابسته.",
            "notes": [],
            "keywords": ["دیوان عدالت اداری", "ابطال تصمیم دولتی", "شکایت از شهرداری"]
        }
    ]

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            for s in statutes_corpus:
                cur.execute("""
                    INSERT INTO legal_statutes_v2 
                    (category, law_title, chapter, article_number, content, notes, validity_status, keywords)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (law_title, article_number) DO UPDATE
                    SET content = EXCLUDED.content,
                        chapter = EXCLUDED.chapter,
                        notes = EXCLUDED.notes,
                        keywords = EXCLUDED.keywords;
                """, (
                    s["category"],
                    s["law_title"],
                    s["chapter"],
                    s["article_number"],
                    s["content"],
                    json.dumps(s["notes"], ensure_ascii=False),
                    "ACTIVE",
                    json.dumps(s["keywords"], ensure_ascii=False)
                ))
            conn.commit()
    print(f"SEEDED {len(statutes_corpus)} DETAILED STATUTES ACROSS 5 CATEGORIES=PASS")

if __name__ == "__main__":
    upgrade_statutes_schema()
    seed_comprehensive_iranian_codes()
