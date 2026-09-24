from __future__ import annotations

import psycopg
from src.roxira_config import postgres_dsn

DB_URL = postgres_dsn(host="127.0.0.1", port=5434)

def init_and_seed_legal_db():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # ایجاد جدول پایگاه قوانین و آرای وحدت رویه
            cur.execute("""
                CREATE TABLE IF NOT EXISTS legal_statutes (
                    id SERIAL PRIMARY KEY,
                    category VARCHAR(64) NOT NULL, -- CIVIL, CRIMINAL, DISCIPLINARY, COMMERCIAL, PRECEDENT
                    law_title VARCHAR(128) NOT NULL,
                    article_number VARCHAR(32) NOT NULL,
                    subject VARCHAR(256),
                    content TEXT NOT NULL,
                    jurisdiction VARCHAR(64) DEFAULT 'GENERAL',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(law_title, article_number)
                );
            """)

            # بارگذاری نمونه‌ای از مواد کلیدی و قواعد انتظامی
            seed_data = [
                # آیین دادرسی مدنی
                ("CIVIL", "قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی", "ماده ۵۱", "شرایط شکلی دادخواست", 
                 "دادخواست باید به زبان فارسی در روی برگ‌های چاپی مخصوص نوشته شده و حاوی نام، نام خانوادگی، اقامتگاه خواهان و خوانده، تعیین خواسته و بهای آن، جهات و دلایل استحقاق باشد."),
                ("CIVIL", "قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی", "ماده ۵۲", "ضمانت اجرای نقص دادخواست", 
                 "در صورتی که دادخواست فاقد شرایط مندرج در بندهای ماده ۵۱ باشد، مدیر دفتر دادگاه ظرف دو روز به خواهان اخطار رفع نقص می‌دهد."),
                # قانون مدنی
                ("CIVIL", "قانون مدنی", "ماده ۱۰", "اصل حاکمیت اراده و آزادی قراردادها", 
                 "قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد، نافذ است."),
                ("CIVIL", "قانون مدنی", "ماده ۲۳۰", "وجه التزام قراردادی", 
                 "اگر در ضمن معامله شرط شده باشد که در صورت تخلف، متخلف مبلغی به عنوان خسارت تادیه نماید، حاکم نمی‌تواند او را به بیشتر یا کمتر از آنچه شرط شده محکوم کند."),
                # قوانین انتظامی وکلا و قضات
                ("DISCIPLINARY", "لایحه قانونی استقلال کانون وکلای دادگستری", "ماده ۱۷", "تمرکز فعالیت و تخلفات انتظامی وکیل", 
                 "هیچ وکیلی را نمی‌توان از شغل وکالت معلق یا ممنوع نمود مگر به موجب حکم قطعی دادگاه انتظامی وکلا."),
                ("DISCIPLINARY", "قانون نظارت بر رفتار قضات", "ماده ۱۴", "تخلفات و مجازات‌های انتظامی قضات", 
                 "قضات دادگاه‌ها و دادسراها مکلفند در حدود صلاحیت قانونی به شکایات و دعاوی رسیدگی کنند؛ خودداری از رسیدگی یا تاخیر غیرموجه مستوجب مجازات انتظامی است."),
                # آرای وحدت رویه دیوان عالی کشور
                ("PRECEDENT", "رای وحدت رویه هیئت عمومی دیوان عالی کشور", "شماره ۸۱۱", "محاسبه خسارت ناشی از تورم و کاهش ارزش ثمن", 
                 "در صورت مستحق‌للغیر درآمدن مبیع و بطلان بیع، خریدار حق دارد خسارت ناشی از کاهش ارزش ثمن را بر مبنای تورم واقعی مطابق نظر کارشناس مطالبه نماید.")
            ]

            for cat, title, art, subj, content in seed_data:
                cur.execute("""
                    INSERT INTO legal_statutes (category, law_title, article_number, subject, content)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (law_title, article_number) DO UPDATE
                    SET subject = EXCLUDED.subject, content = EXCLUDED.content;
                """, (cat, title, art, subj, content))
            
            conn.commit()
    print("LEGAL_KNOWLEDGE_BASE_SEEDED=PASS")

if __name__ == "__main__":
    init_and_seed_legal_db()
