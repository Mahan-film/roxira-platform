# Missing laws: Direct Taxes Act 1366 (consolidated) and the 1403 guild amendment

Workstream 1 of `docs/STATE.md`. Status 2026-10-22: **tooling ready, text not fetched yet**.

## Why nothing was fetched from the cloud session

The cloud session that built this could not reach any source. Every host below was refused by the
session's network policy (proxy `CONNECT` 403), and the web-fetch tool could not resolve them either:
`rc.majlis.ir`, `dotic.ir`, `www.ekhtebar.ir` / `www.ekhtebar.com`, `www.tax.gov.ir`,
`www.intamedia.ir`, `regulation.tax.gov.ir`, `www.nezamat.ir`, `fa.wikisource.org`, `web.archive.org`.
So **no law text is in this PR**. Text, ids and dates must come from the owner's Mac (Iranian IP).
None of the identifiers below for the 1403 amendment are verified; they are leads.

## What exists now

| Piece | What it does |
|---|---|
| `scripts/legal/stage_consolidated_law.py` | `stage`: picks the consolidated text, adds per-article provenance, validates, writes a NEW file + `.md` report. `validate`: re-checks a staged file. |
| `config/legal_consolidation/direct_taxes_1366.json` | spec: names, 1366/12/03, 250–330 articles, articles 1…281 continuous, spot checks (art. 131 must have the 15 % / 20 % / 25 % brackets of the 1394 amendment; art. 105 must have 25 %). |
| `config/legal_consolidation/guild_amendment_1403.json` | spec: same title as the 1392 amendment, so only rows dated 1403 are taken; staged as «قانون اصلاح قانون نظام صنفی کشور مصوب 1403»; spot checks: an item amends art. 12 (business-licensing facilitation reference) and an item rewrites art. 27. |
| `scripts/legal/tests/test_stage_consolidated_law.py` | offline tests on synthetic fixtures. |

The Mac relay (`ir.roxira.iranrelay`, `config/iran_relay.json`) is **not changed**: the owner asked that the
operator agents/bots are not touched for now. The URLs it (or the owner by hand) should fetch are listed below.

### Per-article provenance (every staged row)

`source_url`, `source_tier` (ekhtebar = `unofficial`, rc.majlis = `official`), `text_sha256`, and
`consolidation`: `text_source`, `text_source_url`, `retrieved_at`, `source_modified`,
`official_base_url`, `matches_official_base` (text equal to the rc.majlis original?),
`crosscheck_source_url` / `matches_crosscheck`, `amendment_markers` (e.g. «اصلاحی 1394/04/31»
parsed from the text) and `amended_by` (amending rc.majlis laws whose date matches a marker).
`review_reasons` adds `differs_from_original_official_text` / `crosscheck_mismatch`. All rows are
`staging_status: proposed`, `needs_review: true`.

### Validation (refuses to write on failure unless `--allow-invalid`)

Article count range, first/last article, numbering continuity (a gap is only a warning when the
official base text has that article, i.e. probably repealed; otherwise an error), duplicate
articles, and the spec's spot checks. With only the rc.majlis original as input, direct taxes
**fails** on art. 131 — that is the point.

## Sources

### Direct Taxes Act 1366 (قانون مالیات‌های مستقیم مصوب ۱۳۶۶/۱۲/۰۳)

| Role | URL | Fetch from |
|---|---|---|
| consolidated text (owner-trusted, unofficial) | ekhtebar.ir post «قانون مالیات‌های مستقیم» with latest amendments; found by `ekhtebar_api.py search` (REST `https://www.ekhtebar.com/wp-json/wp/v2/posts?search=…`); tag page `https://www.ekhtebar.ir/tag/مالیات-مستقیم/` | Mac (or srv1 if ekhtebar answers there) |
| official original | `https://rc.majlis.ir/fa/law/show/91488` (original only; art. 131 has the pre-1394 rates) | Mac; do NOT add to `rc_law_ids` (relay rows reach v7 and it would be served as current law) |
| official amending laws | rc.majlis.ir search `https://rc.majlis.ir/fa/law/search?keyword=قانون مالیات‌های مستقیم` (titles with «قانون اصلاح/الحاق/حذف» that name «مالیات‌های مستقیم»). Known amendments to look for: 1371/02/07, 1380/11/27, 1394/04/31; later single-article amendments if any. | Mac (search page lists the ids; then `https://rc.majlis.ir/fa/law/show/<id>`) |
| authoritative consolidated (to try) | intamedia.ir / tax.gov.ir «قانون مالیات‌های مستقیم با آخرین اصلاحات» PDF; dotic.ir «مجموعه تنقیحی» if published | Mac, by hand (not automated: URLs unknown) |

Not consolidated into article text: one-year rate changes in the annual budget laws (1400–1403,
e.g. the wage-tax exemption; a secondary site says the 1405 art. 131 table comes from cabinet decree
15750, unverified). Those stay separate documents (regulations collection) and must not overwrite
article text.

### 1403 guild amendment (قانون اصلاح قانون نظام صنفی کشور، ۱۴۰۳)

Leads from web search (secondary sources, unverified): amends art. 12 of the 1382 law (adds
«در چهارچوب قانون تسهیل صدور مجوزهای کسب و کار مصوب ۱۴۰۰/۱۲/۲۴»), rewrites art. 27 (fine and
sealing for trading without a licence; no grace period for approval-based licences); sources
disagree on the approval date (1403/05/29 vs in force from 1403/05/24) and on the number of one
added note (تبصره ۶ vs ۷). The official rc.majlis id, gazette number and notification number
(شماره ابلاغ) are **unknown**. To find them from an Iranian IP:
`https://rc.majlis.ir/fa/law/search?keyword=نظام صنفی` (look for a «قانون اصلاح …» title dated 1403;
94011 is the 1382 law, 866380 the 1392 amendment), then `https://rc.majlis.ir/fa/law/show/<id>`.
ekhtebar: `https://www.ekhtebar.com/wp-json/wp/v2/posts?search=اصلاح قانون نظام صنفی` (check the post's
approval date: the 1392 amendment has the same title).

## Runbook (owner's Mac, VPN OFF; the hub can do steps 3–4 anywhere)

```bash
cd ~/Developer/roxira-platform
# 1. official rc.majlis rows (base 91488, amending laws, 1403 guild amendment): only once the owner
#    allows relay changes again, by adding the ids found on the search pages above to a copy of the
#    relay config. Without them, step 3 still works on the ekhtebar text alone (no official
#    cross-check; repealed-article gaps then need --allow-invalid and a manual check).
# 2. ekhtebar consolidated direct taxes text (new staged file, never overwrites)
python3 scripts/legal/ekhtebar_api.py search "قانون مالیات‌های مستقیم"
# 3. consolidate + validate (dry run first)
python3 scripts/legal/stage_consolidated_law.py stage --dry-run \
  --spec config/legal_consolidation/direct_taxes_1366.json \
  --input data/legal/staged/ekhtebar_api_search_<date>.jsonl \
  --input data/legal/staged/iran_relay_<date>.jsonl
#    if several ekhtebar posts match, pin the right one with --source-url <post url>
python3 scripts/legal/stage_consolidated_law.py stage \
  --spec config/legal_consolidation/direct_taxes_1366.json \
  --input data/legal/staged/ekhtebar_api_search_<date>.jsonl \
  --input data/legal/staged/iran_relay_<date>.jsonl \
  --out data/legal/staged/consolidated_direct_taxes_1366_<date>.jsonl
# 4. guild 1403 (rc.majlis first, ekhtebar as cross-check)
python3 scripts/legal/stage_consolidated_law.py stage \
  --spec config/legal_consolidation/guild_amendment_1403.json \
  --input data/legal/staged/iran_relay_<date>.jsonl \
  --out data/legal/staged/consolidated_guild_amendment_1403_<date>.jsonl
```

Then: read the `.md` report, confirm the "probably repealed" articles and every
`matches_official_base: false` article against the amending laws, fill the verified 1403 ids/dates
into `config/legal_consolidation/guild_amendment_1403.json`, and open a data PR. A lawyer review is
still required before the rows enter a served collection (the `consolidated_*` files are not in
`build_v7.py`'s staged globs on purpose; add them explicitly with `--files` once reviewed).

**Caution for the v7 build:** `iran_relay_*.jsonl` IS in `build_v7.py`'s globs, so any whole-law rc row
the relay stages (amending laws, the 1403 guild amendment) reaches v7 as-is. The 1403 amendment
has the same title as the 1392 one (rc 866380): relabel or exclude it there until the
`consolidated_guild_amendment_1403_*` file is reviewed.
