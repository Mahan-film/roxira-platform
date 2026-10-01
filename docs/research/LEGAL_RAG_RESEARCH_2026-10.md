# Legal RAG research — 2026-10-01

## Scope and decision

Smart Judge is already an article-level Iranian-law RAG system: `iran_laws_v2` is
the answering collection (about 4,200 points in the last measured production
audit; the brief says about 5,100 now), uses BAAI/bge-m3 embeddings, has
LightRAG, an exact-article lookup path, and a citation guard. The immediate
priority is **legal currency and citation correctness**, not a larger agent.
The two project documents were read before this review.

Important baseline: `LEGAL_COVERAGE_ROADMAP.md` records only eight laws, no
circulars/advisory opinions/rulings, a 63.3% citation-accuracy result on 30
questions, and a guard that was still pointed at the old placeholder-heavy
collection. Do not represent the system as complete legal research or legal
advice.

## Recommended retrieval design

1. Keep deterministic routing first. Normalize Arabic/Persian letters, ZWNJ,
   and Persian/Arabic/Latin digits; detect `ماده N [مکرر] قانون X`; resolve the
   law alias and query Qdrant by `law_id/law_name + article_no + is_active`.
   Return that result before semantic search. Article + note (`تبصره`) is the
   stable citation unit; split only an overlong article, retaining the same
   article identity plus `part_no` and offsets. This is safer than arbitrary
   token windows and matches the existing article-aware Iranian prototypes
   [IRI_LAW](https://github.com/NLP-Final-Projects/IRI_LAW) and
   [legal_case_rag](https://github.com/NLP-Final-Projects/legal_case_rag).

2. For all other queries, use a bounded hybrid candidate set: exact/metadata
   hits + bge-m3 dense + bge-m3 sparse lexical scores (and, only if latency
   permits, its ColBERT multi-vector score). Fuse with reciprocal-rank fusion,
   then rerank 20--50 candidates and pass 3--6 complete articles/notes to the
   answerer. Sparse matching is especially useful for article numbers, formal
   terms, names, and unusual spelling; dense retrieval covers colloquial
   Persian. BGE documents its multilingual reranker and newer lightweight
   Gemma2 reranker paths in
   [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding/tree/master/examples/inference/reranker).
   First compare `BAAI/bge-reranker-v2-m3` (small multilingual cross-encoder)
   against `bge-reranker-v2.5-gemma2-lightweight`; reserve
   `bge-reranker-v2-gemma`/MiniCPM layerwise for an observed quality gain.

3. Make Persian rewriting a retrieval-only, reversible transform. Generate at
   most two variants: normalized literal query and a formal legal paraphrase
   that preserves names, numbers, dates, monetary amounts, and negation. Query
   them in parallel; never let a rewrite change the displayed question or cite
   a law it introduced. Start rule-based (digit/character normalization,
   `ماده`/`تبصره`, colloquial aliases); add a cheap LLM only for ambiguous
   non-exact questions and log both variants. This is preferable to an
   unconstrained “legal answer rewrite.” A recent Persian legal RAG reference
   also uses bounded intent -> rewrite -> metadata -> retrieval -> one retry
   [here](https://github.com/MahdiarHarandi/persian-legal-qa-rag).

4. Answer only from retrieved text. Emit every material proposition with an
   article/source-version identifier, and mechanically reject a citation whose
   `law_id`, `article_no`, and retrieved text are absent or inactive. Then run
   claim-to-evidence verification: split the draft into claims and require each
   claim to be entailed by its cited article. RAGAS defines faithfulness exactly
   as support of response claims by retrieved context
   [here](https://github.com/vibrantlabsai/ragas/blob/main/docs/concepts/metrics/available_metrics/faithfulness.md);
   DeepEval additionally offers citation-faithfulness checking
   [here](https://deepeval.com/docs/metrics-citation-faithfulness). These are
   useful *offline judges*, not proof: calibrate against lawyer labels and use
   deterministic article identity checks as the production fail-closed gate.

## Open-source tools checked (web snapshot 2026-10-01)

Stars and last commits are moving repository metadata; dates/short SHAs below
are the latest visible on the linked default-branch history when checked.

| Tool / fit | Stars | Last commit | Licence | Decision |
| --- | ---: | --- | --- | --- |
| [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) | 12.2k | 2026-08-24 `fd1a2bd` | MIT | Adopt for bge-m3 hybrid experiments and reranker A/B tests. |
| [RAGAS](https://github.com/vibrantlabsai/ragas) | 15.9k | 2026-02-24 `298b682` | Apache-2.0 | Offline faithfulness/context metrics; project is comparatively quiet. |
| [TruLens](https://github.com/truera/trulens) | 3.6k | 2026-09-04 `cf3e3de` | MIT | Optional tracing/online sampled evaluation; do not add before a local gold set. |
| [DeepEval](https://github.com/confident-ai/deepeval) | 18.5k | 2026-09-06 `f94d940` | Apache-2.0 | Best candidate for pytest-like citation/groundedness regression tests. |
| [promptfoo](https://github.com/promptfoo/promptfoo) | 25.6k | 2026-09-11 `d1aab0f` | MIT | Optional CI matrix/red-team harness; keep test cases local and provider-free by default. |

None is Persian-law validated. Use them to measure a frozen Iranian test set;
do not select a retriever by English benchmark claims alone.

## Persian data and evaluation

The useful public signals are datasets and prototypes, not a trustworthy,
standard Iranian-law benchmark. [PerSets Iranian Legal Persian QA](https://huggingface.co/datasets/PerSets/iran-legal-persian-qa)
lists >600k ordinary-user questions and 2m lawyer answers, CC-labelled and
sourced from Dadrah; treat it as weak supervision/colloquial-query mining only:
licence interpretation, consent/provenance, duplicates, currency, and answer
quality require review. The Sharif projects expose article-level corpora and a
small business-law evaluation, while `legal_case_rag` reports 25k+ anonymized
judgments; neither demonstrates official-source currency or Iranian
precedential authority. General Persian QA resources such as
[PQuAD](https://arxiv.org/abs/2202.06219) and
[PCoQA](https://github.com/HamedHematian/PCoQA) can stress normalization and
conversational rewriting, but are not legal correctness tests.

Create a lawyer-reviewed, versioned holdout by legal area. Each row should have
the Persian user phrasing, as-of Jalali/Gregorian date, expected article(s),
source URL/hash, permitted authority tier, and expected abstention where the
corpus lacks coverage. Report exact-article recall, nDCG/MRR, citation identity
precision, claim support, abstention correctness, and p50/p95 cost/latency.

## Currency, hierarchy, and provenance

National legal portals separate an authoritative original from a convenient
consolidation. EUR-Lex shows the law applicable at a stated point in time,
preserves all versions and the basic/amending acts, but says consolidated text
has no legal effect [here](https://eur-lex.europa.eu/collection/eu-law/consleg.html?locale=en).
UK legislation similarly supplies original/revised versions, changes/effects,
and point-in-time views, while warning when outstanding changes remain
[here](https://www.legislation.gov.uk/help). This is the model to copy, not an
assertion that foreign law is Iranian law.

Store an immutable *source document* and a derived *article version* separately:
`law_id`, official title/type, source URL, source hash, publication/approval
date, effective_from, effective_to, status (`DRAFT|IN_FORCE|AMENDED|REPEALED|
INVALIDATED|UNKNOWN`), `is_active`, amendment/repeal instrument IDs, and an
`as_of` retrieval filter. Default to today only when the user gave no date;
show “as of” and refuse a currency conclusion when the chain is incomplete.
Never set a bill to IN_FORCE merely because it parses like a statute. Preserve
superseded text for historical questions, but never retrieve it in a current-law
answer without an explicit as-of date.

Apply an authority tier independently of semantic relevance:

| Tier | Examples in scope | Answer treatment |
| --- | --- | --- |
| A — binding/primary | Constitution, enacted law, valid regulation/cabinet decree, Official Gazette text | May state the rule, with effective date and source. |
| B — binding precedent where Iranian law says so | verified `رأی وحدت رویه` or other formally binding ruling | Name court, decision number/date, binding scope, and later treatment. |
| C — official but non-binding | Judiciary advisory opinion (`نظریه مشورتی`), circular/instruction, administrative guidance | Label “advisory/guidance; not a binding ruling” unless a lawyer supplies a contrary verified rule. |
| D — persuasive/secondary | selected judgments, commentary, practitioner material | Never present as the rule; expose provenance and limitations. |

The separation is normal legal-information practice: CJEU Advocate-General
opinions are published but not binding, whereas a preliminary ruling binds the
referring national court on EU-law interpretation
[opinions](https://curia.europa.eu/site/jcms/qua1_6229/en/the-general-court-how-the-procedure-works)
/ [rulings](https://curia.europa.eu/site/upload/docs/application/pdf/2026-03/monthly_case-law_digest_en-_february_2026.pdf).
For Iranian tiers, have a licensed Iranian lawyer approve the mapping and every
source family before ingest; this report is not a statement of Iranian law.

## Agentic RAG: adopt a small verifier, not a general agent

Worth adopting: a deterministic plan for exact article/date/authority; one
parallel hybrid retrieval; reranking; a verifier that either (a) proves every
citation exists, is active for `as_of`, has the right authority tier, and
supports the linked claim, or (b) returns a concise abstention/coverage gap.
Permit **one** corrective retrieval with an observable reason (no evidence,
date conflict, or tier conflict). This is consistent with the retrieval-quality
gate in [CRAG](https://arxiv.org/abs/2401.15884) and the retrieve/generate/
critique idea in [Self-RAG](https://arxiv.org/abs/2310.11511), without adopting
their training or open-web fallback.

Do not use unbounded planning, autonomous web search, or multi-agent debate for
ordinary statutory questions. Every extra loop adds LLM calls, retrieved tokens,
tail latency, nondeterminism, and another chance to use an unofficial/currently
unverified source. For Smart Judge, agentic retrieval should be enabled only
when exact routing fails or the verifier rejects a high-risk answer; cap it at
one retry and log the reason, inputs, selected article versions, verifier
result, cost, and latency. It must remain inside the approved Iranian corpus;
customer/case facts must not go to free-tier models.

## Ranked, offline-testable next tasks (maximum six)

1. **High value / low risk — guard the real collection.** Edit
   `output_apps/generated_modules/smartjudge/smartjudge_module.py` and
   `src/test_citation_guard_collection_env.py` so the default/fallback matches
   the answering collection or startup fails when guard and answering
   collections differ. Risk: deployment configuration may intentionally differ;
   make any exception explicit and tested.

2. **High value / medium risk — freeze currency + tier schema.** Extend
   `scripts/w6_ingest_dotic.py` and `src/legal_intelligence/test_w6_dotic_ingest.py`
   to require version/status/effective dates/source hash/authority tier, reject
   `DRAFT` and unknown-currentness records from current-law output, and retain
   historical versions. Risk: legacy rows lack metadata; quarantine rather than
   invent values.

3. **High value / medium risk — prove exact and temporal citations.** Add
   dated/repealed/`مکرر`/alias cases to `data/eval/legal_rag_eval.jsonl`; extend
   `scripts/eval_legal_rag.py` and `src/test_citation_guard_restored.py` with
   article-identity, active-as-of, and authority-tier assertions. Risk: the
   present 30 rows are too small; lawyer review is required before promotion.

4. **Medium value / medium risk — hybrid retrieval A/B, offline.** Add an
   injectable score-fusion seam in
   `output_apps/generated_modules/smartjudge/legal_graph/lightrag_engine.py`
   with unit cases in `src/test_lightrag_pin.py`; compare dense-only,
   dense+sparse, and exact+hybrid on the frozen JSONL. Risk: Qdrant sparse and
   ColBERT indexes increase storage/operational complexity; ship only a measured
   citation-recall gain within the latency budget.

5. **Medium value / low risk — conservative Persian retrieval variants.** Add
   pure normalization/variant tests to `src/test_legal_components_exist.py` and
   implement them in `output_apps/generated_modules/smartjudge/smartjudge_module.py`.
   Risk: a rewrite can alter legal meaning; preserve original tokens/numbers and
   make LLM rewriting opt-in after rules are measured.

6. **Medium value / low risk — local evaluator harness.** Add a no-network
   deterministic citation fixture to `scripts/eval_legal_rag.py` and a focused
   regression test in `src/test_citation_guard_restored.py`; only then trial
   DeepEval/RAGAS against recorded, non-customer outputs. Risk: LLM judges can
   mis-score Persian legal entailment and add cost; lawyer-calibrate before any
   release gate.

