# Prompt 6: more SEO/GEO legal guides (batches 2–5)

Attach: `competitor_geo_report.md` (from `~/Downloads/gemini_out/`). It lists 50 real search questions in section 2.
Run once per batch, each batch in a new chat. Change only the batch number on the first line.

---

Batch number: 2

You write for «قاضی هوشمند» (ghazihoushmand.ir), a Persian legal-AI assistant for Iranian law. Use section 2 of the attached report («۵۰ پرسش حقوقی پرجستجو»).

These 10 topics are ALREADY published. Do not repeat them, even under another title:
appeal-deadline-civil-court, peace-court-jurisdiction-limits, mahr-110-coins-imprisonment-rule,
bounced-cheque-criminal-civil-steps, commercial-lease-eviction-sarghofli, limited-liability-company-registration,
vat-ecommerce-online-businesses, consumer-rights-ecommerce-law, traffic-accident-blood-money-third-party-insurance,
early-lease-termination-rules.

From the remaining 40 questions, take the 10 that belong to this batch:
- batch 2: questions 1–10 of the remaining list
- batch 3: questions 11–20
- batch 4: questions 21–30
- batch 5: questions 31–40

Before writing, print the list of 10 titles you chose so I can check it.

Use exactly the same format and rules as the previous guides:
- front matter: `title` (≤60 chars), `description` (≤155 chars), `slug` (Latin kebab-case), `keywords` (5–8 phrases people really type), `law_refs`, `updated: 1405-07-22`
- H1 = the question as people search it. Then a «پاسخ کوتاه» box (2–3 sentences)
- H2 sections, short paragraphs, numbered steps, and a table when useful
- «مستند قانونی»: every claim tied to a law + article. ONLY articles you are sure of; otherwise write «نیازمند بررسی»
- «پرسش‌های پرتکرار»: 4–6 Q&A
- the line «سؤال خودتان را از قاضی هوشمند بپرسید» linking to https://ghazihoushmand.ir/chat
- the line «این متن اطلاعات عمومی است و جایگزین مشاوره با وکیل نیست.»
- 900–1400 words

Strict: never invent amounts, deadlines, coin counts, fines or article numbers. If a figure changes yearly (blood money, monetary thresholds, minimum wage), write «مبلغ سالانه اعلام می‌شود (نیازمند بررسی)» instead of a number.

Give each guide as a separate downloadable `.md` file named `<slug>.md`. Do not paste them into the chat.
Save to `~/Downloads/gemini_out/seo_guides/`.
