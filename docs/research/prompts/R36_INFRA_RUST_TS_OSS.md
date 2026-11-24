# R36: faster infrastructure with Rust, TypeScript and open-source reuse (two-stage deep research prompt)

How to use: paste STAGE 1 into Gemini Deep Research. When the report arrives, paste STAGE 2 in the same chat. Bring both reports back to the hub chat.
Do not add keys, hostnames, IPs or personal names to the prompt.

## STAGE 1

You are a principal infrastructure engineer. Produce a decision-grade research report with primary-source links (official docs, release notes, repositories, licence files). Mark every claim you could not verify in a primary source as UNVERIFIED. Do not use marketing pages as evidence.

### Our system (facts)
- Roxira: SaaS for accounting and tax, CRM, ERP, HR, plus "Smart Judge", a Persian-language legal assistant (web chat and phone).
- Backend NestJS (TypeScript, Node 26). Frontend Next.js App Router, Tailwind, shadcn/ui. AI core Python FastAPI (currently image Python 3.11, target 3.13) with LightRAG, bge-m3 embeddings (TEI), Qdrant 1.19 (hybrid dense plus sparse), PostgreSQL 17 behind PgBouncer with row-level security, Redis (Valkey where possible), nginx, Docker Compose.
- Production: one aarch64 server, 4 vCPU, about 16 GiB RAM, disk 80 percent full. Autodeploy pulls `main` every 5 minutes.
- Legal corpus: about 7,000 law articles, 1,300 regulation chunks, 1,700 rulings, 250 circulars, Persian text, scanned PDFs through OCR. Targets: first token at most 1.5 s p95, full answer at most 8 s p95, Recall@5 at least 0.95.
- CI: self-hosted just-in-time runners on one always-on Linux laptop (24 GB RAM, 3 light slots plus 1 docker slot). We want the repository private on GitHub Free (no merge queue, no rulesets, no environments, no auto-merge), so a home-made merge gate on the laptop replaces them.
- Build force: many cheap AI coding agents (Gemini-family and open models) write most code. Humans review and merge.
- Hard constraints: runtime dependencies under MIT, Apache-2.0, BSD, ISC or CC0 only (no AGPL, GPL, SSPL, ELv2, BUSL). Total extra spend near USD 0. No rewrite without a measured gain above 30 percent of p95 on a named hot path. Persian (right-to-left) support is mandatory. The service must keep working when some foreign providers or networks are unreachable, so every external dependency needs a fallback.

### Questions
1. **Hot paths.** For a Persian legal RAG stack of this size, where do Rust or Go components give a measured gain over Python and Node? Evaluate concretely: tokenizer and text normalisation (Persian, Arabic-script), embedding serving (TEI already Rust: tune, do not replace), ONNX or candle inference for bge-m3 and a reranker, BM25 or sparse index generation, PDF and OCR pre-processing, SSE streaming gateway, JSON validation at the NestJS edge. For each give a benchmark source or a way to measure it on our hardware, expected gain, effort in engineer-days, and whether a ready open-source crate or package exists. Say which ones are NOT worth it.
2. **TypeScript strengths.** Where should we deepen TypeScript instead (shared contract types generated from OpenAPI, zod or valibot validation, tRPC or ts-rest, Effect or similar, strict tsconfig, Biome or oxlint instead of ESLint, SWC or esbuild or Rolldown for build speed, Turbopack status)? Include test speed (Vitest versus Jest), monorepo tooling (Turborepo, Nx, pnpm), and CI cache strategy for a laptop runner.
3. **Reuse before writing.** List mature open-source projects that replace code we might otherwise write, for: ledger and double-entry (for example TigerBeetle, Medici, others; check licences), invoicing and e-invoice formats (XRechnung, ZUGFeRD, Peppol: libraries such as Mustang, KoSIT validator), tax engines, payroll, CRM (Twenty is in use), workflow and queues (BullMQ, Temporal, Restate), search (Qdrant, Tantivy, Meilisearch), observability (OpenTelemetry Collector, VictoriaMetrics, Grafana Alloy), feature flags, secrets (SOPS, OpenBao), API gateway (Envoy, Caddy, Pingora), job scheduling. For each: licence, maintenance health (last release, bus factor), aarch64 support, resource use on 4 vCPU, migration risk. Give a ranked list of the 10 best swaps and the 10 to avoid.
4. **Smart Judge speed.** Best-practice architecture to reach first token at most 1.5 s p95 on 4 vCPU without a GPU: semantic cache, speculative retrieval, reranker choice (bge-reranker-v2-m3 versus cross-encoder alternatives, ONNX int8), streaming order, prompt caching, small-model routing. Include measured numbers from papers or benchmarks.
5. **Private repository and CI on one laptop.** Compare designs for CI and merge control when GitHub Free private repos have no merge queue, rulesets or environments: GitHub Actions with ephemeral JIT self-hosted runners (current), Forgejo or Gitea Actions plus Woodpecker as an exit plan, Gerrit-style gates, Zuul. Give failure modes of a single-laptop runner (power, disk, thermal, network) and a minimal high-availability upgrade at under USD 20 per month (second runner on a small VPS, off-site restic, watchdog). Say what GitHub terms allow for self-hosted runners on private repositories and when billing could change.
6. **Remote control of the laptop from the hub's Mac.** Both machines are on the same Wi-Fi LAN and also reachable through GitHub only. Compare secure ways to give one trusted operator command access to a Linux box: SSH with forced commands and a restricted shell, Tailscale or Headscale, WireGuard, Teleport, Cloudflare Tunnel with access policy, `mosh`, Ansible pull. Recommend one with: key handling (hardware key or agent), audit log of every command, command allow-list, easy revocation, no inbound public port, works when the Mac is on another network. Include a threat model for an AI agent driving that channel (prompt injection, accidental destructive command) and the guard rails you recommend.
7. **Migration plan.** Give a 30/60/90-day plan ordered by value over effort, each item with an acceptance test, a rollback, and a clear statement of what NOT to start yet.

### Output format
- Executive summary (10 lines).
- Table per question: option, licence, maturity, measured gain with source, effort, risk, verdict (ADOPT / TRIAL / HOLD / REJECT).
- A list of facts you could not verify.
- No marketing language.

## STAGE 2 (paste after Stage 1 finishes, in the same chat)

Act as a skeptical reviewer of your own report. Re-check every version number, licence, benchmark figure, date and acquisition or security claim against a primary source and fix or delete what you cannot confirm. List risks you missed (supply chain, licence change history, single-maintainer projects, aarch64 gaps, Persian text edge cases). Then output: (1) the final ranked decision pack with only verified items, (2) five open questions for the owners, (3) the three experiments to run first on our own hardware, each with the exact command, the metric and the pass line.
