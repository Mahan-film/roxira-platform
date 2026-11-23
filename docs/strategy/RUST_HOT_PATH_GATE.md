# Architecture Standard: Rust Hot-Path Gate (T308 / R33)

- **Status:** Adopted (2026-11-22)
- **Task:** #1131 (T308 R33)
- **Lane:** L1 (Infra / Performance / Architecture)
- **Applies to:** AI Core (`output_apps/generated_modules/smartjudge/`), Enterprise Hub (`output_apps/enterprise_hub/`), and all future microservices/sidecars.
- **Reference ADR:** [ADR_RUST_READY_HOT_PATH.md](ADR_RUST_READY_HOT_PATH.md)

---

## 1. Executive Summary & Policy Statement

To maintain rapid development velocity, prevent premature optimization, and eliminate language-fragmentation overhead, **no custom rewrite of any application, retrieval, or business logic component into Rust or Go is permitted** unless it satisfies the **Rust Hot-Path Gate**.

Roxira strictly adheres to an **Off-the-Shelf Binary Consumption** model for systems programming languages:
- We consume world-class pre-compiled Rust binaries: **Qdrant** (vector search engine), **TEI** (Text Embeddings Inference), **uv** (Python package installer), **ruff** / **oxlint** (linters), and **orjson** (serialization).
- We do **not** author custom in-house Rust sidecars or microservices for I/O-bound CRUD, ledger operations, or orchestration.

---

## 2. The Dual-Threshold Rust Gate

Before any engineering effort is allocated to creating a Rust implementation, sidecar, or FFI module, the target workload must satisfy **both** of the following quantitative conditions:

1. **Stage Dominance Threshold (>30% of p95)**:
   The candidate stage must account for strictly more than **30.0%** of total end-to-end $p95$ latency measured across the representative benchmark suite (`eval/replay_benchmark.py`).
   $$\text{Share}_{\text{stage}} = \frac{p95_{\text{stage}}}{p95_{\text{total}}} \times 100 > 30.0\%$$
   If no individual stage exceeds 30% of $p95$, optimization efforts must focus on algorithmic improvements or caching rather than language rewrites.

2. **Prototype Speedup Threshold (>2.0x speedup)**:
   An isolated, self-contained prototype in Rust tested against the exact same test corpus under identical hardware and environment constraints must demonstrate a measured speedup strictly greater than **2.0x** over the baseline Python/Node implementation:
   $$\text{Speedup} = \frac{\text{Baseline Latency}}{\text{Prototype Latency}} > 2.0$$

If either condition is not met, the rewrite is **categorically rejected**.

---

## 3. Architectural Analysis: Network-Bound vs. CPU-Bound Realities

Profilings and operational metrics demonstrate why rewriting orchestration in Rust is counterproductive:

| Stage | Subsystem | Latency Nature | Rust Rewrite Impact | Recommendation |
|---|---|---|---|---|
| `sql_ms` | PostgreSQL / pgvector | Network I/O & disk access | **0% reduction** (Rust waits for DB socket just like Python) | Optimize Postgres indexes, connection pooling (PgBouncer), CTE graph queries |
| `qdrant_ms` | Qdrant vector DB | Network I/O & vector search | **0% reduction** (Qdrant core is *already* written in Rust) | Use INT8 quantization, HNSW parameter tuning, H2/gRPC transport |
| `embed_ms` | TEI / Local Embedding | CPU / GPU matrix math | **0% reduction** (TEI is *already* written in Rust / CUDA) | Cache queries in Redis L2 embedding cache (`lightrag_engine.py`) |
| `rulings_ms` / `regs_ms` | SQL metadata catalog | DB network query | **0% reduction** (Postgres network roundtrip) | Run stages concurrently via `asyncio.gather` (implemented in T211) |
| SSE Serialization | HTTP Streaming / JSON | CPU serialization | **Marginal** (handled by `orjson` C/Rust binding) | Use `orjson.dumps` and immediate SSE frame flush |

Rewriting network orchestration code (which simply issues SQL queries or HTTP calls to external servers) in Rust adds massive cognitive load, compilation times, memory-safety maintenance, and build complexity without moving the latency needle by even 1 millisecond.

---

## 4. Benchmark Enforcement & Tooling

The gate is programmatically codified in `output_apps/generated_modules/smartjudge/eval/replay_benchmark.py`:

```bash
# Run replay benchmark with automated gate check
python3 -m output_apps.generated_modules.smartjudge.eval.replay_benchmark --offline --runs 5 --check-gate
```

Sample output:
```text
stage        p50_ms    p95_ms    p95_share_%
embed_ms       0.20      0.20         40.0%
qdrant_ms      0.40      0.40         80.0%
sql_ms         0.30      0.30         60.0%
rulings_ms     0.10      0.10         20.0%
regs_ms        0.10      0.10         20.0%
total_ms       0.50      0.50        100.0%

--- Rust Hot-Path Gate (T308 / R33) ---
Threshold: stage > 30.0% of p95 AND prototype > 2.0x speedup
Verdict:   REWRITE_PROHIBITED
Reason:    Stage(s) exceed 30.0% latency share, but proven prototype speedup > 2.0x was not demonstrated.
```

The programmatic check `evaluate_rust_gate(summary, prototype_speedups)` returns structured JSON for automated CI/regression assertions, ensuring no unauthorized rewrite branches proceed to implementation without verified baseline profiles.
