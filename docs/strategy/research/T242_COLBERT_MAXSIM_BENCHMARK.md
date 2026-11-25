# T242 BGE-M3 ColBERT MaxSim Reranker Benchmark

- **Issue:** `#981` (T242)
- **Feature flag:** `SMARTJUDGE_RERANKER_MODE=colbert_maxsim` (default `cross_encoder` preserved as fallback)
- **Offline benchmark (30 candidates -> top-5, 8 query tokens x 12 doc tokens, 20 runs):**
  - `p95 <= 260 ms` verified in `output_apps/generated_modules/smartjudge/tests/test_reranker.py::test_colbert_maxsim_offline_p95_under_260ms`
  - Extra model RAM: `0 MB` (uses pre-computed multivectors, no extra model loaded in RAM)
- **70-Q gate:** Preserved (`Recall@1 >= 0.729`, `Recall@5 >= 0.929`; `QDRANT_EXACT` pinned first).
