# Platform capability assessment (2026-10-03)

Question from the owner: is Smart Judge (ghazihoushmand.ir) complete, can it prepare a full draft ruling from the parties' documents in civil and criminal courts, which sites are live, and is the agentic CRM built. Facts below were read from the code, the production Qdrant (read-only) and public URLs on 2026-10-03. Anything not measured is marked UNVERIFIED.

## 1. Sites

| Site | What is live | Reality |
| --- | --- | --- |
| https://ghazihoushmand.ir | Smart Judge: chat (`/chat`, `/chat-stream`, `/consult`, `/query`), document analysis (`/analyze-document-text`, `/documents/analyze-ocr`, `/documents/convert`), defense document generation (`/defense/generate-document`, `/export-defense-document`, `/drafts/template`), damages calculators, citation verification (`/citations/verify`), retrial evaluation, voice (STT/TTS/telephony), Zibal payments, SMS OTP login | Works for what it is: a Persian legal assistant. Public pages 200, chat answered an appeal-deadline question correctly (art. 336 civil procedure). `/damages` redirects to roxira.ir by design |
| https://roxira.ir (roxira.net redirects here) | Roxira OS portal: pages for accounting, crm, hr, inventory, invoicing, radar, mission-control all return 200 | The pages exist; the backends are skeletons. Production tables `crm_leads` and `contact_messages` hold 0 rows; accounting has a double-entry entity skeleton (chart of accounts, journal entries and lines) with unverified invariants; there is no agent code touching customers |
| Twenty CRM (server only) | v2.41 container, bound to 127.0.0.1:3002, empty | Not used; compose hardening is in PR #422 (owner applies on the server) |
| roxirad.ir, roxirad.net, roxira.com | no DNS | not ours / unused |

## 2. Can Smart Judge draft a ruling (دادنامه)?

Short answer: **it should not, and today it cannot do so reliably.**

- By design: the system prompt in `smartjudge_module.py` says the assistant is not a judicial authority and must never present itself as issuing a ruling. That is the right product position and also protects users: a generated "ruling" is not a court decision and would mislead.
- What it can do now: ingest a user's text or scanned documents (OCR), analyse them, cite articles from its corpus, and draft a lawyer-side defense document or a template with citation verification. It is useful for lawyers and for self-represented parties to prepare, not to decide.
- Why a full civil or criminal draft ruling is not trustworthy yet (measured): the served corpus is 5,103 article rows from 8 laws (civil code, commerce, criminal procedure, Islamic penal code, ...), 6 judicial precedents, 250 circulars and 0 advisory opinions. Civil procedure, dispute-council and several procedural laws are only partially covered, unification rulings are missing, and 12 commerce-code articles that were declared invalid are still served. There is no case-level evaluation: the existing eval checks article lookup, not whether a drafted outcome is correct.
- Courts: no evidence of good performance in criminal or civil courts exists in the repo. Treat any claim of that kind as UNVERIFIED until an expert-labelled eval proves it.

## 3. Plan (workstream J1, all behind human review)

1. Position the feature as "analysis and draft for a lawyer or judge to review", with the disclaimer already shipped (#386). Never auto-send or auto-file.
2. Structured pipeline: facts extraction from documents, issue spotting, statutory mapping, draft, **automatic citation verification** (reuse `/citations/verify` and the new `scripts/ci/verify_faq_citations.py` idea), each claim linked to a corpus row; refuse when the corpus has no basis.
3. Corpus first: ingest the 17 staged official laws (owner yes), remove invalid articles, add `source_tier`, then unification rulings and more precedents; wire `config/jurisdiction_rules.yaml` after the lawyer answers.
4. Evaluation before claims: 50 to 100 expert-labelled cases per court type (civil, criminal), scored on citation validity and on outcome agreement by a lawyer; publish the numbers internally; release per court type only when the thresholds are met.
5. Safety: tenant isolation on retrieval, prompt-injection handling for uploaded documents, no case data in logs, no `:free` models for case data (already a hard rule).

## 4. Agentic CRM

Not built. Decision (see `COMPOSABLE_CRM_ACCOUNTING_2026-10.md`): hybrid, `CrmPort` over Twenty (after a one-day Persian/RTL/Jalali spike) or the hub CRM, our own agent layer, a deterministic ledger service that agents can only propose to. In flight: tenant isolation and auth guard for the hub CRM (#369), model gateway that blocks customer data from the free lane (#368), hub accounting audit (#396).

## 5. What changed in this audit round (honest list of misses found)

Legacy unauthenticated payment routes, prod JWT secret equal to a public default, client-side admin passcode, fake success probability, no disclaimer, red daily E2E for 5 days, `/health` leaking module names, merge automation never firing (rx wrapper defined after use, skipped required checks, `pull_request` events missing for bot PRs), CI blind to markdown-only pushes, and an empty-string env var that took the OTP router down after a compose change. All are fixed or have an open PR (see `docs/STATE.md`).
