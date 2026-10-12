# ADR 2026-10-12: ekhtebar.ir is the sole legal source (unofficial tier)

Status: proposed (stays proposed until the owner and the lawyer both acknowledge it)
Date: 2026-10-12
Deciders: owner (decision given 2026-10-12); lawyer acknowledgement pending

## Context

The product answers legal questions from a corpus of Iranian statutes. The lawyer's answers of
2026-09-30 (docs/LAWYER_ANSWERS_2026-09-30.md, rule R-B) say: serve only official sources, the
Official Gazette (rrk.ir) and the Parliament Research Center (rc.majlis.ir); `source_tier` must be
`official` for anything served; ekhtebar.ir is a locator only.

On 2026-10-12 the owner decided that ekhtebar.ir is the only legal source. It is reachable only
from Iranian IPs, so fetchers and `law_watch.py` run on the owner's Mac. Corpus rows fetched from
it carry `source_tier: "unofficial"`.

The code also held two open-web search paths (`_fetch_live_legal_web_fallback`,
`_execute_parallel_legal_discovery`, using SearXNG). They were never called and contradicted this
policy. They are deleted in this change.

## Decision

1. ekhtebar.ir is the single source of statute text served to users.
2. All of that text is labelled `unofficial` tier until a lawyer signs off per law.
3. No open-web legal search in the product (no SearXNG or other web fallback in answer paths).
4. This knowingly departs from lawyer rule R-B.

## Trade-off against R-B

Gain: one fetchable, consistently structured source with amendment history; no dependence on
sources that are hard to scrape or not reachable; coverage now rather than after months of
re-fetching from rc.majlis.ir.

Cost: ekhtebar.ir is a private compiler, not the legal authority. Text can contain transcription
errors or lag behind amendments. A user could rely on a wrong article. This is a real legal and
reputational risk, and the lawyer has said it is not acceptable without a recorded decision.

## Mitigations

- Every chat answer payload carries `source_disclosure: {"source": "ekhtebar.ir", "tier": "unofficial"}`
  next to `statutory_basis`, so the UI can show the tier. No prompt change.
- The existing AI/legal disclaimer stays on all answers and drafts.
- Citation guard verifies that cited articles exist in the corpus.
- Lawyer review list: laws are promoted from `unofficial` to `official` one by one, after the
  lawyer compares them with rc.majlis.ir or rrk.ir.
- The three laws the lawyer named (civil procedure, dispute-resolution councils 1402, cheque law)
  are first on that list.

## Follow-ups (not in this change)

- Show the tier in the UI sources block and the coverage page (frontend).
- Add the one-line source/tier text to `source_filter.select_displayed` output if the UI needs it.
- Lawyer and owner acknowledge this ADR; then change status to accepted, or revert to R-B.
