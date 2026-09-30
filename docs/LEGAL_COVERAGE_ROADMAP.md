# Legal coverage audit and roadmap (2026-09-30)

Question from the owner: is Smart Judge complete across all Iranian courts, laws, regulations, cabinet
decrees, circulars, advisory opinions and precedents? **Answer: no.** This document records the measured
state and the plan to close the gap. Architect: Opus/Sonnet hub. Execution: cheap-model lanes (see STRATEGY.md "Role rule").

## 1. Measured state (verified against the repo and prod on 2026-09-30)

| Layer | What exists | Size |
| --- | --- | --- |
| Vector corpus `iran_laws_v2` (prod, used for answering) | 8 laws (1 is a *bill*, see risk R1) | 4,243 points (4,216 articles in `data/legal/dotic_articles_2026-09-22.jsonl`) |
| Old collection `iran_laws_bge_m3` (still used by the citation guard) | mostly synthetic range summaries | 1,308 points, 1,305 placeholders |
| Local citation catalog `LEGAL_CATALOG` | 6 laws | small |
| Precedents `PRECEDENT_CATALOG` | a handful of وحدت رویه entries | tiny |
| Judiciary circulars, advisory opinions, cabinet decrees, ministry instructions | **none ingested** | 0 |

Laws in `iran_laws_v2` (articles): قانون مدنی 1334; قانون مجازات اسلامی 735; قانون آیین دادرسی کیفری 706;
قانون تجارت 529; قانون آیین دادرسی مدنی 529; لایحه اصلاحی قانون تجارت 301; قانون شوراهای حل اختلاف و دادگاه‌های صلح ۱۴۰۲ 46;
قانون صدور چک 36. Sources: DOTIC snapshot via HF (3,605) and owner-supplied files (611).

Measured quality: citation accuracy 63.3% on the 30-question public eval (docs/W6_legal_corpus_diagnosis.md §8).
Live check 2026-09-30: asking for «ماده ۱۰ قانون مدنی» returned article 1010 (no exact article lookup).

## 2. Gap versus the owner's list

| Area requested | State |
| --- | --- |
| Judges' disciplinary courts (دادگاه عالی انتظامی قضات) and their regulations | not in corpus |
| Lawyers' disciplinary prosecutor/court (دادسرا و دادگاه انتظامی وکلا, لایحه استقلال کانون وکلا and آیین‌نامه) | not in corpus |
| Prosecution stage (دادیار, بازپرس) | only what is inside آیین دادرسی کیفری |
| Criminal courts 1/2, appeal, enforcement of criminal sentences | procedure code only; no تشکیل دادگاه‌ها law, no enforcement regulations |
| Civil: jurisdiction thresholds, peace courts, public courts, appeal, enforcement | peace-court law 1402 + آیین دادرسی مدنی only; no قانون اجرای احکام مدنی, no نحوه اجرای محکومیت‌های مالی |
| Cabinet decrees (مصوبات هیئت وزیران), Ministry of Industry/Trade instructions, new tax laws | none |
| Judiciary circulars (بخشنامه), advisory opinions (نظریات مشورتی), court rulings (رویه) | none |

## 3. Risks found

- **R1 (legal accuracy):** `لایحه اصلاحی قانون تجارت` (301 articles) may be a *bill*, not an enacted law, yet it is stored as active.
  A lawyer must confirm; until then it must not be cited as in force.
- **R2:** citation guard verifies against the old, mostly synthetic collection (issue #117).
- **R3:** marketing copy on /services claims "complete" capabilities; it must be aligned with the measured coverage
  (add a public coverage page, see W25-3).
- **R4:** jurisdiction thresholds (e.g. peace-court monetary limits) change by law; they must be data-driven and lawyer-reviewed,
  never hard-coded by a model.
- No output of this system is legal advice until reviewed by a licensed Iranian lawyer (disclaimer must stay visible).

## 4. Roadmap (phases; each item = GitHub issue, executed by cheap lanes, reviewed by the hub)

**Phase 0 — honesty and safety (days):** W25-1 exact article lookup («ماده N قانون X» resolved by payload filter before vector search);
W25-2 coverage manifest script; W25-3 public coverage page; lawyer check of R1; #117 configurable guard collection.

**Phase 1 — procedure and jurisdiction backbone (first ingest wave):** قانون تشکیل دادگاه‌های عمومی و انقلاب and amendments;
قانون اجرای احکام مدنی; قانون نحوه اجرای محکومیت‌های مالی; قانون کاهش مجازات حبس تعزیری; قانون شوراهای حل اختلاف (already);
قانون مسئولیت مدنی; قانون ثبت اسناد؛ قانون روابط موجر و مستأجر (۱۳۷۶ and ۱۳۵۶); قانون حمایت خانواده; قانون کار and تأمین اجتماعی.

**Phase 2 — disciplinary and professional:** لایحه استقلال کانون وکلا + آیین‌نامه, regulations on disciplinary prosecution/court of lawyers,
قانون نظارت بر رفتار قضات + آیین‌نامه دادگاه عالی انتظامی قضات, قانون رسیدگی به تخلفات اداری.

**Phase 3 — economic and tax:** قانون مالیات‌های مستقیم (updated), ارزش افزوده, تجارت الکترونیکی, مبارزه با پولشویی and قاچاق, جرایم رایانه‌ای,
بیمه; then cabinet decrees and ministry instructions relevant to commerce.

**Phase 4 — secondary sources (highest value for practising lawyers, hardest to get):** آرای وحدت رویه (Supreme Court and
Administrative Justice Court), judiciary circulars, advisory opinions of the Judiciary legal department, selected court rulings.
Each item needs: source URL, date, status/in-force flag, amendment chain.

Acquisition rule: the production server cannot reach the official portals reliably (docs/W6 §4b); downloads run on the owner's Mac into
`data/raw/` (git-ignored), converted by the existing ingest pipeline (`scripts/w6_ingest_dotic.py`) to JSONL with the schema
`law_id, law_name, law_type, article_no, article_label, chapter, amended_on, approval_date, status, is_active, source_url, source`.
Candidate official sources to verify before use: DOTIC (President's Office legal codification), Parliament Research Center, Official Gazette,
Judiciary legal portals. Respect each site's terms of use.

**Quality gates per wave:** 30+ eval questions per new area written from the law text by a lawyer; citation accuracy must not regress;
`is_active` and amendment dates mandatory; nothing goes to production without an explicit owner approval.
