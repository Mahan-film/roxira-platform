# Owner legal batch 2026-10-13 (staging inventory)

All rows are staged only (`staging_status`/`status` = proposed); nothing is loaded into any database.
Source files are untrusted: copied to a temp dir, extracted with `pdftotext` (plain and `-layout`) and, where
the text layer is unusable, OCR'd with `tesseract -l fas` (installed; `fas` available). No network.

Tools: `scripts/legal/parse_qavanin_print.py` (laws), `scripts/legal/build_owner_batch.py` (resolutions,
circulars, OCR'd law). Tests: `scripts/legal/tests/test_parse_qavanin_print.py`, `test_build_owner_batch.py`.

## Group A - qavanin print laws -> `data/legal/staged/qavanin_laws_2026-10-13.jsonl` (252 rows)

| File | Type | Issuer | Number / date | Rows | Status |
|---|---|---|---|---|---|
| قانون حمايت از مالكيت صنعتي | law, 150 articles | Majlis / qavanin.ir | approved 1403-03-01 | 150 | proposed (24 pages of text; art. 149 needed a parser fix, first glyph dropped at page top) |
| قانون بيمه اجباري ... شخص ثالث ... | law, 66 articles | Majlis / qavanin.ir | approved 1395-02-20 | 66 | proposed |
| طرح ها و لوایح.pdf | law "قانون بیمه" (1316-02-07), 36 articles; not a draft bill despite the name | qavanin.ir | 1316 | 36 | proposed, OCR (text layer garbled), all rows needs_review |
| قانون امور گمركي | law | qavanin.ir | - | 0 | BROKEN: 58 pages, ~7.6k chars = page headers only, body pages render blank |
| قانون نظام صنفي كشور | law | qavanin.ir | - | 0 | BROKEN: 42 pages, ~5.7k chars = headers only, body blank |
| قانون مالياتهاي مستقيم | law | qavanin.ir | - | 0 | STILL BROKEN: 158 pages, ~23k chars of headers only, body blank (rendered page 3 of the customs file as proof: empty) |
| قانون تجارت الكترونيكي | law | qavanin.ir | 1382 | 81 (existing `qavanin_2026-10-13.jsonl`) | skipped, already done |

The three blank-body PDFs were saved from qavanin.ir before the body loaded (images are only 32x34 icons);
they cannot be OCR'd. They must be re-saved by the owner (wait for the page to finish loading, then print to PDF).

## Group B - deregulation board sessions 91-94 -> `deregulation_board_2026-10-13.jsonl` (89 rows)

One row per numbered item (.N) under its lettered heading (الف -, ب -); a heading with plain body text and no
numbered items yields one row with `item_no` null. Text layer is good (presentation forms folded).

| File | Session | Approved | Rows |
|---|---|---|---|
| مصوبات نود و يكمين نشست | 91 | 1404-08-05 | 11 |
| مصوبات نود و دومين نشست | 92 | 1404-09-10 | 23 |
| مصوبات نود و سومين نشست | 93 | 1404-10-01 | 26 |
| مصوبات نود و چهارمين نشست | 94 | 1405-02-28 | 29 |

20 rows are flagged `needs_review` (item numbers repeated by table sub-lists, or sub-list merge heuristics).
Row boundaries depend on pdftotext reading order of tables; review before loading.

## Group C - Central Bank of Iran circulars -> `circulars_2026-10-13.jsonl` (483 chunks, 29 documents)

Issuer for every document is the Central Bank (letterhead and "جهت اطلاع مدیران عامل ... بانک‌ها"). No
tax-authority (سازمان امور مالیاتی) circular is in the batch; it is only cited inside 1040, 244216 and 8555969.
The PDF text layers are corrupted (letters dropped), so the body text is OCR (`text_extraction`
= ocr_tesseract_fas); number and date come from the page-1 text layer, which is reliable.
Subject is a heuristic (first quoted title after «ابلاغ», else first sentence): review before use.
OCR can misread digits inside the body (e.g. "1201/01/27" for 1401); every row has `needs_review` = true.

| File | Type | Issuer | Number / date | Chunks | Status |
|---|---|---|---|---|---|
| 101819.pdf | circular | CBI | 05/101819 / 1405-05-04 | 14 | proposed (OCR) |
| 1040.pdf | circular | CBI | 05/1040 / 1405-01-10 | 16 | proposed (OCR) |
| 118888.pdf | circular | CBI | 05/118888 / 1405-05-20 | 36 | proposed (OCR) |
| 119271.pdf | circular | CBI | 05/119271 / 1405-05-20 | 10 | proposed (OCR) |
| 130251.pdf | circular | CBI | 05/130251 / 1405-06-01 | 12 | proposed (OCR) |
| 130253.pdf | circular | CBI | 05/130253 / 1405-06-01 | 7 | proposed (OCR) |
| 130523.pdf | circular | CBI | 05/130523 / 1405-06-02 | 10 | proposed (OCR) |
| 136314.pdf | circular | CBI | 05/136314 / 1405-06-07 | 6 | proposed (OCR) |
| 139211.pdf | circular | CBI | 05/139211 / 1405-06-10 | 16 | proposed (OCR) |
| 159631.pdf | circular | CBI | 05/159631 / 1405-06-30 | 14 | proposed (OCR) |
| 170539.pdf | circular | CBI | 05/170539 / 1405-07-08 | 2 | proposed (OCR) |
| 244216.pdf | circular | CBI | 04/244216 / 1404-09-24 | 113 | proposed (OCR) |
| 257189.pdf | circular | CBI | 04/257189 / 1404-10-07 | 25 | proposed (OCR) |
| 69751.pdf | circular | CBI | 05/69751 / 1405-03-30 | 4 | proposed (OCR) |
| 77971.pdf | circular | CBI | 05/77971 / 1405-04-08 | 15 | proposed (OCR) |
| 78405.pdf | circular | CBI | 05/78405 / 1405-04-08 | 16 | proposed (OCR) |
| 79277.pdf | circular | CBI | 05/79277 / 1405-04-09 | 3 | proposed (OCR) |
| 79787.pdf | circular | CBI | 05/79787 / 1405-04-09 | 13 | proposed (OCR) |
| 8511596.pdf | circular | CBI | 05/6829 / 1405-01-26 | 13 | proposed (OCR) |
| 8555969.pdf | circular | CBI | 05/4933 / 1405-01-23 | 38 | proposed (OCR) |
| 8564608.pdf | circular | CBI | 05/7867 / 1405-01-29 | 29 | proposed (OCR) |
| 8596295.pdf | circular | CBI | 05/23268 / 1405-02-15 | 14 | proposed (OCR) |
| 92865.pdf | circular | CBI | 05/92865 / 1405-04-27 | 1 | proposed (OCR) |
| 94206.pdf | circular | CBI | 05/94206 / 1405-04-28 | 21 | proposed (OCR) |
| 95179.pdf | circular | CBI | 05/95179 / 1405-04-29 | 27 | proposed (OCR) |
| 98361.pdf | circular | CBI | 05/98361 / 1405-05-01 | 1 | proposed (OCR) |
| letter_7286438.pdf | circular | CBI | 04/250034 / 1404-09-30 | 1 | proposed (OCR) |
| letter_8580687.pdf | circular | CBI | 05/21416 / 1405-02-13 | 5 | proposed (OCR) |
| letter_8594368.pdf | circular | CBI | 05/21563 / 1405-02-13 | 1 | proposed (OCR) |

## Totals

- Staged rows: A 252 (+81 earlier e-commerce), B 89, C 483 chunks / 29 documents.
- Total new rows across the three files: 824.

## needs_ocr list

None outstanding: every scanned or garbled file was OCR'd (Group C all 30 PDFs incl. the excluded duplicate, and
`طرح ها و لوایح.pdf`). Scanned-page counts (no text layer) were: 101819 (9 pp), 119271 (7), 136314 (5),
78405 (13), 8596295 (11), 95179 (21), 244216 (9). The blank qavanin PDFs above are not scanned: they are empty
and need to be re-downloaded.

## Excluded

- `بخشنامه 6829.pdf`: exact duplicate of `8511596.pdf` (same number 05/6829, same date 1405-01-26, 98% text overlap); kept the 8511596 copy.
- No personal letters or non-legal documents were found. The `letter_*.pdf` files are CBI circulars.
- Number repeated only as an internal reference code (8729537 in 130251/159631/78405, line 4 of the letterhead) is not a duplicate; texts differ.

## Bylaw 2/153304

Searched every text layer and every OCR output (digits normalised, Persian and ASCII): the tax bylaw
"۲/۱۵۳۳۰۴" (article 95 of the direct taxes law, 1404/08/21) is NOT present in any file. The direct taxes law PDF,
the only likely carrier, has no body text.
