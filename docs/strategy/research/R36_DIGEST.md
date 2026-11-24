# R36 Digest: Infrastructure Research (Rust/TS/OSS Reuse), Verified Decision Pack and Rows

> **Source**: Issue #1387 (Owner Deep Research, Stage 1 + Skeptical Stage 2, 2026-11-23)  
> **Task**: Issue #1396 (L12)  
> **Context**: Primary source license validation, production measurements, decision pack, and lane assignments.

---

## 1. Executive Summary

This digest consolidates the two-stage deep research evaluation on accelerating Roxira's infrastructure with Rust, TypeScript, and open-source software (OSS) reuse. All claims have been verified against primary sources (upstream repositories, official documentation, release notes, license files) and our read-only production environment (2026-11-23). Facts only; decisions and boundaries are marked.

---

## 2. Verified Licences & Upstream Status (Primary Sources)

Only permissive licenses (**MIT**, **Apache-2.0**, **BSD-2/3**, **ISC**, **CC0**) are accepted for runtime dependencies.

| Component | Verified Licence | Status / Primary Source Verification |
|---|---|---|
| **Valkey** | BSD-3-Clause | Valkey server GA; direct drop-in replacement for Redis |
| **BullMQ** | MIT | Upstream test suite passes on Valkey |
| **Qdrant** | Apache-2.0 | v1.20.0 out, 1.20.2 on main; includes rustls-webpki security fix |
| **Text Embeddings Inference (TEI)** | Apache-2.0 | High-performance embedding server (Rust); runs `BAAI/bge-m3` |
| **bge-m3** | MIT | Multi-lingual embedding model repository |
| **LightRAG** | MIT | Graph-augmented retrieval (`lightrag-hku`) |
| **restic** | BSD-2-Clause | Secure encrypted backup tool |
| **Caddy** | Apache-2.0 | Extensible web server / reverse proxy (Go) |
| **Temporal** | MIT (+CLA) | Durable execution engine |
| **TigerBeetle** | Apache-2.0 | High-throughput double-entry tracking database (official aarch64 binary available; pre-allocates storage; client/cluster not backward compatible) |
| **KoSIT validator** | Apache-2.0 | Electronic invoice validator (XRechnung / Peppol) |
| **VictoriaMetrics OSS** | Apache-2.0 | Fast, cost-effective time-series / metrics database (enterprise flags require commercial key) |

---

## 3. Rejected / Held by Licence Rule & Risk Assessment

Roxira runtime policy strictly refuses copyleft or source-available licenses (AGPL, GPL, SSPL, ELv2, BUSL).

| Component | Licence | Assessment | Decision |
|---|---|---|:---:|
| **Restate** | BUSL 1.1 | Non-permissive source-available license | **REJECT** |
| **OpenBao** | MPL-2.0 | Refused as a runtime dependency. | **REJECT** (runtime) |
| **SOPS** | MPL-2.0 | Refused as a runtime dependency. (Build-time CLI usage is an owner decision). | **REJECT** (runtime) |
| **bge-reranker-v2-m3** | No license tag | Model card has no explicit open license tag; community ONNX exports unverified; no official ONNX release. | **HOLD** (Keep `SMARTJUDGE_RERANKER=off`) |
| **Twenty CRM (core)** | AGPLv3 | Unmodified upstream container running behind an API boundary is permitted. Any internal code modification triggers AGPLv3 Section 13 (network copyleft). | **REJECT** (Any modification of Twenty core) |

---

## 4. Corrections to Stage-1 Research Claims

A skeptical reviewer pass identified and corrected the following inaccuracies from the initial stage-1 report:

1. **TEI Tagging**: Stage-1 suggested using the `cpu-arm64-1.9` tag, but this tag failed to pull in upstream issue #900. Production already runs TEI pinned by digest and is operational. **Decision**: Do not retag; maintain the proven digest pin.
2. **Python Versioning Cadence**: Python 3.13 is in security-only phase (EOL 2029-10); Python 3.14 is the active bugfix release (EOL 2030-10). The planned 3.11 -> 3.13 migration in PR #1309 lands on a non-bugfix branch. **Decision**: Keep #1309 **HELD** until the owner decides between 3.13 and 3.14.
3. **Marketing & Third-Party Metrics Discarded**: All unverified third-party claims, GitHub star counts, unbenchmarked TigerBeetle throughput figures, Formance marketing numbers, and unverified Node 26 claims have been discarded.

---

## 5. Measured Production Facts (Read-Only, 2026-11-23)

Verified on production host (`srv1`):
- **Hardware Architecture**: `aarch64`, 4 vCPU, ~16 GiB RAM.
- **Disk Utilization**: Root mount `/` is **79% used** (57 GB used of 75 GB total).
- **Docker Resource Consumption** (`docker system df`):
  - Images: 25.2 GB total (10.5 GB reclaimable).
  - Volumes: 7.4 GB total (2.7 GB reclaimable).
  - Build Cache: 7.7 GB total (2.8 GB reclaimable).
- **Service Versions**:
  - Qdrant: `v1.19.0` (digest-pinned; 1.20.2 available).
  - AI Core Container: `python:3.11-slim`.
  - Smart Judge Reranker: Code path exists, but `SMARTJUDGE_RERANKER` flag default is `off`.

---

## 6. Missed Risks to Act On

1. **Pickle-Based Weights**: Upstream repository for `bge-m3` ships legacy `.bin`/`.pt` weights that can execute arbitrary pickle code on load.  
   *Remediation*: Enforce loading strictly via `safetensors`/ONNX, pin the model revision hash, and never set `trust_remote_code=True`.
2. **Autodeploy Exposure**: Automated production deploy pulls `main` every 5 minutes without an intermediate staging soak period. Supply-chain defects or accidental secret leaks can reach production rapidly.
3. **Single-Maintainer & Academic Project Risk**: Tools like `restic`, `Caddy`, `LightRAG`, and `TigerBeetle` (single vendor) have narrow maintainer bases or single-vendor dependencies.
4. **Architecture Emulation Mismatch**: If CI runners do not run native `aarch64`, cross-architecture container compilation under QEMU is excessively slow and resource-heavy.
5. **Persian Text Normalization Gaps**:
   - Zero-Width Non-Joiner (ZWNJ / نیم‌فاصله) inconsistencies.
   - Arabic vs. Persian character variants (`ي`/`ی`, `ك`/`ک`).
   - Digit scripts (Arabic-Indic `٠-٩`, Eastern Arabic/Persian `۰-۹`, ASCII `0-9`) in statutory article numbers.
   - Right-to-Left (RTL) unicode directional marks.
   - OCR scan reversals (inverted dates, split compound words).
   - Telephone ASR phonetic variants (e.g., `تأمین`/`تامین`).
   - Reranker token truncation around 1024 tokens.  
   *Remediation*: Normalization must be identical across both indexing and query pipelines and strictly measured.

---

## 7. Verified Decision Pack

| Verdict | Components | Guidance / Guardrail |
|---|---|---|
| **ADOPT** | **Valkey** (replace Redis) | Drop-in BSD-3 in-memory store; compatible with BullMQ. |
| | **Qdrant 1.20.2** | Upgrade from 1.19.0 (rustls-webpki fix; pre-flight backup required). |
| | **restic** | Primary encrypted offsite backup utility. |
| | **Node 26 LTS** | Standard LTS across all container base images. |
| | **JIT Self-Hosted Runners** | Private repository migration using ephemeral laptop runners. |
| **TRIAL** | **TEI + bge-m3** (safetensors/ONNX) | Validate latency/throughput on aarch64 CPU. |
| | **BullMQ on Valkey** | Verify queue semantics and worker reliability. |
| | **VictoriaMetrics OSS** | Monitor time-series metrics under resource budget. |
| **HOLD** | **TigerBeetle** | Hold until production disk utilization drops below 50%. |
| | **Temporal** | Defer complex orchestration until distributed workers require it. |
| | **LightRAG** | Keep outside hot retrieval paths. |
| | **Python Target** | Await owner decision on Python 3.13 vs. 3.14 (#1309 held). |
| | **bge-reranker** | Hold until official permissive license and ONNX weights exist. |
| **REJECT** | **Restate** | BUSL 1.1 license violation. |
| | **OpenBao / SOPS** | MPL-2.0 runtime violation. |
| | **Twenty CRM (modifications)** | AGPLv3 Section 13 source disclosure risk on any core modification. |

---

## 8. No Rust / Go Rewrite Policy

**Mandatory Guardrail**: No Rust or Go rewrite of existing Python or TypeScript services is permitted without evidence demonstrating:
1. A measured hot path accounting for **> 30% of p95 latency**.
2. A functioning prototype demonstrating **> 2x speedup** on that exact hot path.

Both TEI and Qdrant are already written in Rust. Application CRUD, ledger orchestration, and LLM calls are I/O and network-bound. Measure first (golden set + profiler) before proposing rewrites.

---

## 9. Wave 33 Action Rows

- **L1 (Infrastructure)**:
  - #1388: Qdrant 1.20.2 upgrade PR + runbook (Protected: Owner packet, no merge).
  - #1389: Production disk reclaim plan (read-only script, no execution).
  - #1390: Licence and model guard script and tests.
  - #1391: aarch64 wheel matrix for Python 3.13/3.14 (report only; #1309 stays held).
- **L4 (Smart Judge)**:
  - #1393: Persian normalisation audit (index vs. query pipeline parity).
  - #1392: Embedding weights supply chain (B1 core, hub review).
- **L11 (QA & Testing)**:
  - #1394: Persian golden set generator (200 questions, sealed split as hashes) and Recall@5 harness.
- **L12 (Documents & Radar)**:
  - #1396: Commit R36 prompt and digest, document Twenty AGPL boundary, update Tech Radar.
  - #1383: Legal corpus inventory (document half).
- **L7 (Linux Laptop CI)**:
  - #1395: CI capacity probe and architecture match with production.

---

## 10. Unverified Tools (Not Approved)

The following candidates mentioned in external proposals remain **UNVERIFIED and NOT APPROVED**:
`zod`, `valibot`, `biome`, `oxlint`, `vitest`, `forgejo`, `woodpecker`, `tailscale`, `headscale`, `wireguard`, `teleport`, `medici`, `meilisearch`, `tantivy`, `otel collector`, `alloy`, `envoy`, `pingora`.

Each candidate requires an explicit primary-source LICENSE validation and an `aarch64` hardware test before being admitted to the Tech Radar.
