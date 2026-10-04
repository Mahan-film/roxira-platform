# Legal sources plan for missing Iranian legislation (2026-10-04)

Scope: where to obtain the missing laws listed in `LEGAL_CORPUS_GAP_AUDIT_2026-10.md` as machine-readable text. Read-only research; no repo files other than this report were touched.

## 0. Verification status (read first)

Fetch attempts were made from the agent Mac (curl and WebFetch). Results:

| Host | Result | Status |
| --- | --- | --- |
| rc.majlis.ir, dotic.ir, qavanin.ir, www.rrk.ir, www.ical.ir, ketab.ir | TLS reset (`SSL_ERROR_SYSCALL`) / "Socket is closed" | UNVERIFIED, unreachable from here (same as the audit's finding for prod/sandbox) |
| laws.moj.ir | DNS `ENOTFOUND` / proxy 502 | UNVERIFIED; the host name itself may be wrong or retired |
| majles.ir | timeout | UNVERIFIED |
| www.ekhtebar.ir | reachable. robots.txt only disallows `/wp-admin/`, sitemap listed | VERIFIED, but unofficial aggregator |
| fa.wikisource.org | reachable; has commerce code text; CC BY-SA stated by the fetch summary (page licence footer not independently confirmed) | VERIFIED reachable, partial text |
| wikihoghoogh.net | appears in search results only (not fetched) | search-result only |

Consequence: no official-portal URL, robots.txt, or terms page below is confirmed. Every "official source" entry is based on the audit's earlier notes and general knowledge and is marked UNVERIFIED. The owner must run a fetch test from an Iranian-reachable network (the Mac with the owner's normal connection, as audit section 6 already says) before any scraping design is frozen. Robots/terms must be read there; they could not be read here.

## 1. Source candidates

| Source | Role | URL pattern | Reuse terms | Text quality | Scraping | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| rc.majlis.ir (Majlis Research Center law portal) | primary official, consolidated texts with amendment history | `https://rc.majlis.ir/fa/law/show/<numeric id>` (id from site search) | unknown; no terms page read | usually clean HTML, article-structured | unknown; robots unread | NO |
| rrk.ir (Official Gazette) | in-force status, exact enactment date, gazette number | `https://www.rrk.ir/` (search by gazette number/date) | unknown | scanned PDFs plus some HTML; authoritative for the original text, NOT consolidated | unknown | NO |
| dotic.ir (President's legislative office) | consolidated texts; already the origin of the served snapshot via HF mirror | `https://dotic.ir/...` | unknown; audit saw 403 to bots | good | audit says manual save only | NO (403 recorded in audit) |
| qavanin.ir (Parliament law portal) | cross-check | unknown | unknown | audit saw stub page for bots | manual | NO |
| ekhtebar.ir | NOT acceptable as source of record; useful only as a locator and cross-check | `https://www.ekhtebar.ir/<law-slug>/` plus PDF attachments | unknown/commercial news portal | good HTML, some marked `(منسوخ)` | robots allows crawling | YES (reachable) |
| fa.wikisource.org | free cross-check for older statutes only | `https://fa.wikisource.org/wiki/<title>` | CC BY-SA (to confirm) | volunteer transcription, may be truncated/outdated | allowed via API | YES |
| ical.ir (Bar Association) | lawyers' disciplinary code, official | unknown | unknown | PDF likely | unknown | NO |

General legal note for the lawyer: statutes are generally not protected as expression, but compilation, headnotes and editorial annotations on portals are. The pipeline must store only the statute text and the official URL, never portal commentary. Lawyer to confirm.

## 2. Topic by topic

For all rows: preferred source is the official consolidated text on rc.majlis.ir or dotic.ir (UNVERIFIED), cross-checked against the Gazette (rrk.ir). Locator found by search is ekhtebar.ir (VERIFIED reachable but unofficial). Official-text fetch must happen from the owner's Mac.

| Topic | What to ingest | Found by search (verified existence, not official) | Risks |
| --- | --- | --- | --- |
| Peace court / dispute councils 1402 | قانون شوراهای حل اختلاف مصوب 1402/06/22 (already 46 rows from ekhtebar, replaced by official v2 per audit); plus court-competence statutes: قانون تشکیل دادگاه‌های عمومی و انقلاب (staged), 1381 amendment (staged), and the Judiciary regulations implementing the 1402 law | ekhtebar.ir has the 1402 law and a comparison with the 1394 version | the 1402 law vs 1394 law: ensure the 1394 text is marked superseded; implementing regulations (آیین‌نامه) are judiciary-issued, tier `secondary`; competence statutes are scattered, lawyer must list them |
| Administrative Justice Court | قانون تشکیلات و آیین دادرسی دیوان عدالت اداری (1392) and the 1402 amendment (latest amendment dated 1402/02/10 per the book listing) | ekhtebar.ir has the amendment law page; taaghche.com lists a 1402 book edition (commercial, do not use) | amendment must be applied to the 1392 base text; use official consolidated text, not two separate laws; tribunal unification rulings (آرای وحدت رویه ديوان) are a separate batch |
| Insurance (third-party) | قانون بیمه اجباری خسارات وارده به شخص ثالث در اثر حوادث ناشی از وسایل نقلیه (1395) and قانون بیمه (1316) | search confirms the third-party law exists; no 1402-1405 changes confirmed (search returned none) | possible post-1402 amendments unverified; third-party premiums/rates are set by Central Insurance regulations, not statute (do not ingest rate tables) |
| Traffic law and penalties | قانون رسیدگی به تخلفات رانندگی (1389/12/08, Guardian Council 1389/12/24, 35 articles) plus the penal fine schedule (جدول جرایم رانندگی) and the traffic-police implementing regulations | search confirms 35 articles/32 notes | fine amounts change yearly by circular, not by statute; do not ingest the table without a "valid-from" field; lawyer sign-off on which amounts apply |
| E-commerce | قانون تجارت الکترونیکی (1382/10/17) | search found only secondary literature; no official page confirmed | UNVERIFIED location; the law is short (about 80 articles), good first test of the official pipeline |
| Consumer protection | قانون حمایت از حقوق مصرف‌کنندگان (1388/07/15 per search) plus Tazirat/pricing law links | ekhtebar.ir and edalatsara.com have it | Do not confuse with 1359 consumer/pricing laws; confirm repeals in the 1403 invalid-laws list |
| Cybercrime | قانون جرایم رایانه‌ای (1388/03/05; 56 articles; originally Book 5 articles 729-783 numbering) plus the criminal-content list | ekhtebar.ir page exists (PDF; last updated 1401/02/15 per search); the exact slug I guessed returned 404, so use the search-result URL | numbering clash: the law has its own article numbers 1-56 plus the Tazirat placement 729-783; store the law-number as primary and the Tazirat number as an alias; content-list committee decisions are not statute (tier `secondary`) |
| Direct taxes | قانون مالیات‌های مستقیم (1366/12/03 and many amendments) | ekhtebar.ir, mizanonline.ir (judiciary news), shenasname.ir; also the tax authority publishes it (UNVERIFIED) | heavily amended (10+ amendment laws); only a fully consolidated official text is acceptable; ingest from the tax organisation or dotic and verify article count; lawyer sign-off on currency |
| Guild violations | قانون نظام صنفی (1382/12/24 revised) chapter on violations, the ruling on adjusting rial value of violations under art. 72 note 2; the old 1359-era penalty bill is marked `(منسوخ)` | ekhtebar.ir shows the old penalty bill as repealed; wikisource has it | do NOT ingest the repealed bill; fine amounts are adjusted by cabinet/ministry decisions (valid-from needed) |
| Computer/IT guild system (نظام صنفی رایانه‌ای) | regulations of Nezam-e Senfi-ye Rayaneh-i (cabinet/ministry/Organisation) | not found by search | UNVERIFIED that a regulation with this exact name exists in the form assumed; the lawyer or owner must provide the exact title/date; tier `secondary` |
| Lawyers' disciplinary code | لایحه استقلال کانون وکلا (1333/12/05) and its amendments, the 1400/04/06 executive regulation (آیین‌نامه اجرایی ماده 187 قانون برنامه ششم) and Bar Association disciplinary regulations | search confirms a dispute between SCODA and the judiciary on the 1400 regulation | two rival regimes (1333 law vs 1400 regulation) is a legal-interpretation question; do not let the model resolve it; lawyer must decide which governs; tier `secondary` for regulations |
| Commerce code arts 51, 53-71 | no ingestion; this is a correction | see section 3 | see section 3 |

## 3. Commerce-code articles 51 and 53-71: repeal status

Verified from the ekhtebar.ir page for the law "فهرست قوانین و احکام نامعتبر در حوزه تجارت":
- Law of invalid provisions in the commerce field: approved 1403/11/15, Guardian Council approval 1403/12/08, single operative article plus an appended schedule; the listed provisions are declared invalid from the effective date.
- The schedule lists, among others, articles 51 and 53 to 71 of the 1347/12/24 amendment law (لایحه اصلاحی قسمتی از قانون تجارت), NOT articles of the 1311 base code. This matches the audit's observation that the base «قانون تجارت» has 0 rows in that range while «لایحه اصلاحی قانون تجارت» has 20 active rows.
- The same schedule also invalidates unspecified articles of the 1311 Code (merchant registration, partnership, bankruptcy-procedure parts), plus items from the 1334, 1358 and 1368 instruments. The page summary did not give the exact article list, which is why STATE says "12" while the audit counts 20.

Needed: the exact schedule from the Gazette or the official portal, fetched from the owner's Mac (UNVERIFIED), then a lawyer-signed list. Batch 0 should flag the 20 rows `is_active=false` (the staged v2 pipeline then excludes them) only after that sign-off. Effective date of the law is not confirmed here ("from the date it takes effect"); the lawyer must confirm it (publication date and any delayed effective date).

## 4. Recommended ingestion order

1. Batch 0 (no new source): fix `source_tier`, repealed commerce rows, official re-source of CPC/dispute/cheque. Needs the signed repeal list (section 3).
2. Cybercrime, e-commerce, consumer protection: small, stable, low amendment risk, high user value. Good proof for the official-source fetcher.
3. Administrative Justice Court (base plus 1402 amendment merged), traffic violations law, third-party insurance.
4. Direct taxes (large, heavily amended; needs official consolidated text; only after the fetcher is proven).
5. Lawyers' disciplinary regime, guild-system regulations: ambiguous regime or unclear titles; ingest only after the lawyer supplies the exact instrument list.
6. Fine tables, rates and annual circulars: never as statute; separate tier with `valid_from`.

Pipeline notes: new laws must first be added to `config/legal_allowlist.json` (lawyer/owner review per its comment). New rows need `source_tier` in {official, secondary, unofficial} (the doc says official/secondary/unofficial; the audit says mirror/advisory: reconcile the two vocabularies). Only `official` goes to the served collection initially.

## 5. Lawyer sign-off needed

- Exact list and effective date of repealed commerce provisions (1403/11/15 law).
- Which instruments count as "court competence statutes" for the peace-court topic.
- Governing regime for lawyer discipline (1333 law vs 1400 regulation).
- Existence and exact title of the computer guild regulation.
- In-force status of tax law, third-party insurance and traffic fine schedule after 1402.
- Whether reuse of portal texts (and of unofficial mirrors) is acceptable; confirmation of the reuse position for statute text.

## 6. Open items (cannot be done from this environment)

1. Run `curl` against each official host from the owner's Mac; record robots.txt and the terms page for rc.majlis.ir, dotic.ir, rrk.ir; add them to this report.
2. Find the numeric ids on rc.majlis.ir for each law (needs the portal search, not reachable here).
3. Check `laws.moj.ir` is a real host; the DNS lookup failed.
4. Do not use ekhtebar.ir, wikisource or wikihoghoogh.net as source of record; only for locating titles/dates.
