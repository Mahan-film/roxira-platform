# Topic C — Execution and Delivery Substrate

**Research snapshot:** 2026-10-01. All maturity figures are observed live on that date; “UNVERIFIED” means I did not find sufficient primary-source evidence. The recommended path is deliberately small: Docker Compose previews, strict CI gates, and a thin deployment layer before adding a sandbox platform.

## 1. One-server sandboxes and previews

| Item | What it is / source | Maturity, license, fit, cost | Verdict and first task |
|---|---|---|---|
| Docker Compose previews + TTL | Per-PR Compose project (`--project-name pr-123`) with an isolated network, generated subdomain, labelled volumes/images, and a cleanup job. Docker’s primitives are enough; no separate product is required. | Mature underlying runtime; **fit 5/5**; host cost only. | **ADOPT.** Create `preview up/down` scripts: no production mounts, no production network, no secrets, `mem_limit`, `pids_limit`, read-only root FS where possible; auto-delete after 24h and on PR close. |
| [gVisor / runsc](https://github.com/google/gvisor) | Userspace application kernel and OCI runtime which integrates with Docker; explicitly designed to reduce the host-kernel surface exposed to containers. | 19.5k stars; active repository observed 2026-09-30; Apache-2.0; known production adopters are listed by the project; **fit 4/5**; free. | **TRIAL.** Run one disposable coding-agent image with Docker’s `runsc` runtime, no Docker socket, no host mounts, and a deny-by-default egress policy. Measure compatibility with Node, Python, Playwright, and Nest builds before making it mandatory. |
| [Firecracker](https://github.com/firecracker-microvm/firecracker) | KVM-backed microVM VMM with a jailer, seccomp, cgroups, namespaces, and per-VM disks. | 37.1k stars; commit observed 2026-09-30; Apache-2.0; AWS reports production use; **fit 2/5** on one small VPS; free software. | **SKIP FOR NOW.** It needs KVM and image/kernel lifecycle management; virtualized Hetzner plans may not expose usable nested virtualization. First task only if gVisor is insufficient: prove `/dev/kvm` availability and boot one 256–512 MiB VM. |
| [E2B](https://github.com/e2b-dev/E2B) | Agent-code sandbox API; its repository documents cloud sandboxes and an “Embed” deployment for a general Linux machine using Terraform. | 14.1k stars; current activity **UNVERIFIED**; Apache-2.0; cloud-first control plane; **fit 2/5**; self-host software free, operational cost unknown. | **TRIAL LATER.** Do not make a cloud account part of the critical path. First task: reproduce one local Embed sandbox with a 1 GiB cap and verify cleanup, egress control, and disk reclamation. |
| [Daytona](https://github.com/daytonaio/daytona) | Sandboxes, previews, SDKs, and desktop/computer-use integrations. | 71.7k stars, but the public repository says core development moved private and it receives no further updates/releases since June 2026; licence and self-hosted support status **UNVERIFIED** from this review; **fit 1/5**. | **SKIP.** The public repository’s maintenance warning makes it a poor foundation for a cost-constrained factory. |
| [Coolify](https://github.com/coollabsio/coolify) | Self-hosted PaaS supporting Dockerfiles, Compose, databases, and Git providers. | 62.4k stars; observed commit 2026-09-29; Apache-2.0; project claims 400k+ users; **fit 4/5**; free self-hosted edition. | **ADOPT, AFTER THE PLAIN-COMPOSE BASELINE.** Use it for production deploys and visibility, not as the sandbox boundary. First task: deploy one existing Compose app to a non-production hostname and prove rollback. |
| [Dokploy](https://github.com/Dokploy/dokploy) | Self-hosted PaaS with Compose, Traefik, databases, monitoring, CLI/API. | 37.6k stars; pushed 2026-09-29. Most code is Apache-2.0 but `/proprietary` is DSAL and production use requires a commercial agreement; **fit 2/5**; licence risk. | **SKIP.** Coolify has a clearer fully-open deployment story for this use case. |
| [Kamal](https://github.com/basecamp/kamal) | SSH-driven, zero-downtime Docker deployment tool. | 14.6k stars; active 2026-09-30; MIT; **fit 3/5**; free. | **SKIP FOR THIS FACTORY.** Good for an opinionated deploy command, but it does not supply previews, TTL, or sandboxing and duplicates the planned Compose/Coolify layer. |

### Proposed hard resource envelope

This is a **proposed enforcement budget**, not a measurement of current consumption:

| 15 GiB RAM | 28 GiB free disk |
|---|---|
| 6 GiB: production/data services | 8 GiB: production volumes |
| 1 GiB: proxy/control plane | 8 GiB: pinned image/build cache |
| 3 GiB: one active build or browser test | 2 GiB: active preview volumes |
| 3 GiB: at most two 1.5 GiB previews | 2 GiB: CI artifacts/logs |
| 2 GiB: OS/cache/emergency headroom | 8 GiB: OS, database headroom, emergency space |

Enforce “one browser job, one build sandbox, two previews maximum.” Preview databases must be empty, schema-only, and disposable. Never clone customer data or production volumes into them.

## 2. AI QA as merge gates

| Item | What it is / source | Maturity, license, fit, cost | Verdict and first task |
|---|---|---|---|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) + [Playwright Test](https://playwright.dev/docs/test-snapshots) | MCP browser automation for agents; Playwright Test natively supports screenshot comparisons and ARIA snapshots. MCP is not itself a security boundary. | 37.7k stars; pushed 2026-09-28; Apache-2.0; **fit 5/5**; free except browser RAM. | **ADOPT.** Add deterministic Chromium E2E tests for login, one Persian RTL form, and an error state. Let agents propose tests, but make the normal test runner—not the agent—the gate. |
| [axe-core](https://github.com/dequelabs/axe-core) | Automated accessibility engine, usable inside existing browser tests; supports WCAG 2.0/2.1/2.2 rules. Its authors state automated checks find only part of all accessibility issues. | 7.6k stars; release cadence stated as 3–5 months; MPL-2.0; **fit 5/5**; free. | **ADOPT.** Run axe after each important UI state. Fail critical/serious violations; report lesser issues. Add a Persian RTL/manual accessibility checklist rather than claiming automated coverage is complete. |
| Playwright visual + ARIA baselines | Native image and accessibility-tree regression checks; baselines must run in the same controlled environment to avoid rendering noise. | Included in Playwright; **fit 5/5**; free. | **ADOPT.** Commit mobile and desktop screenshots plus `.aria.yml` snapshots for the shell, form, dialog, and empty state. Review baseline changes as code changes. |
| [Trivy](https://github.com/aquasecurity/trivy) | Scans repositories, images, IaC, dependencies, secrets, licences, and emits SBOMs. | 38.2k stars; pushed 2026-10-01; Apache-2.0; **fit 5/5**; free. | **ADOPT.** Gate every PR on filesystem misconfiguration/secrets checks and every release image on critical CVEs; cache its database but set an explicit maximum cache age. |
| [Semgrep CE](https://github.com/semgrep/semgrep) | Pattern-based static analysis for 30+ languages. The project warns Community Edition is intrafile and can miss security findings. | Current maintenance observed 2026-09-29; LGPL-2.1; stars **UNVERIFIED** in this pass; **fit 4/5**; free CLI/rules. | **TRIAL.** Start with focused custom rules: no frontend secrets, no unsafe subprocess/shell construction, required tenant checks, and no direct repository access from Nest controllers. Do not present it as comprehensive SAST. |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Git-history and working-tree secret detector. | Latest observed release v8.30.1, 2026-03-21; licence/stars **UNVERIFIED** here; **fit 5/5**; free. | **ADOPT.** Scan full history once before enabling the PR gate; establish a documented false-positive allowlist with expiry. |
| [OWASP ZAP](https://github.com/zaproxy/zaproxy) | Open-source web scanner for a running application. | GitHub Top-1000 project; 10.4k commits; Apache-2.0; stars/last commit **UNVERIFIED**; **fit 4/5**; free but memory-heavy. | **TRIAL.** Run only ZAP baseline/passive scans against a disposable preview weekly and before releases. Never aim active scans at production without a written target policy. |

**Required PR sequence:** compile/type/unit → Semgrep/Gitleaks/Trivy → preview → Playwright functional/axe/visual/ARIA → ZAP baseline where scheduled → policy evaluation → merge eligibility. A failed scanner blocks merge; an agent may explain or propose a patch, but may not waive its own gate.

## 3. Golden templates and safe infrastructure generation

| Item | What it is / source | Maturity, license, fit, cost | Verdict and first task |
|---|---|---|---|
| [Copier](https://github.com/copier-org/copier) | Versionable project-template renderer with a questionnaire, answer file, and update workflow. | 3.6k stars; recent activity **UNVERIFIED**; MIT; **fit 5/5**; free. | **ADOPT.** Build one `roxira-fullstack` template: Next App Router RTL shell, Nest module/DTO validation, FastAPI service, Compose, test skeleton, CI, and explicit tenant/ownership conventions. |
| [OpenTofu](https://github.com/opentofu/opentofu) | Declarative IaC with an execution-plan step. | 30.2k stars; current activity **UNVERIFIED**; MPL-2.0; its registry says it blocks some sanctioned origins; **fit 3/5**; free binary but registry availability is a risk. | **ADOPT NARROWLY.** Use only for DNS/firewall/server-adjacent declarations that cannot live in Compose. Commit lock files, mirror/cache providers, require `tofu plan` artifact plus OPA review, and allow apply only from the protected deploy workflow. |
| [Pulumi](https://github.com/pulumi/pulumi) | General-purpose-language IaC; hosted service is optional. | Active repository; Apache-2.0; stars/last commit **UNVERIFIED**; **fit 2/5**; free self-managed state, optional paid cloud. | **SKIP.** It introduces another language/runtime and state-management decision without a benefit over OpenTofu for one server. |
| [OPA](https://github.com/open-policy-agent/opa) | General policy engine for declarative allow/deny decisions; usable in CI. | 12.3k stars; active 2026-09-30; Apache-2.0; CNCF graduated; **fit 4/5**; free. | **ADOPT AS A CLI, NOT A SERVICE.** First policies: deny privileged containers, host mounts, `latest` images, public DB ports, absent resource limits, and IaC plans that widen ingress. |

Templates should have a small typed `factory.yaml` contract. Generated code may fill approved extension points, but must not rewrite security defaults. Generated IaC is always a proposed diff plus plan—never an autonomous apply.

## 4. Iranian network and model-continuity posture

Iranian filtering is an operational dependency, not a temporary inconvenience. [IRBlock](https://irblock.org/) and the [2025 USENIX measurement](https://www.usenix.org/system/files/usenixsecurity25-tai.pdf) document forged DNS answers in `10.10.34.x`, SNI-triggered resets, and QUIC/UDP disruption. Treat any `10.10.34.0/24` resolution as a failed dependency check, not a legitimate endpoint.

- Run a scheduled, non-sensitive reachability matrix from both the Hetzner host and an Iranian network: GitHub, GHCR/Docker Hub, npm, PyPI, apt, OpenTofu registry, model APIs, DNS, HTTPS, and QUIC. Record only endpoint/status/latency—not credentials.
- Pin image digests and language lockfiles; maintain a tested local cache of essential images, packages, browsers, model artefacts, and security databases within the disk budget. Rebuild only from pinned artefacts when upstream access is unavailable.
- Do not assume an OpenRouter `403` means filtering. Its [terms](https://openrouter.ai/terms) say providers can restrict models by country and prohibit using VPNs/proxies to evade restrictions; it also tries to report request origin. Its [fallback API](https://openrouter.ai/docs/guides/routing/model-fallbacks) handles provider errors, but it is not a sanctions workaround.
- OFAC’s communications authorization, now reflected in [31 CFR §560.540 guidance](https://ofac.treasury.gov/faqs/topic/1551), does **not** guarantee that a particular model provider, payment processor, or registry will serve the factory. Obtain provider/payment eligibility directly; do not design around evasion.
- Keep an offline inference fallback for **low-risk, non-customer-data** tasks: local lint explanation, template selection, test summarization, and simple Persian drafting. [Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B) is Apache-2.0, 8.2B parameters, multilingual, and has 11.4M monthly downloads; the raw BF16 model alone exceeds this host’s RAM budget. [DeepSeek-R1-Distill-Qwen-7B](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B) is MIT but has the same capacity concern. **Trial quantized models only after measuring** memory, context, latency, and output quality.
- Prefer [llama.cpp](https://github.com/ggml-org/llama.cpp) for CPU/GGUF experiments: MIT, 128k stars, actively published binaries, and an OpenAI-compatible server. Use [vLLM](https://github.com/vllm-project/vllm) only if a compatible GPU becomes available; it is Apache-2.0 but its value is GPU throughput, not a 15 GiB CPU-only host.

## 5. Agent safety, secrets, and identity boundaries

The [OWASP 2026 guidance](https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/) recognizes prompt injection and agent control as first-class risks. Apply these concrete rules:

1. Web pages, issues, repository text, and tool output are **untrusted data**, never instructions. Preserve provenance; strip/quote fetched content; allow only explicit research domains; do not give a web-reading agent shell, deployment, secret, or PR-merge authority.
2. Split identities: researcher (network read only), coding worker (sandbox filesystem only), CI tester (read-only repository), PR bot (narrow `pull-requests: write`), and deployer (protected branch only). GitHub documents that declaring a `permissions` block turns unspecified token permissions to `none`; avoid `pull_request_target` for untrusted code because it can receive write permission. [Source](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
3. Require an independent deterministic gate before any consequential action. Model text can request an action; policy, CI status, protected branch, and a scoped identity decide whether it occurs.
4. Store encrypted configuration with [SOPS](https://github.com/getsops/sops) plus `age`: supports YAML/JSON/ENV encryption, MPL-2.0, no always-on service. Use separate dev/preview/production key recipients; only the deploy job may decrypt production secrets.
5. Do not mount `/var/run/docker.sock`, SSH keys, GitHub PATs, cloud credentials, or production `.env` files into agent sandboxes or previews. Rotate any secret exposed in logs or an untrusted runner; scan before and after rotation.
6. Pin GitHub Actions by full commit SHA, restrict workflow changes to review, use OIDC only where the relying deployment service validates issuer, audience, repository, branch, and workflow claims. [GitHub’s OIDC guidance](https://docs.github.com/en/actions/reference/security/oidc) explicitly requires trust conditions.

## Ranked top-8 adoption list

1. **Compose preview contract with TTL, resource caps, and zero production data/secrets.**
2. **Playwright Test + axe-core + committed visual and ARIA baselines.**
3. **Mandatory Trivy, Gitleaks, Semgrep, and constrained ZAP CI gates.**
4. **SOPS/age secrets, minimal GitHub Actions permissions, and separate agent identities.**
5. **Copier-based golden full-stack template with a typed factory manifest.**
6. **gVisor trial for disposable untrusted coding workers; keep Docker Compose for trusted builds.**
7. **Coolify production deployment/rollback trial after the plain-Compose path is proven.**
8. **Iran continuity matrix plus cached artefacts and a measured llama.cpp local-model fallback.**