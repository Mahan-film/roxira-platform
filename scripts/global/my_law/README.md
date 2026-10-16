# Malaysian Acts pilot (global product G2) — INTERNAL EVALUATION ONLY

Citation-checked legal research for Malaysian lawyers. This directory builds a small test
collection from 20 official Acts so we can measure retrieval quality. Nothing built here may
be shown to customers, sold, or served from a public endpoint.

## The rule

- **Internal evaluation only** until the Attorney General's Chambers (AGC) grants written
  permission to store, reuse and sell the Acts with attribution (draft request:
  `docs/owner/AGC_PERMISSION_REQUEST_DRAFT.md`; background:
  `docs/research/global/2026-10-16_malaysia_legislation_reuse.md`).
- Source: the official Laws of Malaysia portal (https://lom.agc.gov.my/) only. Prefer reprinted
  (revised) texts; never present an "updated text" as authentic.
- Never bypass any site protection: no captcha solving, no proxies, no header tricks. A 403 or a
  challenge page ends the run (`fetch_acts.py` exits with code 3). The hub decides what happens next.
- Never use CLJ, LexisNexis or Lawnet material (headnotes, annotations, case summaries).
- The hub reads and archives the portal terms before the first fetch. Contact for the
  User-Agent comes from env `ROXIRA_FETCH_CONTACT` (never hard-coded).
- Data lives on the global server under `/var/lib/roxira-global/my_law/` (outside the repo and
  not committed): `raw/` (PDFs + `manifest.json` with sha256, fetch date, source URL) and `parsed/`.

## Files

| File | Purpose |
| --- | --- |
| `acts.yaml` | the 20 pilot Acts (`url: null` until the hub fills them in) |
| `allowlist_my_law.json` | Act titles for the ingest pipeline's allowlist gate |
| `fetch_acts.py` | polite fetcher (robots.txt, 1 request / 10 s, stops on challenge) |
| `parse_act.py` | PDF -> section rows (`pdftotext -layout`, needs poppler) |
| `golden_my_law.json` | 25 DRAFT retrieval questions |
| `tests/test_my_law.py` | offline tests, synthetic text only |

## Run order on the server

Run from `/opt/roxira_platform` (or the global server's checkout). Check ports with
`ss -tulnp | grep <port>` before starting anything new.

```bash
# 0. hub: read the portal terms, fill `url:` in acts.yaml
export ROXIRA_FETCH_CONTACT="contact@example.org"      # real contact, from the hub

# 1. fetch (dry run first; default refuses if robots.txt is disallowed or unreadable)
python3 scripts/global/my_law/fetch_acts.py --dry-run
python3 scripts/global/my_law/fetch_acts.py            # add --robots-unreadable-ok only on hub decision

# 2. parse every PDF in the manifest
python3 scripts/global/my_law/parse_act.py             # writes parsed/my_law_sections.jsonl

# 3. validate (counts only; local Qdrant gates)
python3 scripts/legal/ingest_pipeline.py validate /var/lib/roxira-global/my_law/parsed/my_law_sections.jsonl \
  --allowlist scripts/global/my_law/allowlist_my_law.json

# 4. build collection my_laws_eval_v1 (bge-m3 via TEI; local Qdrant, new collection only)
export EMBEDDING_URL=...                                # the shared TEI service, from the environment
python3 scripts/legal/ingest_pipeline.py apply /var/lib/roxira-global/my_law/parsed/my_law_sections.jsonl \
  --qdrant http://127.0.0.1:6333 --collection my_laws_eval_v1 \
  --allowlist scripts/global/my_law/allowlist_my_law.json

# 5. eval (the retrieval engine must read my_laws_eval_v1; see lightrag_engine QDRANT_FALLBACK_COLLECTION)
python3 scripts/eval_chat_golden.py --retrieval-only \
  --retrieval-set scripts/global/my_law/golden_my_law.json
```

Parser stats (sections, rows, skipped "Repealed" sections, rejected numbering) are printed per
Act; compare section counts with the Act's arrangement of sections before trusting a result.

## Row format notes

- `article_no` is the section number with the letter suffix lower-cased after a hyphen
  (`12A` -> `12-a`) because the pipeline's `ARTICLE_NO_RE` and the golden matcher use that form.
  `article_label` stays `Section 12A`.
- Long sections are split into chunks of at most 1800 characters. Every chunk repeats the
  `Section N <Act title>: <heading> — ` prefix; chunks after the first are labelled
  `Section N (part 2)` so the duplicate gate keeps them unique.
- Schedules and lists of amendments are not parsed yet.

## Gate to production

All of these, in writing, before any customer-facing use:

1. AGC written permission (storage, reuse, commercial resale, attribution wording).
2. A Malaysian lawyer spot-checks a sample of parsed sections per Act against the official
   text, and verifies every question in `golden_my_law.json` (they are DRAFT).
3. Currency disclaimer (reprint date) shown with every answer; "not authentic text" wording
   reviewed by that lawyer.
4. Judgments stay out until the judgments portal's reuse terms are confirmed.
5. Owner approval, then a reviewed PR for the production collection. No direct production writes.
