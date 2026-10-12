# Lawyer review gate: notes for the hub (English)

Companion to `docs/legal/LAWYER_REVIEW_GATE_FA.md` / `.html` (the sheet the lawyer sees; no technical text there).

## Status of the 70 gate questions (2026-10-12)

`data/eval/chat_golden/legal_gate_2026-10-12.json`: 63 `text_verified` (field `verified_by: "auto:article_text"`, optional
`verification_note`), 7 `needs_lawyer` (field `needs_lawyer_reason`). Check used: every `must_include` phrase and the quoted
article text appear in the staged/canonical article text after `legal_gate.norm`. `legal_gate.py validate` accepts both new
statuses; `lawyer_verified` / `lawyer_rejected` stay reserved for the lawyer.

`needs_lawyer` cases map to sheet items: item 4 -> lg-adm-19, lg-dsp-12; item 5 -> lg-l56-10, lg-l56-11, lg-l62-7;
item 6 -> lg-fam-22; item 7 -> lg-soc-76. All other sheet items come from the repo docs, not from the question file.

Judgement calls, kept as `text_verified` with a note: cyber-law cases (the 1403 fine adjustment is already in the article text,
only prison terms are required phrases); cheque cases (the 1397 law changes only arts 4, 5, 6, 21, 23, 24, so arts 12 and 13 are
untouched; the 1400 law changes only note 1 of art 21 bis); lg-l76-2 and the 1399/1400 amended criminal and smuggling articles
(corpus already holds the amended wording). Defect fixed: lg-cpr-346 asked about the first-instance reply period but article 346
is the appeal-stage period; the question text was reworded (field `question_fix`). Retrieval baseline numbers may move for this id.

## Marking the lawyer's answers

```bash
python3 - <<'PY'
import json
p = 'data/eval/chat_golden/legal_gate_2026-10-12.json'
d = json.load(open(p, encoding='utf-8'))
ok = {'lg-adm-19'}      # items answered "yes, as in the text"
no = set()              # items answered "no" (case dropped from scoring)
for c in d['cases']:
    if c['id'] in ok: c['status'] = 'lawyer_verified'
    if c['id'] in no: c['status'] = 'lawyer_rejected'
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
PY
python3 scripts/eval/legal_gate.py validate
```

If the lawyer supplies a different figure (items 4, 6, 7), fix the corpus or `must_include` first, then mark the case.

## Questions answered without the lawyer (with sources)

Rule: ekhtebar.ir or the repo corpus only. The ekhtebar pages were read on 2026-10-12 from the owner's Mac.

| Open question | Answer | Source |
| --- | --- | --- |
| L19 / round 2 Q1: is «لایحه اصلاحی قانون تجارت» in force | Yes, it is the 1347 amendment of the commercial code (legally part of قانون تجارت); not a bill. Separately `docs/LEGAL_COVERAGE_MANIFEST.md` says arts 51 and 53-71 were declared invalid by a 1403/11/15 law and should be removed; I did not re-verify that on ekhtebar | https://www.ekhtebar.ir/منابع-آزمون-وکالت-۱۴۰۵-کانونهای-وکلا/ (bar-exam syllabus lists «قانون اصلاح قسمتی از قانون تجارت ۱۳۴۷ و اصلاحات بعدی»); manifest |
| Round 2 Q2 / R-G: legal basis of «peace court up to 100 million toman» and whether it changes | Art 12 clause 1 of the 1402 dispute-council law: 1,000,000,000 rial; the head of the judiciary may adjust it every 3 years by the central-bank index (no new figure known; actual current figure goes to the lawyer, sheet item 4) | corpus row `قانون شوراهای حل اختلاف` art 12 (rc.majlis tier official) |
| Round 1 Q7: which articles of the civil execution law 1356 did law 1394 repeal | Explicit repeal only of the 1377 financial-sentences law, the 1313 insolvency (اعسار) law and art 524 of the civil procedure code. Implicit repeal of 1356 articles is a lawyer matter (sheet item 2) | corpus `قانون نحوه اجرای محکومیت‌های مالی` art 29 |
| Round 1 Q5 / round 2 Q5: courts law 1373 still used? | Yes, it is in the bar-exam syllabus for both civil and criminal procedure | same ekhtebar syllabus page |
| Round 1 Q6: add rent law 1362? | Lawyer already said all rent laws are needed (R-D). The syllabus lists 1356 and 1376; 1362 stays in the corpus. Which contracts each governs: sheet item 5 | syllabus page; LAWYER_ANSWERS R-D |
| Round 1 Q8: family law 1391 vs 1400 population law | Both laws are in the bar syllabus, so both are in force; article-level changes: sheet item 6 | syllabus page |
| Round 2 Q3: the 20 most-cited laws not yet in our list | Use the bar-exam syllabus list on the same page (civil: civil code, rent 1356/1376, family 1391/1400, civil liability, probate, pre-sale of buildings, third-party insurance, copyright; procedure: courts law, CPC, execution, financial sentences, dispute councils, administrative court, bar independence 1333 and licence law 1376, partition of co-owned land, judges' conduct supervision, notary offices 1322; commerce: commercial code, bankruptcy liquidation, company registration, cheque law, art 44 policies, e-commerce, securities market, certified accountants, domestic-goods support, permanent development-plan rules; criminal: penal code 1375-1392 incl. cyber law and the 1399 reduction law, bribery/embezzlement/fraud, transfer of others' property, collusion, anti-money-laundering, political crime, acid attacks 1398; criminal procedure: CrPC, courts law, citizen rights law) and diff it against `data/legal/coverage_manifest.json` | syllabus page |
| Round 2 Q4 / Q8: which laws are fully repealed; how to detect a repealed article | ekhtebar labels repealed laws in the title («[منسوخ]», e.g. civil procedure 1318, general penal law 1304); use that label plus `law_watch.py` | ekhtebar titles; ADR ekhtebar-sole-source |
| Round 2 Q6: reduction-of-imprisonment law 1399: separate or merged | Product choice, not legal: keep it as its own law (the syllabus lists it by name) and update affected penal-code text via law_watch | hub decision |
| Round 2 Q7: reference text of the registration law | «مصوب ۱۳۱۰ با اصلاحات بعدی» (syllabus wording) | syllabus page |
| Round 2 Q11: laws behind lawyers' / judges' disciplinary bodies (partial) | Lawyers: «لایحه قانونی استقلال کانون وکلای دادگستری ۱۳۳۳» and «قانون کیفیت اخذ پروانه وکالت ۱۳۷۶»; judges: «قانون نظارت بر رفتار قضات». Exact regulations not checked | syllabus page |
| Round 2 Q12-14, round 1 Q12: source and top rulings | Source: ekhtebar (ADR); it hosts «بانک آراء وحدت رویه دیوان‌عالی کشور (۱۳۲۳ تا ۱۴۰۴)» and the administrative-court rulings (e.g. no. 879 of 1405/4/9). Which ten are most used is not a legal question; start from the newest and from the ones cited by the jurisdiction rules (873). Binding force of administrative-court rulings not checked | ekhtebar |
| `config/jurisdiction_rules.yaml` `criminal_courts_1_2` (needs_lawyer) | Arts 301 and 302 of the CrPC are correct: 301 = court 2 has general jurisdiction, 302 = list for court 1 (death, life, ta'zir degree 3 and above, political and press crimes, ...). Could be set to `confirmed` | corpus `قانون آیین دادرسی کیفری` arts 301, 302 (dotic tier) |
| same file, `peace_court_appealable_over` | The 500,000,000 rial figure matches «claims above half the clause 1 nisab» in art 12; the interplay with art 368 and ruling 873 stays with the lawyer (item 3) | corpus art 12 |

Not touched by me: `config/jurisdiction_rules.yaml` itself, ADR status, anything outside docs/ and the gate files.

## Files changed

`data/eval/chat_golden/legal_gate_2026-10-12.json`, `scripts/eval/legal_gate.py`, `scripts/eval/tests/test_legal_gate.py`,
`docs/legal/LAWYER_REVIEW_GATE_FA.md`, `docs/legal/LAWYER_REVIEW_GATE_FA.html`, this file.
`docs/ops/DEPLOY_LOCAL.md` still mentions the old status wording (not edited).

## Lawyer answers of 2026-10-13 (sheet items 1-9) and how they are applied

Item 10 (law-watch approvals) is unanswered and stays open. Status counts in the question file after this change:
5 `lawyer_verified` (field `lawyer_answer`, `lawyer_answered_at`), `lg-soc-76` and `lg-adm-19` still `needs_lawyer`.
`legal_gate.py validate` now requires a `lawyer_answer` on every `lawyer_verified` case.

| Item | Answer | Applied as |
| --- | --- | --- |
| 1 source | ekhtebar accepted, labelled unofficial | ADR `ADR-2026-10-12-ekhtebar-sole-source.md` set to accepted; nezamat.ir recorded as second owner-approved source (owner, 2026-10-13) |
| 2 implicit repeal | keep the article, show a warning | corpus payload field `repeal_status: "implicit_contested"` (carried by `lightrag_engine._payload_to_row`, kept in `statutory_basis` by `chat_fast._KEEP_FIELDS`); `legal_notes.finalize_reply` appends `REPEAL_WARNING_FA` when a displayed row has it. No row carries the flag yet: set it at ingest for the articles the lawyer names (the lawyer gave no list). `is_active: false` (explicit repeal) still excludes a row |
| 3 appeal / cassation | old 3M (art 331) and 20M (art 367) rial thresholds changed with the 1402 law; above 100M toman the general civil court is competent | `config/jurisdiction_rules.yaml`: `civil_appeal_nisab`, `civil_cassation_nisab` -> `superseded` (new allowed status in `jurisdiction_rules.py`, never used for suggestions). `peace_court_appealable_over` stays `needs_lawyer` (the answer gives no appealability figure) |
| 4 adjustable numbers | peace-court ceiling is 1,000,000,000 rials now | `peace_court_monetary` stays `confirmed`, note updated; `lg-dsp-12` -> `lawyer_verified`. The administrative-court fee part of item 4 (`lg-adm-19`) was not covered by the answer as relayed: left `needs_lawyer` |
| 5 rent laws | each of 1356/1362/1376 governs places within its own scope; picking one is a legal judgment | `legal_notes.LEASE_ADDENDUM` (prompt) + `lease_reply_ok` check + fixed `LEASE_NOTICE_FA` appended when the reply lacks the "depends on contract date and type" statement; `lg-l56-10`, `lg-l56-11`, `lg-l62-7` -> `lawyer_verified` (article text is correct for its own law) |
| 6 mahr | art 22 (110 coins) in force and relevant only to imprisonment; paying 110 coins ends prison for the rest; unpaid instalments within the 110 keep imprisonment | prompt fact `legal_notes.MAHR_FACT`, injected when the question is about mahr or coins plus imprisonment; `lg-fam-22` -> `lawyer_verified`. Chosen over a corpus note row because a note is not a statute (must not enter statutory_basis or the citation guard), a row needs a Qdrant re-embed and only surfaces by chance, while a trigger-based fact is deterministic and testable offline |
| 7 social security art 76 | no definite answer | `lg-soc-76` stays `needs_lawyer` (field `lawyer_note`); retirement/pension questions get `SOCIAL_SECURITY_DISCLAIMER_FA` (check with the social security organisation) |
| 8 lawyer verification | verify the licence on the bar association (کانون وکلا) site; free subscription for lawyers is legally fine — OWNER DECISION 2026-10-13: lawyers pay like everyone; only collaborating lawyers get owner-granted access | see below |
| 9 privacy and terms | the lawyer reviews only the ambiguous items | see below |

Limits: the fixed lines are appended to the final `reply` of `/consult` and `/chat` (the non-streamed final body and the stored
message); tokens already streamed are not rewritten. Other answer paths (fast path, early returns, voice) are not covered.
The lease check is a marker check (reply must mention dependence on date and type of contract); it cannot detect a reply that
wrongly asserts one law, which is why the prompt forbids it and the notice is appended whenever the marker is missing.

### Lawyer onboarding (item 8)

Sign-ups on `/lawyers` are stored by `POST /api/v1/apps/judge/lawyers/pilot-onboarding` as `PENDING_REVIEW` (KV key
`lawyer_pilot:req:<id>`, 90 days). Nothing is granted automatically; the page copy now says so. Owner flow:
1. Look up the licence number on the bar association site (کانون وکلا).
2. If valid, grant VIP to the phone: `scripts/ops/grant_lawyer_vip.sh 09xxxxxxxxx` (dry run), then add `--apply`
   (`--days N`, default 30; `--revoke` ends it). It upserts `user_entitlements` (the table `_entitlement_tier` reads), key
   `sha256("smartjudge:<phone>")[:16]`, over ssh, no restart. The other VIP mechanism, env `VIP_PHONE_ALLOWLIST`, needs a
   container restart and is not used for this.
3. Tell the lawyer by phone/SMS. Unverified requests are simply left to expire.
Not tested against the production database (needs the owner's ssh); the dry run was checked locally. The script assumes the
Postgres container (`roxira_postgres_prod`) has `POSTGRES_USER` and `POSTGRES_DB` in its environment.

### Privacy and terms (item 9)

Per the lawyer, only the ambiguous items of the privacy and terms pages go to her/him for review; the rest (processors named,
SMS provider, payment gateway, 7-day file retention) is published as drafted. When editing those pages, list the ambiguous
clauses in the PR description so they can be sent as a short sheet.
