# Smart Judge legal coverage plan, with nezamat.ir as a new source (2026-10-13)

Owner goal: the system covers all VALID Iranian laws, cabinet resolutions (مصوبات هیئت وزیران), circulars (بخشنامه‌ها)
and licensing/business rules, and every answer is cited. Legal sources approved by the owner: **ekhtebar.ir, nezamat.ir,
qavanin.ir**. All three are unofficial; every row stays `source_tier: unofficial`, `needs_review: true`, allowlist
status `proposed` until a lawyer signs off (`docs/legal/LAWYER_REVIEW_GATE_FA.md`). Nothing here writes to Qdrant or the DB.

Evidence base: live reads of nezamat.ir on 2026-10-13 from the Mac (about 330 requests in total, 1 per 2 s, robots.txt
honoured) plus the repo files named below. Numbers marked "measured" come from those reads.

## 1. Current coverage (measured from the repo)

| Domain | What is in the corpus | Articles (rows) |
|---|---|---:|
| Constitution | قانون اساسی (wikisource, staged 10-11) | 177 |
| Civil / property | قانون مدنی 1334; ثبت اسناد و املاک 144; مسئولیت مدنی 16; موجر و مستأجر 1362 (15), 1376 (13, replaced by the 1403 text), 1356 (32, staged) | 1554 |
| Civil procedure, enforcement | آیین دادرسی مدنی 529 (+527 courts-procedure variant); اجرای احکام مدنی 180; نحوه اجرای محکومیت‌های مالی 29; تشکیل دادگاه‌های عمومی و انقلاب 38+12; شوراهای حل اختلاف 46 (+41) | ~1400 |
| Criminal | مجازات اسلامی 735; تعزیرات (کتاب ۵) 216; آیین دادرسی کیفری 706; کاهش حبس تعزیری 15; ارتشاء/اختلاس/کلاهبرداری 7; جرایم رایانه‌ای 31; قاچاق کالا و ارز 86 | 1796 |
| Commercial | تجارت 529 (dotic, articles 21-93 missing); لایحه اصلاحی تجارت 301 (bill status disputed); صدور چک 36 (+22, 11, 3 amendments) | ~900 |
| Labour / social security | قانون کار 202; تأمین اجتماعی 118 | 320 |
| Family | حمایت خانواده 58 | 58 |
| Administrative justice | قانون دیوان عدالت اداری 124 | 124 |
| Insurance | بیمه اجباری شخص ثالث 66 | 66 |
| Rulings (iran_rulings_v1, being built) | وحدت رویه دیوان عالی کشور 612; دیوان عدالت اداری annulments 929 + unity 190 | 1731 |
| **Licensing, guilds, tax, banking, customs, securities, IP, consumer, e-commerce, cooperatives** | **nothing** | **0** |
| **Cabinet resolutions, ministry/agency circulars, regulations** | **nothing** | **0** |

`iran_laws_v3` (5822 articles) is these law files plus the 10-11/10-12 staged fills (it cannot be rebuilt exactly from
the files alone; use the v3 build log). Sources today: dotic snapshot (3605), owner files, ekhtebar (staged), wikisource.
Known defects carried over from `docs/legal/CORPUS_AUDIT_2026-10-11.md`: قانون تجارت lacks 21-93, cheque law has 27
paraphrase points, several texts stop at 1395 amendments. Batch 1 below fixes the first one (see 4.3).

Target vs current by domain (target = all valid instruments a licensing/business/legal assistant is asked about):

| Domain | Current | Gap after batch 1 (this PR) | Remaining target |
|---|---|---|---|
| Licensing and guilds | 0 | نظام صنفی, بهبود محیط کسب‌وکار, تسهیل مجوزها, اصل ۴۴ (4 laws, 230 articles) | آیین‌نامه‌ها of those laws, هیأت مقررات‌زدایی resolutions (cat 239: 27 valid posts), تشکل‌های صنفی law |
| Tax | 0 | مالیات‌های مستقیم (256 + 36 inactive), ارزش افزوده (57) | پایانه‌های فروشگاهی, سوداگری, 26 valid tax-org circulars (cat 271), tax cabinet decisions |
| Commerce / consumer / e-commerce | تجارت (partial) | تجارت 1311 (524 + 76 inactive incl. the 1403 invalid list), تجارت الکترونیکی (81), مصرف‌کنندگان (18) | ثبت شرکت‌ها, تعاون, ورشکستگی, مالکیت صنعتی, مقررات صادرات و واردات, گمرک |
| Banking / AML | 0 | پولی و بانکی 1351 (15 + 30 inactive), بانک مرکزی 1402 (67), پولشویی (15) | بانکداری بدون ربا, 27 valid central-bank circulars (cat 281), شورای پول و اعتبار |
| Insurance | شخص ثالث | none | بیمه مرکزی, شرکت‌های بیمه, 23 شورای عالی بیمه regulations (cat 292), social-insurance laws |
| Cabinet resolutions | 0 | none | cat 124: 11,188 valid posts (staged by topic, see 3 and 5) |
| Circulars | 0 | none | cats 271, 278, 281, 272, 236 (about 150 valid posts) |

## 2. nezamat.ir map (measured 2026-10-13)

* WordPress, `robots.txt` allows everything except `/wp-admin/` (host redirects `www.` to bare `nezamat.ir`),
  `sitemap_index.xml` exists. `/wp-json/wp/v2/` is public read. Cloudflare-style challenges: none seen. Intermittent
  `IncompleteRead` on large responses: the fetcher retries (each retry counts as a request).
* Post types: only `post` is used for legal content (`page`, `attachment` exist but are not law). Tags: none.
  **41,988 posts**, of which **27,143 valid** and **14,845 flagged `نامعتبر` (category 327)**. "Valid" is therefore
  `categories_exclude=327`, and a post that gains category 327 later is a repeal signal.
* Volume: about 98 posts in the last 30 days (3.3/day), so polling is 1-2 requests per run.
* 182 categories, two hierarchies. Parent 73 **مقامات** (issuing bodies) and parent 329 **موضوعات** (subjects).
  The page header carries تاریخ تصویب, تاریخ ثبت, شماره, تاریخ انتشار and «انتشار در سایت قوانین» (HTML only; the REST
  `acf` is empty). Law posts hold the **consolidated text with inline amendment tags** («[اصلاحی ۱۴۰۳/۵/۲]»), cross-links to
  executive regulations and, for repealed articles, the repealing instrument. Cabinet posts open with proposer and legal
  basis («به پیشنهاد وزارت ... و به استناد اصل یکصد و سی و هشتم قانون اساسی»), which confirms the owner's remark.
* Category ids and counts (post counts include invalid posts; valid counts in brackets where I indexed them):

| id | name | posts | note |
|---|---|---:|---|
| 327 | نامعتبر | 14,845 | validity flag |
| 124 | هیئت وزیران (جمهوری اسلامی) | 12,263 [11,188] | cabinet resolutions |
| 130 | مجلس شورای اسلامی | 3,285 [2,993] | laws (consolidated) |
| 126 / 125 / 123 | کمیسیون هیات دولت / دبیر هیات دولت / معاون رییس جمهور | 1,310 / 132 / 92 | |
| 116 / 115 | هیأت عمومی دیوان عدالت اداری / دیوان عالی کشور | 533 / 619 | annulments / unity rulings |
| 133 | مجمع تشخیص مصلحت نظام | 254 | |
| 263 | شورای عالی اداری | 322 | |
| 280 / 117 / 113 | اداره کل حقوقی قوه قضاییه / شورای عالی قضایی / رییس قوه قضاییه | 14 / 299 / 901 | advisory opinions, regulations |
| 344 / 336 / 335 | مالیاتی / پولی و بانکی / بیمه (subjects) | 35 / 31 / 53 | [10 / 21 / 45] |
| 271 / 278 / 281 | سازمان امور مالیاتی / وزارت صمت / بانک مرکزی | 27 / 30 / 30 | [26 / 22 / 27] circulars |
| 239 / 267 / 292 | هیأت مقررات‌زدایی / شورای ۴۴ / شورای عالی بیمه | 27 / 32 / 28 | [27 / 30 / 23] |
| 272 / 236 / 264 / 338 | ثبت اسناد / وزارت کار / کانون وکلا / وکالت | 40 / 49 / 18 / 53 | [33 / 42 / 16 / 39] |
| 262 | پرکاربردها ("most used", 95 posts) | 95 | curated list of the main consolidated laws, the best seeding index |
| 328 | تنقیحی | 93 | consolidation/repeal lists, including «قانون فهرست قوانین و احکام نامعتبر در حوزه تجارت/بیمه/کار/تأمین اجتماعی/صنعت/معدن» |
| 81 / 84 / 95 | Pahlavi/Qajar cabinets, Majlis | 7,808 / 3,800 / 793 | historical, mostly invalid; out of scope |

* Not used: the site exposes extra REST namespaces (`mcp`, `wp-abilities/v1`, `rankmath`). I did not call them. Ask the
  site operator before touching `mcp`; it may be a data interface (see section 8).

**What nezamat has that we lack:** cabinet resolutions with legal basis, ministry/agency circulars (tax, SMEs, central
bank, registration), licensing law and the هیأت مقررات‌زدایی decisions, tax/VAT, insurance regulations, guild law,
banking, customs. **What it adds even for laws we hold:** the validity flag, inline amendment dates to 1404, and the
1403 repeal list for the commerce law.

## 3. Top 30 missing instruments or groups (ranked by expected user-question frequency)

Source column: nezamat post id (open as `https://nezamat.ir/?p=<id>`, it redirects to the post). "ek" = ekhtebar post id
found by search where one exists. Batch 1 (already staged) is marked DONE.

| # | Instrument / group | Domain | nezamat id | ek | Why |
|---|---|---|---|---|---|
| 1 | قانون تسهیل صدور مجوزهای کسب و کار 1400 (+ تفسیر مواد ۳-۵: 19803) | licensing | 20487 | 69128 | DONE. Defines the national licensing portal (درگاه ملی مجوزها) and "تاییدمحور/ثبت‌محور" licences |
| 2 | قانون نظام صنفی 1382 as amended to 1403 (+ amending 93058, 26960) | guilds | 32005 | 15711 | DONE. Business-licence (پروانه کسب) questions |
| 3 | قانون بهبود مستمر محیط کسب و کار 1390 | licensing | 27579 | 11092 | DONE |
| 4 | قانون مالیات‌های مستقیم 1366 as amended to 1404 | tax | 37918 | 18988 (1394 text, stale) | DONE |
| 5 | قانون مالیات بر ارزش افزوده 1400 | tax | 22119 | 58934 | DONE |
| 6 | قانون تجارت 1311 (+ 1403 invalid list for art. 21-93 etc.) | commerce | 48933 | none found | DONE |
| 7 | قانون اجرای سیاست‌های کلی اصل ۴۴ | privatisation, competition | 29178 | none found | DONE |
| 8 | قانون پولی و بانکی کشور 1351 | banking | 44860 | 15612 | DONE |
| 9 | قانون بانک مرکزی 1402 | banking | 17364 | 89688 | DONE (extra) |
| 10 | قانون تجارت الکترونیکی 1382 | e-commerce | 32181 | 18266 | DONE |
| 11 | قانون حمایت از حقوق مصرف‌کنندگان 1388 | consumer | 28474 | 11962 | DONE |
| 12 | قانون مبارزه با پولشویی 1386 (+ اصلاح 24920) | AML | 29410 | 347 | DONE (extra); amendment law still to fetch |
| 13 | آیین‌نامه‌های اجرایی نظام صنفی (صدور و تمدید پروانه کسب 1395; مجوز در فضای مجازی و بازاریابی شبکه‌ای, slug `post-40497`) + قانون تشکل‌های صنفی-تخصصی | guilds | 18782 (law), regs via links | search | The guild law points to them in 6 places |
| 14 | هیأت مقررات‌زدایی و بهبود محیط کسب و کار resolutions (cat 239) | licensing | category | search | Decides which licences are "تاییدمحور" |
| 15 | قانون پایانه‌های فروشگاهی و سامانه مؤدیان + تسهیل تکالیف مؤدیان (+ اصلاح) | tax | 24395, 17345, 58275 | search | Invoice/e-terminal obligations, very frequent |
| 16 | سازمان امور مالیاتی circulars and دستورالعمل دادرسی مالیاتی (cat 271, 26 valid) | tax circulars | category; 220329 | search | Rates, deadlines, procedure |
| 17 | Tax cabinet decisions (تصویب‌نامه در موضوع مالیات; deadline extensions 237552; تنقیحی 92685; 211671) | tax | by title in cat 124 | search | Deadlines change yearly |
| 18 | قانون مالیات بر سوداگری و سفته‌بازی; تفسیر ماده ۸۱ | tax | 171899, 20659 | 121752 | New 1404 law |
| 19 | قانون مقررات صادرات و واردات 1372 (+ تفسیر 33973, 29124) and its آیین‌نامه | trade | 38782 | search | Import/export permits (صمت) |
| 20 | وزارت صمت instructions (cat 278, 22 valid) | trade circulars | category | search | Licensing by the ministry |
| 21 | قانون امور گمرکی 1390 (+ amendments) | customs | 27687 | search | |
| 22 | قانون ثبت شرکت‌ها 1310; تعاون 1350 (54668); اداره تصفیه امور ورشکستگی (55338) | company registration | 55385, 54668, 55338 | search | Company formation, bankruptcy |
| 23 | قانون بازار اوراق بهادار 1384; توسعه ابزارها و نهادهای مالی (28394) | securities | 30662 | search | |
| 24 | بانک مرکزی circulars (cat 281, 27 valid; e.g. crypto brokers 182610), شورای پول و اعتبار (cat 312), عملیات بانکی بدون ربا (36503) with آیین‌نامه 24399, 30215 | banking | category | search | Bank/payment licences |
| 25 | بیمه: تأسیس بیمه مرکزی و بیمه‌گری (55270), اداره امور شرکتهای بیمه (37030), شورای عالی بیمه (cat 292, 23 valid), cat 335 (45 valid) | insurance | listed | search | |
| 26 | قانون حمایت از مالکیت صنعتی 1403 (علائم, اختراع) | IP | 85033 | search | Trademark registration |
| 27 | قانون الزام به ثبت رسمی معاملات اموال غیرمنقول (72388); ثبت اسناد regs (cat 272, 33 valid); دفاتر اسناد رسمی (45408) | registration | listed | search | |
| 28 | قانون رفع موانع تولید رقابت‌پذیر (26481, +25218), تأمین مالی تولید (96242), پشتیبانی تولید کشاورزی (242313), حداکثر استفاده از توان تولیدی (24747) | production | listed | search | |
| 29 | قانون برنامه هفتم (84868) and بودجه ۱۴۰۵ (205163) articles on tax/licensing | cross-cutting | listed | search | Large; ingest article ranges only |
| 30 | Cabinet resolutions by subject (cat 124 valid 11,188, index by title), شورای عالی کار (cat 350) wage decisions | cabinet | category | search | Phase 3, after 1-29 |

## 4. Pipeline

### 4.1 Fetch, stage, validate, build (reuses `fetch_ekhtebar_wp.py` and `corpus_fill.py`)

1. `scripts/legal/fetch_nezamat_wp.py index --categories <ids> --out FILE` builds a title index of VALID posts (small
   requests, 50 per page). `run`/`fetch`/`stage` take `config/nezamat_laws.json` (post id per law). Add the next batch
   by adding config entries only.
2. `fetch`: REST `posts/<id>` (content + categories; refuses category 327) and the HTML page for the header dates. Same
   politeness as the ekhtebar fetcher (>= 2 s, request budget, robots, stop on 403/429/5xx/challenge, host allow-list).
3. `stage` (deterministic, no LLM), on top of `corpus_fill.stage_law`:
   * drops nezamat's editorial pointer paragraphs («[آیین‌نامه اجرایی ...]») and records them as related instruments;
   * folds quoted amending text («[قانون اصلاح ... ماده ۱ـ ...]») into the article that carries it, so a quoted
     «ماده ۱» never becomes a bogus article; `stage.sequential: true` does the same for amending laws that quote other
     laws' articles without brackets (قانون تسهیل مجوزها: 5 real articles, not 9);
   * ZWNJ before the dash («ماده ۳‌ـ») is a marker;
   * one-line removals («ماده ۴۰ – [حذف ۱۳۹۴/۴/۳۱]») and range notes («[مواد ۲۱ تا ۹۳ ... نسخ شده است]») become inactive
     rows in `*.repealed.jsonl` (never answered from);
   * an older wording printed under the same number moves to the inactive file (direct-tax art. 244, 251);
   * adds `source: nezamat`, `source_url`, `nezamat_post_id`, `source_modified`, `staging_status: proposed`.
4. Gates (reused from `ingest_pipeline.validate_rows`): fields, article numbers, tier, repealed, duplicates, bill,
   allowlist (`config/legal_allowlist_nezamat.json`, all `proposed`), plus `validate` (HTML junk, normalisation,
   idempotence, duplicate keys). Output: `data/legal/staged/coverage_nezamat_2026-10-13.jsonl` (+ `.repealed.jsonl`,
   `_report.json`, `_crosscheck.json`). Never overwrites an existing file without `--overwrite`.
5. Build: after lawyer review, merge the allowlist file into `config/legal_allowlist.json`, then
   `build_collection.py` into the next collection (`iran_laws_v4`) with `--allow-proposed`. For قانون تجارت decide
   between the dotic rows (529, gaps) and the nezamat rows (524 + 76 inactive); do not load both.
6. Provenance: keep `source: nezamat` and `source_url` in the Qdrant payload so the citation shows the exact page.

### 4.2 Spot check: nezamat vs ekhtebar (and local corpus)

`fetch_nezamat_wp.py crosscheck FILE --fraction 0.05 --seed N --report out.json` samples 5% of active rows per law
(`--n 5` for 5 per law), fetches the same law from ekhtebar (post id in `config/nezamat_laws.json`) or, where ekhtebar
lacks it, from a local file (قانون تجارت vs the dotic rows), splits both with the same rules and compares
spelling-neutral text (no spaces/ZWNJ, hamza carriers folded, bracketed amendment tags removed). Result per article:
`match` (>= 0.97), `minor_diff` (0.90-0.97), `MISMATCH` (< 0.90), `missing_in_other`, `no_other_source`. Every non-match
goes to a lawyer list with both URLs. Run it after each batch and monthly on a new seed.

### 4.3 Results of the first batch (measured)

Laws fetched and staged (active rows + inactive rows):

| Law | nezamat id | Approval date | Rows | Inactive |
|---|---:|---|---:|---:|
| قانون نظام صنفی کشور | 32005 | 1382-12-24 | 102 (1-96, 6 مکرر) | 0 |
| قانون بهبود مستمر محیط کسب و کار | 27579 | 1390-11-16 | 31 | 0 |
| قانون اجرای سیاست‌های کلی اصل ۴۴ | 29178 | 1387-03-25 (final approval page date) | 92 | 0 |
| قانون تسهیل صدور مجوزهای کسب و کار | 20487 | 1400-12-24 | 5 | 0 |
| قانون مالیات‌های مستقیم | 37918 | 1366-12-03 | 256 | 36 |
| قانون مالیات بر ارزش افزوده | 22119 | 1400-03-02 | 57 | 0 |
| قانون تجارت | 48933 | 1311-02-13 | 524 | 76 |
| قانون پولی و بانکی کشور | 44860 | 1351-04-18 | 15 | 30 |
| قانون تجارت الکترونیکی | 32181 | 1382-10-17 | 81 | 0 |
| قانون حمایت از حقوق مصرف‌کنندگان | 28474 | 1388-07-15 | 18 | 4 |
| قانون بانک مرکزی (extra) | 17364 | 1402-03-30 | 67 | 0 |
| قانون مبارزه با پولشویی (extra) | 29410 | 1386-11-02 | 15 | 0 |
| **Total** | | | **1263** | **146** |

All gates pass; `validate` reports no HTML junk, no normalisation or duplicate-key problem. Review notes: direct-tax has
two numbers used twice in the source (3 and 40-43: a removed old article and a new one under the same number; the
removed ones are in the inactive file); the commerce law's inactive set comes from nezamat's own notes, including the
1403 invalid list; the lawyer must decide how to treat article 543 and the 1347 bill replacement.

Cross-check, 5 random articles per law (60 sampled, seed 7, ekhtebar or local corpus):
46 match, 2 minor_diff, 2 MISMATCH, 5 `missing_in_other`, 5 `no_other_source`.
* Matches: نظام صنفی, بهبود محیط کسب‌وکار, ارزش افزوده, پولی و بانکی, مصرف‌کنندگان, بانک مرکزی, پولشویی (5/5 each),
  تجارت الکترونیکی 4/5, تسهیل مجوزها 2/3 usable, تجارت 3/5 vs the dotic rows.
* minor_diff (commerce art. 121, 210): spelling only («مسئولیت/مسوولیت», «شرکاء/شرکای»). Dotic text is the older spelling.
* MISMATCH تجارت الکترونیکی art. 75: same content, different layout: nezamat prints the fine increases as bracketed notes
  («[افزایش مصوب ۱۴۰۳/۳/۳۰ – ۸۲۵.۰۰۰.۰۰۰ ریال]»), ekhtebar writes a prose sentence. **The dates differ** (nezamat
  1403/3/30, ekhtebar 1403/4/4 for the same cabinet adjustment): lawyer to confirm.
* MISMATCH تسهیل مجوزها art. 3: the amending law quotes other laws' articles; the two sites lay the quotation out
  differently, texts are the same on manual reading (art. 1-2 match after the sequential rule).
* `missing_in_other` مالیات‌های مستقیم: ekhtebar only has the 1394 text (post 18988, a download page), so it cannot
  validate the 1404-amended text. This is itself a finding: **ekhtebar's tax law is about 10 years stale; nezamat is current.**
* `no_other_source` اصل ۴۴: no ekhtebar page found by search. qavanin.ir would be the third source (section 6).

## 5. law_watch.py: polling nezamat.ir

Implemented (behind a switch, default unchanged = ekhtebar only): `LAW_WATCH_SOURCES=ekhtebar,nezamat` or
`law_watch.py poll|run --sources ekhtebar,nezamat`.

* Endpoint: `GET /wp-json/wp/v2/posts?orderby=modified&order=asc&modified_after=<cursor-1s>&per_page=20&_fields=...`.
  **No category filter**: nezamat adds only about 3 posts a day, so polling everything costs 1-2 requests and avoids missing
  a new issuer category. Own cursor `nezamat_cursor_modified` in `state.json` and own `items_nezamat.jsonl`; the existing
  ekhtebar cursor and file are untouched.
* Classification: `NEZAMAT_CATEGORY_HINTS` maps issuer categories to a typical act kind (124 cabinet -> resolution,
  116 -> annulment, 115 -> unity ruling, 130/133 -> law text, 271/278/281/272/236... -> circular, 239/267/292/312/263 ->
  regulation, 280 -> advisory opinion); title rules still decide first. Change ids are `nezamat:<post_id>`, records carry
  `source: nezamat.ir` and `nezamat_categories`. ekhtebar's "bill" category 1890 is ignored for nezamat items.
* **Invalid flag**: category 327 on a polled post (new or edited) sets `nezamat_invalid`, blocks `ingest_eligible` and adds
  a `recheck_corpus_text` action naming the linked laws. This is the cheapest repeal detector we have.
* Bodies are fetched per post for non-news items; failures retry like ekhtebar.
* Offline tests: `scripts/legal/tests/test_law_watch.py` (switch, classification, invalid flag, poll+classify round trip,
  offline cursor, qavanin still refused).
* qavanin.ir: **not polled** (JS challenge, section 6). The Fetcher still refuses it. If a legitimate access path appears
  (allow-list, API key, Iranian VPS exempted by the site), add it as a third entry in `KNOWN_SOURCES`.

## 6. qavanin.ir (newly approved)

Checked 2026-10-13 from this Mac (Iranian IP): `/robots.txt` and `/` return HTTP 200 with an ArvanCloud interstitial
page («Transferring to the website / در حال انتقال به سایت»), a JavaScript challenge, not content. Per the rules, **not
bypassed, nothing else requested**. Consequences: I could not verify its structure, stable IDs or any API; I cannot use
it for fetching or the 3-way cross-check today; the ekhtebar fetcher already treats that page text as a stop marker, and
the new fetcher does too. Earlier repo notes list `qavanin.ir` and `dotic.ir` print pages (`https://dotic.ir/print/<id>`),
so numeric law ids are likely on the real site, but that is unverified.
Strengths to expect, to test once access exists: a gazette-based consolidated text with amendment history and
official-looking law pages (probably the most authoritative of the three), stable ids. Action for the owner: ask the site
for either an unauthenticated API/bulk export, or an allow-listed fetcher IP/User-Agent; do not solve the challenge
automatically. Until then: nezamat (current, flagged validity) is the primary source, ekhtebar the cross-check.

## 7. Risks and decisions for the hub/lawyer

1. All rows are unofficial. The 1403 invalid list and the validity flag should be confirmed against the gazette before
   we mark articles inactive in production.
2. Duplicated law names: batch 1 contains قانون تجارت, which already exists (dotic). Replace, do not append.
3. The sequential/bracket rules are heuristics: re-run `validate` and the cross-check after each batch; the stage report
   lists skipped markers and removed notes per law.
4. Amending laws without a consolidated text (e.g. 93058 for نظام صنفی) should stay as amendment records, not replace
   the consolidated law.
5. Licensing questions need more than law text: the actual licence catalogue of the national portal (mojavez.ir:
   which licence, which issuing body, which documents). It is a public site; non-legal facts may come from any public
   source. Not fetched in this task; recommended as a separate structured dataset (licence -> issuer -> legal basis).

## 8. Tools and accounts that would help (honest estimates)

| Item | What it solves | Rough cost | Value |
|---|---|---|---|
| **Iranian VPS (24/7)** | ekhtebar, nezamat and qavanin accept Iranian IPs only; the Hetzner server cannot fetch, so `law_watch` depends on the owner's Mac being awake and the VPN off. A small VPS (1 vCPU/1 GB) running `law_watch.py run` plus the fetcher removes that | an Iranian provider, paid in rials, about the price of a few dollars a month (no quote verified) | High: moves coverage from "when the owner remembers" to daily; needed for the monthly spot check |
| **Official gazette (روزنامه رسمی) access** | The only truly official tier; lets us upgrade `source_tier` and settle disputes such as the 1403 invalid list and fine adjustments | Subscription price not verified; ask the gazette office. Possibly a bulk/API arrangement | High for credibility, medium for coverage; start with a sample of 20 disputed articles |
| **API / bulk export from the sites** | None offers an API beyond public WordPress REST. A data-sharing agreement with nezamat/ekhtebar would give validity metadata and avoid scraping load. qavanin could remove the challenge for a registered fetcher | Free to ask; relationship effort | High: stable ids, no breakage, polite by design. Ask nezamat what its `mcp` REST namespace is |
| **Lawyer capacity for the review gate** | All rows are `proposed`; nothing reaches production without it | Per hour, varies | Required. Batch the review by law, using the `_crosscheck.json` list of disagreements |
| **A structured mojavez.ir licence catalogue** | Turns "what licence do I need and who issues it" into data (needs legal-basis links to the laws here) | Engineering time only; public data | High for licensing questions, none of it is legal text |
| Mac launchd job (exists: `install_law_watch_mac.sh`) with `LAW_WATCH_SOURCES=ekhtebar,nezamat` | Interim until the VPS exists | Free | Medium |

I did not find any reason to buy an LLM or a commercial legal database for this work: the pipeline is deterministic.

## 9. Files in this change

* `scripts/legal/fetch_nezamat_wp.py` (new fetcher, index/fetch/stage/run/validate/crosscheck)
* `config/nezamat_laws.json`, `config/legal_allowlist_nezamat.json` (new, proposed)
* `data/legal/staged/coverage_nezamat_2026-10-13.jsonl`, `.repealed.jsonl`, `_report.json`, `_crosscheck.json` (new)
* `scripts/legal/law_watch.py` (nezamat source behind a switch)
* `scripts/legal/tests/test_fetch_nezamat.py` (new), `scripts/legal/tests/test_law_watch.py` (extended)
* `docs/legal/COVERAGE_PLAN_2026-10-13.md` (this file)

Run the tests with only these files: `python3 -m pytest scripts/legal/tests/test_fetch_nezamat.py scripts/legal/tests/test_law_watch.py -q`.
