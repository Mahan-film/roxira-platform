# Prompt 3 — SEO / GEO legal guides for «قاضی هوشمند»

No attachments needed. Run it several times with a different batch of topics each time.

---

You write for «قاضی هوشمند» (ghazihoushmand.ir), a Persian legal-AI assistant for Iranian law. Goal: rank in Google for real Persian legal searches AND be quoted by AI answer engines (ChatGPT, Perplexity, Gemini). Write in clear, standard Persian for ordinary people, not lawyers.

Topics for this batch (one guide each):
1. مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی
2. صلاحیت دادگاه صلح و شورای حل اختلاف (نصاب مالی)
3. مهریه و حبس: قاعده ۱۱۰ سکه
4. چک برگشتی: مراحل شکایت کیفری و حقوقی
5. تخلیه ملک تجاری و سرقفلی در قوانین موجر و مستأجر (۱۳۵۶، ۱۳۷۶)
6. ثبت شرکت با مسئولیت محدود: شرایط و مدارک
7. مالیات بر ارزش افزوده برای کسب‌وکارهای آنلاین
8. حقوق مصرف‌کننده در خرید اینترنتی (قانون تجارت الکترونیکی)
9. دیه تصادف و بیمه شخص ثالث
10. فسخ قرارداد اجاره پیش از پایان مدت

For EACH topic output a separate Markdown document with:
- front matter: `title` (≤60 chars, contains the main search phrase), `description` (≤155 chars), `slug` (Latin, kebab-case), `keywords` (5–8 Persian search phrases people actually type), `law_refs` (list of "قانون … ماده N" you rely on), `updated: 1405-07-22`
- H1 = the main question as people search it
- «پاسخ کوتاه» box: 2–3 sentences that directly answer the question (this is what AI engines quote)
- body with H2 sections, short paragraphs, a numbered step list where relevant, and a small table if useful
- «مستند قانونی»: each claim tied to a specific law + article. ONLY cite articles you are sure exist; if unsure write «نیازمند بررسی» instead of a number
- «پرسش‌های پرتکرار»: 4–6 Q&A pairs
- closing line with a call to action: «سؤال خودتان را از قاضی هوشمند بپرسید» linking to https://ghazihoushmand.ir/chat
- a disclaimer line: «این متن اطلاعات عمومی است و جایگزین مشاوره با وکیل نیست.»

Rules: no invented numbers, amounts, deadlines or article numbers. If a figure may have changed recently (e.g. monetary thresholds, mahr coin rules), say «طبق آخرین اصلاحیه … (نیازمند بررسی تاریخ)» rather than guessing. 900–1400 words per guide.

Save each as `~/Downloads/gemini_out/seo_guides/<slug>.md`.
