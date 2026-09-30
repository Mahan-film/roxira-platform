# W25 Phase 1 acquisition plan (2026-09-30)

Scope: the Phase 1 laws of `docs/LEGAL_COVERAGE_ROADMAP.md`. Result: **no official full text could be fetched from this
environment, so no pilot JSONL was produced** (rule: no invented or unofficial text). URLs below come from web-search
results only; titles and dates are UNVERIFIED until the page is opened on the owner's Mac.

## Reachability probe (from the agent sandbox, 2026-09-30)

| Site | Result |
| --- | --- |
| rc.majlis.ir | TLS handshake reset (curl 35), WebFetch "socket closed" (likely geo/IP block) |
| dotic.ir | HTTP 403 (curl and WebFetch); `/print/5580` timed out |
| rrk.ir | connection failed |
| qavanin.ir | HTTP 200 but only a "transferring to the site" stub page (no law text) |

## Laws

Status "ready to fetch" = official URL found by search, text not retrieved. Expected articles: not verified (fill in after fetch;
the ingest dry-run reports the count). Approval dates marked (?) are from search snippets or memory and need confirming on the page.

| Law | Approval date | Candidate official URL | Official | Reachable | Expected arts | Status |
| --- | --- | --- | --- | --- | --- | --- |
| قانون تشکیل دادگاه‌های عمومی و انقلاب | 1373 (?) | rc.majlis.ir/fa/law/show/90416 ; amending law show/93837 | yes (RC) | no | ? | ready to fetch (two texts: base + amendments; consolidated text needed) |
| قانون اجرای احکام مدنی | 1356/08/01 | rc.majlis.ir/fa/law/show/97591 ; qavanin.ir/Law/TreeText/83430 | yes | no | ? | ready to fetch |
| قانون نحوه اجرای محکومیت‌های مالی | 1394 | rc.majlis.ir/fa/law/show/932384 (also show/93165) ; rrk.ir/Laws/ShowLaw.aspx?Code=5133 | yes | no | ? | ready to fetch (two RC ids, pick the consolidated one) |
| قانون کاهش مجازات حبس تعزیری | 1399/02/23 | rc.majlis.ir/fa/law/show/1554540 ; rrk.ir/Laws/ShowLaw.aspx?Code=22056 ; dotic.ir/news/7057 | yes | no | ? | ready to fetch |
| قانون مسئولیت مدنی | 1339/02/07 | rc.majlis.ir/fa/law/show/95202 | yes | no | ? (about 16, unverified) | ready to fetch |
| قانون ثبت اسناد و املاک | 1310 (?) | rc.majlis.ir/fa/law/show/91802 ; qavanin.ir TreeText IDS=10904323794258146747 (with amendments) | yes | no | ? | ready to fetch (many amending laws, e.g. show/96882, 90478) |
| قانون روابط موجر و مستأجر 1356 | 1356 | rc.majlis.ir/fa/law/show/97570 | yes | no | ? | ready to fetch |
| قانون روابط موجر و مستأجر 1376 | 1376 | not identified (search returned 1356, 1362 versions; RC show/92943 is unlabelled) | - | no | ? | blocked: correct RC id not identified |
| قانون حمایت خانواده 1391 | 1391 | rc.majlis.ir/fa/law/show/840814 | yes | no | ? | ready to fetch (RC show/96054 is a different, older law: do not use) |
| قانون کار | 1369 (?) | rc.majlis.ir/fa/law/show/99612 | yes | no | ? | ready to fetch |
| قانون تأمین اجتماعی | 1354 (?) | not identified (search returned only regulations) | - | no | ? | blocked: main law URL not identified |

Any text from ekhtebar.ir, irost.org, wikihoghoogh.net or similar is UNOFFICIAL and was not used.

## Pilot

Not run: zero laws fetched in full. Nothing was written to `data/raw/phase1/` or `data/legal/`.
Measured counts: 0 articles, 0 gaps (no data). Ingest behaviour read from `scripts/w6_ingest_dotic.py`:
`build_records_from_file` splits on "ماده N" headings, sets `source="owner-supplied file"`, and takes `--source-url` and
`--approval-date` from the CLI (both default to `owner-supplied` / null, so they MUST be passed). Chapter and amended_on are
derived from the text. `--dry-run` with `--build` prints per-law point counts and `missing numbers in range` and writes nothing.

## Commands to run on the owner's Mac (per law)

    mkdir -p data/raw/phase1
    # save the official print page (RC "print_version" or rrk/qavanin print view) as .html or .txt
    curl -L -A "Mozilla/5.0" -o data/raw/phase1/<slug>.html "<official url>"
    python3 scripts/w6_ingest_dotic.py --file data/raw/phase1/<slug>.html \
      --law-name "<exact title>" --law-type <PROCEDURE|CIVIL|CRIMINAL|LABOR> \
      --source-url "<official url>" --approval-date <YYYY-MM-DD Jalali> \
      --build data/legal/phase1_pilot_2026-09-30.jsonl --append --dry-run

Then drop `--dry-run` to write JSONL (still no `--upsert`). Check: article count vs the page, gap list, non-null
`source_url` and `approval_date` on every record. Note `.html` input uses `soup.get_text` on the whole page, so trim menus first
or save only the law body as `.txt`.

## Open questions for a licensed lawyer

1. Which text is in force for each law: base text plus amending laws, or the RC/qavanin "with later amendments" consolidation?
2. Courts law: is the 1373 law with the 1381 and later amendments still applicable after the 1392 criminal procedure code?
3. Rent: which of the 1356, 1362 and 1376 rent laws apply to which leases; should the 1362 law be added?
4. Civil execution: how do the 1356 law and the 1394 financial-sentence law interact (repealed articles)?
5. Social security: which law text is canonical (1354 with amendments), and are regulations in scope for this phase?
6. Family protection: 1391 law vs the newer population and youth support law: which articles are repealed?
7. Should repealed articles be stored with `is_active=false` or omitted?
