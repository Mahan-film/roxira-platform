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
