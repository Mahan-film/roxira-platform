# Legal corpus gap audit and ingestion plan (2026-10-04)

Scope: Smart Judge Persian legal corpus. Read-only audit; no production access, no ssh, no Qdrant writes. All counts below were computed locally with aggregate-only scripts over the staged JSONL files. Prod Qdrant figures are quoted from `docs/STATE.md` (2026-10-03) and were NOT re-measured.

## 1. Sources inspected

| Source | Location | Rows | Notes |
| --- | --- | ---: | --- |
| Served snapshot (repo) | `data/legal/dotic_articles_2026-09-22.jsonl` | 4,216 | 8 laws; no `source_tier` field at all |
| Coverage manifest | `data/legal/coverage_manifest.json` | n/a | same 8 laws, all tiers `unknown` |
| Staged pilot | `data/raw/phase1/phase1_staged.jsonl` (main checkout) | 586 | 8 laws, tier `official`, all `owner-supplied file` |
| Staged official v2 | `.claude/worktrees/relaxed-shaw-972e72/data/raw/phase1/phase1_official_v2.jsonl` (git-ignored; NOT in main checkout `data/raw/`) | 1,504 | 18 distinct law names (STATE says 17), all `official` |
| Staged new laws | same worktree, `phase1_new_laws.jsonl` | 887 | subset of v2 that is not already served |
| Prod Qdrant (quoted) | `iran_laws_v2` | 5,103 points | repo snapshot has 4,216 articles: 887 extra points unexplained (equals the size of `phase1_new_laws.jsonl`, possibly already upserted; VERIFY read-only before any plan step) |

Important location finding: `data/raw/phase1/phase1_official_v2.jsonl` does not exist in the main checkout or this worktree. It exists only inside the worktree `relaxed-shaw-972e72`. Back it up before any worktree cleanup (STATE lists 12 dirty worktrees).

## 2. Served corpus (repo snapshot, 4,216 rows)

| Law | Rows | Inactive | Dup (no,label) keys | Source | Tier |
| --- | ---: | ---: | ---: | --- | --- |
| قانون مدنی | 1,334 | 11 | 0 | dotic via HF snapshot | none |
| قانون مجازات اسلامی | 735 | 0 | 7 | dotic via HF | none |
| قانون آیین دادرسی کیفری | 706 | 2 | 7 | dotic via HF | none |
| قانون تجارت | 529 | 1 | 2 | dotic via HF | none |
| قانون آیین دادرسی مدنی | 529 | 2 | 1 | owner-supplied (ekhtebar.ir, unofficial) | none |
| لایحه اصلاحی قانون تجارت | 301 | 0 | 1 | dotic via HF | none |
| قانون شوراهای حل اختلاف ۱۴۰۲ | 46 | 0 | 5 | owner-supplied (ekhtebar.ir) | none |
| قانون صدور چک (اصلاحی ۱۳۹۷) | 36 | 2 | 8 | owner-supplied (ekhtebar.ir) | none |

Fields present on every row: law_id, law_name, law_type, article_no, article_label, chapter, amended_on, approval_date, status, is_active, source_url, source, content_hash, chunk_index, text, title, category, scope_tags. Missing: `source_tier`. approval_date is present only on the 611 owner-supplied rows; amended_on on 85 rows (range 1348-08-29 to 1395-11-10). Newest legislation in the served set is 1402-06-22 (dispute councils); nothing after 1402.

## 3. Staged sets

Phase1 official v2 (1,504 rows, all `official`, none inactive, `approval_date` null on all rows):

| Law | Rows | Dup keys | Already served? |
| --- | ---: | ---: | --- |
| قانون آیین دادرسی دادگاه‌های عمومی و انقلاب در امور مدنی (CPC, official re-source) | 528 | 1 | yes (529 unofficial) |
| قانون کار | 203 | 1 | no |
| قانون اجرای احکام مدنی | 181 | 1 | no |
| قانون ثبت اسناد و املاک | 167 | 23 | no |
| قانون تأمین اجتماعی | 125 | 7 | no |
| قانون حمایت خانواده (1391) | 58 | 0 | no |
| قانون شوراهای حل اختلاف | 46 | 5 | yes (official re-source) |
| قانون تشکیل دادگاه‌های عمومی و انقلاب | 39 | 1 | no |
| قانون نحوه اجرای محکومیت‌های مالی | 30 | 1 | no |
| قانون اصلاح قانون تشکیل دادگاه‌های عمومی و انقلاب (1381) | 23 | 11 | no |
| قانون صدور چک | 23 | 1 | yes (re-source) |
| قانون کاهش مجازات حبس تعزیری | 17 | 2 | no |
| قانون مسئولیت مدنی | 16 | 0 | no |
| قانون اصلاح قانون صدور چک (1397) | 16 | 5 | yes (re-source) |
| قانون روابط موجر و مستأجر 1362 | 15 | 0 | no |
| قانون روابط موجر و مستاجر 1376 | 13 | 0 | no |
| قانون اصلاح قانون صدور چک (1400) | 4 | 1 | no |

Net new rows = 887 (`phase1_new_laws.jsonl`); 617 rows re-source already-served laws with official text. Older pilot `phase1_staged.jsonl` (586 rows) is superseded by v2; it holds rent 1356 (34 rows, absent from v2, which instead has rent 1362 and 1376) and a reduced-imprisonment text with 24 rows vs 17 in v2 (reconcile, see risks). Row counts per law look low for several laws (e.g. rent 1376: 13, reduction 1399: 17, registration 167 vs actual law of several hundred articles incl. amendments); treat counts as unverified until compared with the official article count.

## 4. Checklist: key Iranian laws vs corpus

Status key: PRESENT = served now; STAGED = in v2 file, not (verified) in Qdrant; PARTIAL; MISSING.

| Area | Status | Rows | Comment |
| --- | --- | ---: | --- |
| Civil code | PRESENT | 1,334 | unofficial dotic text, no tier; 11 repealed flagged |
| Civil procedure | PRESENT (unofficial) + STAGED official | 529 / 528 | swap to official in batch 0 |
| Criminal procedure (2013) | PRESENT | 706 | unofficial; amendments after 1395 not verified |
| Islamic penal code incl. ta'zirat | PRESENT | 735 | only the code (book 1 to 5 as one law); Book 5 (ta'zirat) is the 1375 law with later amendments, verify coverage; no «قانون مجازات اسلامی ۱۳۷۵ تعزیرات» row by name |
| Penal reduction (حبس تعزیری 1399) | STAGED | 17 | |
| Commercial code | PRESENT | 529 | 1913-era text (1311), amended 1358; separate entry «لایحه اصلاحی» 301 |
| Company law (اصلاحی 1347) | MISSING as separate law | 0 | «لایحه اصلاحی قانون تجارت» 301 rows is the 1347 amendment (company part), see risk R1 |
| Labor law | STAGED | 203 | not served |
| Social security | STAGED | 125 | |
| Family protection 1391 | STAGED | 58 | no newer family laws (e.g. 1393 divorce registration) |
| Rent / landlord-tenant | STAGED | 15 + 13 (+34 in old pilot for 1356) | 1356 text missing from v2; which one governs is a lawyer question |
| Cheque law | PRESENT (36) + STAGED (23+16+4) | | amendments 1397, 1400 staged only |
| Registration of deeds/property | STAGED | 167 | 23 duplicate keys |
| Courts formation / jurisdiction | STAGED | 39 + 23 | |
| Execution of civil judgments | STAGED | 181 | |
| Financial sentences execution | STAGED | 30 | |
| Civil liability | STAGED | 16 | |
| Dispute councils 1402 | PRESENT | 46 | |
| Administrative Justice Court law | MISSING | 0 | |
| Insurance (third-party/compulsory, insurance law) | MISSING | 0 | |
| Traffic / driving violations law | MISSING | 0 | |
| Citizenship / immigration basics | MISSING | 0 | |
| Consumer protection | MISSING | 0 | |
| E-commerce law (1382) | MISSING | 0 | |
| Cybercrime law | MISSING | 0 | |
| Direct taxes law, VAT | MISSING | 0 | |
| Municipal laws | MISSING | 0 | |
| Anti-money-laundering, smuggling | MISSING | 0 | |
| Lawyers independence / disciplinary, judges disciplinary | MISSING | 0 | |
| Unification rulings (آرای وحدت رویه), advisory opinions | MISSING | 0 | prod: 6 precedents, 250 circulars, 0 advisory opinions (quoted) |

Totals vs 25-row checklist: 7 present served (civil, CPC, CrPC, penal, commerce, company-adjacent, cheque, dispute councils), 11 staged-only, 11+ missing.

## 5. Data-quality risks (with counts)

| Id | Risk | Count / evidence | Severity |
| --- | --- | --- | --- |
| Q1 | No `source_tier` on any served row | 4,216 / 4,216 rows; manifest says `unknown` | High (hard rule: tier tagging) |
| Q2 | Unofficial-source rows served | 611 owner-supplied from ekhtebar.ir (CPC 529, dispute 46, cheque 36) plus 3,605 dotic-via-HF mirror (not first-party) | High |
| Q3 | Repealed/invalid articles still served | 18 rows `REPEALED` (kept, `is_active=false`, filter must exclude them at query time). In «لایحه اصلاحی قانون تجارت»: 20 rows with article_no 51 or 53-71 are all `is_active=True`; manifest and STATE say they were declared invalid by the 1403/11/15 law. STATE says "12 commerce arts" (discrepancy, owner lawyer to confirm exact list); the base «قانون تجارت» has 0 rows in that range. Count here is by article number only, not by legal verification | High |
| Q4 | Duplicate (article_no, label) keys | served 31 (CrPC 7, penal 7, cheque 8, dispute 5, commerce 2, CPC 1, lay. 1); v2 has 58; content_hash duplicates are 0 in both. Many are legitimate (تبصره / مکرر) but keys do not distinguish them | Medium |
| Q5 | Non-numeric article_no | 10 rows (cheque 6, civil 4), e.g. `5-mokarrar`: breaks exact article lookup | Medium |
| Q6 | Bills vs enacted | 0 rows flagged bill. «لایحه اصلاحی» is enacted law per #171 but the name invites confusion; 301 rows | Medium |
| Q7 | Missing approval_date | all 3,605 dotic rows, and all 1,504 v2 rows (`approval_date` null) | Medium |
| Q8 | Amendment currency | newest served text 1402-06; nothing after. Laws changed in 1403-1405 are not reflected | High |
| Q9 | Count mismatch repo vs prod | 5,103 in Qdrant vs 4,216 in repo (+887 equal to `phase1_new_laws.jsonl`) | High, verify read-only |
| Q10 | v2 file only in a stray worktree | single copy, git-ignored | High (data loss) |
| Q11 | Pilot vs v2 overlap | pilot has rent 1356 (34) and reduction 24 rows vs 17 in v2 | Low |
| Q12 | Old collection `iran_laws_bge_m3` still used by citation guard | 1,308 points, 1,305 placeholders (roadmap R2) | High |

## 6. Ingestion plan

### Sources, terms, rate limits
| Source | Use | Notes (UNVERIFIED terms, read each site's terms before bulk fetch) |
| --- | --- | --- |
| rc.majlis.ir (Majlis Research Center) | primary official text | prod server and agent sandbox cannot reach it (TLS reset); fetch from the owner's Mac. Official public data; confirm reuse terms. Use 1 request per 3-5 s, single connection, set a descriptive User-Agent |
| rrk.ir (Official Gazette / Parliament legal portal) | gazette-dated amendments, in-force status | unreachable from sandbox; same pacing |
| dotic.ir (President's legislative office) | consolidated texts with amendments; current snapshot comes from this via an HF mirror | returned 403 to bots; manual save only, no scraping |
| qavanin.ir (Parliament laws portal) | cross-check of consolidated text | stub page for bots; manual save |
| ekhtebar.ir, other aggregators | NOT acceptable (unofficial) | replace existing 611 rows |

### Batches (in order)
| Batch | Content | Rows | Gate summary |
| --- | --- | ---: | --- |
| 0 | Hygiene on existing 4,216: add `source_tier`, drop or flag the 20 invalid commerce rows, replace unofficial CPC/dispute/cheque with official v2 rows (617) | -> | no repealed active rows; tier on 100% |
| 1 | The 887 net-new staged rows (labor, social security, family, execution, courts, financial sentences, registration, rent 1362/1376, civil liability, penal reduction, cheque amendments) | 887 | spot check 5 articles per law against rc.majlis.ir |
| 2 | Missing procedural/economic core: Administrative Justice Court law, insurance, traffic, e-commerce, consumer protection, cybercrime, direct tax, VAT, anti-money-laundering, rent 1356 | est. 1,500-2,500 | lawyer sign-off on in-force status |
| 3 | Professional/disciplinary: lawyers independence law and regulations, judges disciplinary, administrative violations | est. 300-600 | |
| 4 | Secondary sources: unification rulings (high value), circulars, advisory opinions (tier `advisory`, never above `official`) | tbd | tier tagging mandatory |
| 5 | Amendments 1403-1405 to all core codes via Gazette | tbd | |

### Validation gates (every batch)
1. Schema: all JSONL fields present, `source_tier` in {official, mirror, advisory, unofficial}; unofficial rows are rejected for the served collection.
2. Source URL non-null and on an allowed official host; `approval_date` filled (fix 1,504 + 3,605 nulls).
3. Article count equals the official count (gap list from `w6_ingest_dotic.py --dry-run`, `missing numbers in range` empty or explained).
4. No repealed content: zero rows with `is_active=false` in the served collection; invalid commerce articles 51, 53-71 absent; lawyer-confirmed list.
5. Duplicate keys resolved (distinguish تبصره/مکرر in `article_label`); non-numeric `article_no` normalised.
6. Citation verification: run exact lookup for 5 random articles per law and `/citations/verify` plus `scripts/eval_legal_rag.py` baseline (63.3% citation accuracy must not regress; 30+ new eval questions per new area by a lawyer).
7. Not touching customer data; no `:free` model used for any step on case data.

### Owner approvals required before any production Qdrant write
1. Written yes to ingest (per STATE: "ingest needs the owner's explicit yes"), naming the batch and row count.
2. Approval of a full Qdrant snapshot/backup taken first (owner runs or authorises; per hard rule, no direct prod changes by agents).
3. Approval of target: a NEW separate collection (e.g. `iran_laws_v3`), not in-place upsert into `iran_laws_v2`.
4. Approval of the pre-write read-only verification report (counts, spot-checks, eval results vs baseline).
5. Separate approval for switching the app's collection env var (and the citation-guard collection), with rollback plan.
6. Lawyer sign-off (via owner) on the repealed-article list and in-force status for batches 0-2.
7. Any migration or schema change via a reviewed PR only (hard rule).

## 7. Immediate actions (no approval needed)
- Copy `phase1_official_v2.jsonl` and `phase1_new_laws.jsonl` out of the stray worktree to the Mac `data/raw/phase1/` (git-ignored) and back them up.
- Read-only check of prod point counts per law to resolve Q9.
- Fix `article_label` uniqueness and `approval_date` nulls in the build script.
