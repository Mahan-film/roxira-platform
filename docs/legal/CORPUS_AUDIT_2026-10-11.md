# Smart Judge legal corpus audit and gap fill (2026-10-11)

Scope: the served collection `iran_laws_v2` (5,083 points, read-only scroll on the production Qdrant, payload only, no
writes) against a checklist of core Iranian laws. Everything fetched is `unofficial` or `secondary` and UNVERIFIED:
a lawyer must sign off before anything is ingested (`docs/ops/LEGAL_INGEST.md`). Nothing was written to production.

## 1. Inventory of iran_laws_v2 (22 distinct law_name values: 20 legal instruments plus 2 lease laws)

| law_name in v2 | points | article numbers | gaps | notes |
|---|---|---|---|---|
| قانون مدنی | 1334 | 1-1335 | 1306-1308, 1310-1311 | 11 inactive; dotic snapshot |
| قانون مجازات اسلامی (1392) | 735 | 1-728 | none | Books 1-4 only. Art. 728 point contains web-page junk ("دسته بندی ها ارسال دیدگاه ها ..."). amended_on stops at 1395 |
| قانون آیین دادرسی کیفری | 706 | 1-699 | none | 7 duplicate keys, 2 inactive; amended_on stops at 1395 |
| قانون تجارت | 529 | 1-600 | 21-93 | 73 articles absent (unverified why) |
| قانون آیین دادرسی مدنی | 529 | 1-529 | 412 | owner file |
| لایحه اصلاحی قانون تجارت | 281 | 1-300 | 51, 53-71 | matches the 1403 invalid-articles list |
| قانون کار | 202 | 1-203 | 19 | rc.majlis owner file |
| قانون اجرای احکام مدنی | 180 | 1-180 | none | |
| قانون ثبت اسناد و املاک | 147 | 1-142 | 94 | |
| قانون تأمین اجتماعی | 120 | 1-118 | none | |
| قانون صدور چک (اصلاحی ۱۳۹۷) | 63 | 1-25 | none | see 3 |
| قانون حمایت خانواده | 58 | 1-58 | none | |
| شوراهای حل اختلاف و دادگاه‌های صلح ۱۴۰۲ | 46 | 1-41 | none | |
| قانون تشکیل دادگاه‌های عمومی و انقلاب | 39 | 1-38 | none | |
| قانون نحوه اجرای محکومیت‌های مالی | 30 | 1-29 | none | article count to be checked against the enacted law |
| قانون اصلاح قانون تشکیل دادگاه‌های عمومی و انقلاب | 23 | 12 distinct of 1-39 | 27 | partial amending law |
| قانون کاهش مجازات حبس تعزیری | 17 | 1-15 | none | |
| قانون مسئولیت مدنی | 16 | 1-16 | none | |
| قانون روابط موجر و مستأجر ۱۳۶۲ | 15 | 1-15 | none | |
| قانون روابط موجر و مستاجر ۱۳۷۶ | 13 | 1-13 | none | art. 2 is the pre-1403 wording |

## 2. Checklist result

Present (complete as far as can be seen): قانون مدنی, آیین دادرسی مدنی, آیین دادرسی کیفری, مجازات اسلامی 1392 (Books 1-4),
حمایت خانواده, کار, اجرای احکام مدنی, نحوه اجرای محکومیت‌های مالی, ثبت اسناد, شوراهای حل اختلاف 1402, تأمین اجتماعی,
مسئولیت مدنی = **12**.
Partial: صدور چک, تجارت (21-93 absent), موجر و مستأجر (1376 stale, 1356 missing) = **3**.
Missing: Book 5 تعزیرات 1375, ارتشاء/اختلاس/کلاهبرداری 1367, دیوان عدالت اداری, بیمه شخص ثالث 1395, جرایم رایانه‌ای,
قاچاق کالا و ارز, قانون اساسی = **7**.

After this task: ارتشاء/اختلاس/کلاهبرداری, جرایم رایانه‌ای, قانون اساسی and the 1356 lease law are staged (missing 7 -> 4).
Still missing (not fetched): تعزیرات 1375, دیوان عدالت اداری, بیمه شخص ثالث 1395, قاچاق کالا و ارز.

### Currency spot checks (is the stored text the latest amended version?)

- چک 1397 art. 23: both the 1397 text and a paraphrase are stored. Art. 7 holds the 1382 text (with the 1403 cabinet
  adjustment note) plus a paraphrase. **Art. 21: the real rows are `is_active=false`, so only the paraphrase is served.**
  The v2 cheque law contains 27 points from a proof-of-concept summary (`source_url` way2law.ir, `scripts/w6_cheque_law_v2.py`,
  "not verbatim"): e.g. its art. 7 states penalty tiers that are not in the statute text. Every article 1-25 also has a real
  row from ekhtebar, so dropping the 27 paraphrase points loses no article number, except that art. 21 needs the real rows
  re-activated first. Recommendation: lawyer decision, then `--drop-source-url-contains way2law.ir` in the v3 build.
- لایحه/قانون روابط موجر و مستاجر ۱۳۷۶ art. 2: v2 has the old text; the current page (ekhtebar) carries the amendment of
  1403/2/10. Staged as a replacement.
- مجازات اسلامی: no 1399 amendments visible (amended_on max 1395). آیین دادرسی کیفری likewise. Not re-fetched (no usable
  source reached, see 4).
- حمایت خانواده 1391: present, 58 articles; could not confirm the latest amendments (ekhtebar offered only the repealed 1353
  law and an amendment bill).

## 3. What was fetched and staged

Tooling: `scripts/legal/fetch_laws.py` (existing; two small additions: `sources.ekhtebar.url` / `prefer: html` pin a verified
page, `sources.wikisource.title` pins a page via plain `/wiki/` HTML because robots.txt forbids `/w/api.php`), target list
`config/corpus_fill_laws.json`, new `scripts/legal/corpus_fill.py` (normalise, mark repealed, dedupe, run gates).
Politeness: >= 3 s per host, robots honoured, identifying User-Agent, about 60 page requests in total.

| law | source | tier | rows staged | repealed (excluded) |
|---|---|---|---|---|
| قانون اساسی (1368 revision) | fa.wikisource.org, pinned page | secondary | 177 (اصل 1-177) | 0 (superseded wording dropped, 37 lines) |
| تشدید مجازات ارتشاء، اختلاس و کلاهبرداری | ekhtebar.ir pinned page | unofficial | 7 | 1 (art. 6, repealed by 1399 law) |
| جرایم رایانه‌ای (articles 729-783 as in Book 5; "ماده N ق.ج.رایانه‌ای" in the page) | ekhtebar.ir | unofficial | 31 | 24 (756-779 procedural part repealed by CPC art. 698, plus 782-783 per page tags) |
| روابط موجر و مستاجر ۱۳۵۶ | ekhtebar.ir | unofficial | 32 | 0 |
| روابط موجر و مستاجر ۱۳۷۶ (replacement, 1403 text) | ekhtebar.ir | unofficial | 13 | 0 |

Files (new, written only under `data/legal/staged/`, this repo already versions canonical JSONL under `data/legal/`):

- `data/legal/staged/corpus_fill_2026-10-11.jsonl` - 247 rows, about 434 KB (new laws; gates pass: 0 duplicates, 0 repealed, all on the allowlist)
- `data/legal/staged/corpus_fill_2026-10-11.repealed.jsonl` - 25 repealed rows, about 39 KB (record only, never ingested)
- `data/legal/staged/corpus_fill_2026-10-11_replace_lease1376.jsonl` - 13 rows, about 17 KB

Normalisation: digits to ASCII, Arabic yeh/kaf to Persian, bidi marks removed, site chrome cut, "متن سابق" blocks dropped,
chapter recorded, `amended_on` from the latest "(اصلاحی ...)" date, text prefixed "ماده N <law>: " like phase1_canonical.
`config/legal_allowlist.json` gained 8 entries with status `proposed` (lawyer/owner review pending; the 3 unfetched laws are
included so a later fetch can use the same names).

Cyber law numbering caveat: the source numbers it 729-783 (Book 5 continuation). Users also cite "ماده 1 قانون جرایم رایانه‌ای";
the page text contains the alias for the first words only. A lawyer should decide whether to add the alias to row text.

## 4. Not fetched, and why

| law | outcome |
|---|---|
| تعزیرات 1375 (Book 5, art. 498-728) | ekhtebar has one page per article, but only for some articles (498-513 returned 404, then the server dropped the connection); stopped, no WAF probing. rc.majlis.ir id 92683 is a single page but its TLS certificate failed verification from this network from about 18:40 (it worked once at 18:36) - not bypassed |
| دیوان عدالت اداری (1392) | ekhtebar has only the repealed 1385 law and amendment bills; rc.majlis TLS failure; qavanin.ir serves a JavaScript challenge instead of robots.txt, so the fetcher correctly treats it as unreadable robots and refuses |
| بیمه شخص ثالث 1395 | ekhtebar: only regulations; same rc.majlis/qavanin result |
| قاچاق کالا و ارز | ekhtebar: only regulations and amending laws |
| dotic.ir | 403 as known; not touched. ical.ir also 403; rrk.ir: TLS EOF. None bypassed |

Owner next step for these four: from a network where rc.majlis.ir validates, add pinned entries
(`sources.ekhtebar.url` with an rc.majlis.ir `law/show/<id>` URL and `prefer: html`; known id: تعزیرات 92683) and run
`fetch_laws.py --config config/corpus_fill_laws.json --only <id>` then `corpus_fill.py stage`; the parser already handles
rc.majlis "ماده N -" lines. No LLM was used (OpenRouter not needed).

## 5. Ingest plan: iran_laws_v3 (run ON the server, owner approval required)

v3 = v2 vectors copied unchanged (no re-embedding, `build_collection.py`) minus the replaced 1376 rows, plus the staged rows
embedded with BAAI/bge-m3 exactly like v2 (`ingest_pipeline.py apply`, normalised cosine, unnamed 1024-d vector).
`ingest_pipeline.py` accepts only a localhost Qdrant, so run it in a container sharing Qdrant's network namespace and the
app image's model cache (TO-VERIFY: image/volume names). Do not write to v2.

```bash
ssh 5.75.200.67
cd /opt/roxira_platform && git fetch && git checkout <the merged commit>      # owner approval
# 0. snapshot v2 (owner-run write)
curl -s -X POST localhost:6333/collections/iran_laws_v2/snapshots
# helper: python inside the app image, same network namespace as Qdrant (127.0.0.1:6333 is then Qdrant)
IMG=$(docker inspect -f '{{.Config.Image}}' roxira_app_prod)
RUN="docker run --rm --network container:roxira_qdrant_prod --volumes-from roxira_app_prod -v /opt/roxira_platform:/repo:ro -w /repo $IMG python3"
# 1. gates + plan (no writes). --allow-proposed asserts the owner accepts the unofficial/secondary sources of the
#    "proposed" allowlist entries pending lawyer review; without it their rows fail the not_in_allowlist gate.
$RUN scripts/legal/ingest_pipeline.py validate data/legal/staged/corpus_fill_2026-10-11.jsonl --allow-proposed
$RUN scripts/legal/ingest_pipeline.py validate data/legal/staged/corpus_fill_2026-10-11_replace_lease1376.jsonl --allow-proposed
# 2. copy v2 -> v3 (dry run, then real). Optional, after lawyer OK: --drop-source-url-contains way2law.ir
$RUN scripts/legal/build_collection.py --src iran_laws_v2 --dst iran_laws_v3 --drop-law "قانون روابط موجر و مستاجر ۱۳۷۶" --dry-run
$RUN scripts/legal/build_collection.py --src iran_laws_v2 --dst iran_laws_v3 --drop-law "قانون روابط موجر و مستاجر ۱۳۷۶"
# 3. add the new laws (dry run, then real)
for f in corpus_fill_2026-10-11 corpus_fill_2026-10-11_replace_lease1376; do
  $RUN scripts/legal/ingest_pipeline.py apply data/legal/staged/$f.jsonl --collection iran_laws_v3 --allow-existing --allow-proposed --dry-run
  $RUN scripts/legal/ingest_pipeline.py apply data/legal/staged/$f.jsonl --collection iran_laws_v3 --allow-existing --allow-proposed
done
# 4. count: expect 5083 - 13 + 247 + 13 = 5330 points
curl -s localhost:6333/collections/iran_laws_v3 | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['points_count'])"
```

### Compare v2 and v3 before switching (retrieval only, no LLM)

```bash
for C in iran_laws_v2 iran_laws_v3; do for SET in retrieval_golden retrieval_golden_new_laws; do
  echo "== $C $SET"
  docker exec -e LIGHTRAG_QDRANT_COLLECTION=$C roxira_app_prod \
    python scripts/eval_chat_golden.py --retrieval-only --retrieval-set data/eval/chat_golden/$SET.json | tail -15
done; done
```
(The scripts must be present in the container's /app; otherwise run with the `$RUN` helper plus `-e LIGHTRAG_QDRANT_HOST`
settings.) Switch only if v3 does not lose any case that v2 passes and the new-law cases pass. The existing
`retrieval_golden.json` marks `fraud-penalty` as `corpus_gap`; the new file lists it as a normal case.

### Switch and rollback

The engine picks the collection from env `LIGHTRAG_QDRANT_COLLECTION` (default `iran_laws_v2`); `iran_laws_v3` is now in
`_COLLECTION_EMBEDDERS` as bge-m3 so the embedder guard accepts it. Citation guard has its own variable
`ROXIRA_CITATION_QDRANT_COLLECTION` (default `iran_laws_bge_m3`) and is switched separately only with approval.

```bash
# switch (needs owner approval + container restart/recreate)
set LIGHTRAG_QDRANT_COLLECTION=iran_laws_v3 in the server env file, then recreate roxira_app_prod
# rollback (v2 is untouched)
set LIGHTRAG_QDRANT_COLLECTION=iran_laws_v2 (or remove the variable), recreate roxira_app_prod
# discard v3 if wanted (owner decision): curl -X DELETE localhost:6333/collections/iran_laws_v3
```

## 6. Golden cases (TO-VERIFY by a lawyer)

`data/eval/chat_golden/retrieval_golden_new_laws.json`: 11 cases - constitution (اصل 22, 114, 167), ارتشاء/کلاهبرداری
(ماده 1, 3), cybercrime (729, 741), lease 1356 (14-15, 18/19/28), lease 1376 (2, 3). Expected to fail on v2 and pass on v3.
No golden cases for the four laws that were not fetched.

## 7. Recommendations

1. Lawyer sign-off on the 247 staged rows and the allowlist `proposed` entries; confirm instrument choices and the
   constitution source (secondary, wikisource copy of the Guardian Council text).
2. Fix v2 defects in v3 or a v4: cheque paraphrase points (27) and inactive art. 21 / 21 مکرر; web junk in Penal Code art. 728;
   39 duplicate keys in the Penal/CPC rows; chunk labels should be unique.
3. Fetch the 4 missing laws and Book 5 from rc.majlis.ir when TLS validates (or provide the files manually).
4. Re-check amendments after 1395-1399 for Penal Code, CPC and Commercial Code gaps 21-93.
5. Consider `source_tier: official` only after comparing to Rooznameh Rasmi.
