# R25 digest: realtime multilingual legal RAG and citation graph (2026-11-21)

Source: owner-run deep research, stage 1 plus stage 2. Extends R18 (Smart Judge v2); where they
differ, R18 rows already in flight keep priority. Everything marked "requires primary check".

## Proposed decisions (kept apart from facts)
1. At tens of thousands of chunks, spend latency where precision needs it: provision-level chunks
   tagged with stable ids, dense + BM25 hybrid fused by RRF, a fast reranker capped near 250 ms p95,
   1-hop citation expansion in an indexed Postgres edge table, calibrated abstention.
2. Skip in the hot path: agentic or multi-hop loops, a graph database, lossy vector quantization.
3. Realtime law updates: Postgres is the bitemporal system of record; Qdrant is a derived store fed
   by a transactional outbox with idempotent workers and a nightly reconciliation (Postgres wins).
   Versioned collections plus an alias swap are only for embedding-model or chunking changes.
4. Two Qdrant collections: public law, and tenant documents (tenant key indexed, tenant-scoped sparse
   statistics). Qdrant JWT does not enforce payload filters in 1.16+, so isolation is enforced in our
   retrieval layer plus Postgres RLS on text hydration.
5. Six cross-tenant leak tests run in CI on every retrieval change.
6. Evaluation: lawyer-reviewed golden set split into dev, calibration and sealed holdout; cheap
   deterministic per-PR gates; nightly LLM-judged run with a pinned cross-family judge; a paired
   voice subset reporting the clean-text versus transcript recall gap.
7. Stage 2 corrections: PostgreSQL 19 native graph queries are not in the GA release, so keep plain
   edge tables; embeddings of customer text may count as personal data (EDPB opinion 28/2024), so
   crypto-shredding the text is not enough; purge or drop the vectors too.

## Conflict with an owner decision (needs the owner)
Stage 2 recommends no free-tier routing in production. Owner decisions 2026-10-14 and 2026-11-16
say free models first for all data, with a paid "private data option". The hub keeps the owner rule.
The hub adds one guard for the owner to approve: tenant-document queries of a tenant on the private
option never touch free tiers.

## Risks to confirm with an expert
If German law firms become tenants: professional-secrecy rules (BRAO 43e, StGB 203) need vendor
agreements and no human review of logs. Whether the product counts as high-risk under the EU AI Act
for the administration of justice (deferred to 2027-12-02 per R26).

## Dates and prices
Gemini 3.8 Flash paid price is reported to double on 2027-01-01; this matches the R12 "recheck
before 1 Jan 2027" row. No model id changes outside `config/models.yaml`.

## Not verified
All latency numbers are modelled or US-based medians; EU p95 must be measured under load.
Vendor prices, free-tier limits and the Qdrant tenant-promotion heuristics are unverified.

## Second opinion (Gemini Deep Research, 2026-11-22)

Saved unchanged in `R25_GEMINI.md` (Stage 1 and Stage 2, both present). This section does not replace anything above. Rule used: where the two sides conflict, the claim with a primary URL and a date wins; everything else is UNVERIFIED until a lane reads the page. There is no `R25_RAW.md` in the repo, so "digest only" below means "not in this digest's visible text"; independence of the two runs is not established (the headline decisions match closely).

### Agreements
- Scale 10k-100k chunks: provision-level bitemporal chunks, dense + BM25 hybrid, a fast reranker near 250 ms p95, 1-hop citation expansion in an indexed Postgres edge table, calibrated abstention; no graph database, no agentic loop, no lossy quantization in the hot path.
- Postgres is the system of record; Qdrant is fed by a transactional outbox; versioned collections plus alias swap only for embedding or chunking changes.
- Two collections (public law, tenant documents) with tenant key; payload filters are no longer enforced by Qdrant JWT from 1.16 (Gemini cites Qdrant issues #7450/#8015), so isolation sits in our layer plus Postgres RLS; six cross-tenant leak tests in CI.
- PostgreSQL 19 native graph queries are not usable (Gemini cites the PG 19 beta 4 notice of 2026-09-24 and the open-items page; GA 2026-11-19). Use plain edge tables.
- Embeddings of customer text can be personal data (EDPB Opinion 28/2024, 2024-12-18, URL given by Gemini); shredding the text key is not enough.
- Gemini 3.8 Flash paid price doubles on 2027-01-01 (Gemini read the vendor pricing page, 2026-11).
- Latency figures are modelled or US medians; EU p95 must be measured.
- German professional secrecy (BRAO 43e, StGB 203) matters if law firms are tenants; AI Act high-risk date 2027-12-02 (same as R26).

### Conflicts (resolved by primary URL and date, else UNVERIFIED)
| Topic | This digest | Gemini | Verdict |
|---|---|---|---|
| Free-tier routing in production | Owner rule stands (free first); guard: private-option tenants never on free tiers | Stage 1: free only for zero-personal-data public-law queries; Stage 2: drop free tiers in production (paid EU cost EUR 5-60/month at 10k-100k queries) | Owner decision, not a fact conflict. See owner decisions. |
| Free-tier privacy | Not stated | One free-tier provider keeps inputs and outputs up to 30 days unless zero retention is enabled (vendor docs, 2026); Google free terms in EEA match paid no-training terms but are not zero retention | Gemini has URLs; treat as indicative, lane must re-read the pages before relying on it. |
| Crypto-shredding | Purge or drop the vectors too | Same, and adds WAL, snapshots and tombstones; some data authorities do not accept shredding alone | Agree; Gemini adds detail, UNVERIFIED beyond the EDPB text. |
| Tenant promotion heuristic (> 20k chunks) | Unverified | Stage 2: came from a blog post, not in official docs | Agree: UNVERIFIED. |

### Only one side has it
- **Gemini only (all UNVERIFIED unless a URL is named):** (1) one reranker family is CC-BY-NC, so not usable commercially without a licence (model-card URL given); open-weight shortlist with Apache/MIT licences. (2) Matter-level ACLs inside a tenant (ethical walls), a `matter_acl_ids` payload field from day 1. (3) Legal temporality beyond one validity interval: retroactivity, transitional clauses, fact date vs decision date. (4) Multi-turn coreference and date carry-over, with session memory inside the erasure pipeline. (5) Scanned PDFs, tables and redlines need OCR and layout extraction. (6) AI Act Art. 50 notices since 2026-08-02 and marking grace period to 2026-12-02 (no URL; R26 also lists Art. 50 from 2026-08-02). (7) RDG sections 2-3 (legal services to non-lawyers). (8) Hash-sharded fallback buckets and golden-set decay (8-16 lawyer hours a month). (9) Model deprecation churn: two older Gemini ids removed from the pricing page (secondary source only). `config/models.yaml` lists neither (it has gemini-3.8-flash and gemini-3.1-flash-lite). (10) Three architecture options with modelled costs (assumptions, not quotes).
- **Digest only:** the explicit R18 priority rule; the guard for private-option tenants; the CI-gate split of cheap per-PR checks versus a nightly judged run.

### Row changes
- No new row. Comments on existing rows: #1064 (T267: store valid time and transaction time plus applicability metadata; use plain edge tables), #1066 (T269: erase vectors, WAL, snapshots; add matter-level ACL field), #1063 (T266: matter ACL payload; fallback shard note), #1065 (T268: measure EU p95 under load from month 1; judge citation corrections are secondary).

### Owner decisions (not for agents)
1. Free-first routing for tenant documents versus Gemini's "no free tiers in production". Digest keeps the owner rule; owner confirms the private-option guard.
2. Whether to target German law-firm tenants (BRAO 43e, StGB 203, RDG) before the product is built.
3. Whether to budget recurring lawyer hours for the golden set (Gemini: 8-16 hours a month, EUR 1.5-3k).

### Expert questions added (default in brackets)
1. Does the workflow fall under AI Act high-risk (administration of justice)? [design audit logs and citation lineage now]
2. Do vendor contracts satisfy BRAO 43e and StGB 203 for law-firm tenants? [no law-firm tenant until EU-resident, zero-retention routes and addenda exist]
3. Does a DPO treat embeddings as personal data needing physical erasure? [assume yes; delete vectors within a documented SLA]
