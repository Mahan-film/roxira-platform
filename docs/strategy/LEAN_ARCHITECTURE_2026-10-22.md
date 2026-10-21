# Lean architecture for srv1 — 2026-10-22

Goal (owner): the site never stops because of RAM or disk, the server does as little work as possible,
and every heavy job has a free or cheap place to run outside the box.

## 1. Measured state (srv1, 4 vCPU / 7.7 GB RAM / 75 GB disk, 2026-10-22)

| Resource | Finding |
| --- | --- |
| Disk | Hit **100 %** on 2026-10-22. Causes: Docker build cache 8 GB, 71 old agent worktrees 6.5 GB, unused images 4.3 GB. After cleanup: 73 % (20 GB free). Image store (`/var/lib/containerd`) is 41 GB of the 53 GB used. |
| RAM | 4.2 GB used + **6.2 GB swapped** (4 GB swapfile + 3.8 GB zram, zram full). Working set is larger than RAM. |
| Biggest RAM user | TEI `BAAI/bge-m3` fp32 (query embedder): ~2.5 GB, mostly swapped out; every chat query has to page it back in. |
| Next | backend node ~0.6 GB, research server ~0.55 GB, app uvicorn ~0.5 GB, LiteLLM ~0.35 GB, Next.js ~0.2 GB. |
| Qdrant | `iran_laws_v6`: 6,304 points × 1024 dims ≈ 26 MB. Too small for quantization to matter; leave it. |
| App image | 3.4 GB, of which `/opt/venv` 2.2 GB (torch CPU + sentence-transformers for the optional local reranker/embedder). |

## 2. Principles

1. **Always-on box serves; heavy work runs elsewhere.** Embedding builds, evals, crawls and agent work
   run on free/cheap external compute (Cloudflare Workers AI, Modal, GitHub-free CI is off, so taskq
   with strict quotas), never as long-lived containers on srv1.
2. **Every external dependency has a local fallback, and every local heavy service has an external
   primary.** Nothing stops when one provider is down or out of credit (same rule as the LLM ladder).
3. **Bounded growth by default.** Every cache, log, worktree and image set has a cap and a timer that
   enforces it. Disk and RAM alerts reach the owner on Telegram before users notice.
4. **Cache at the edge.** Public law/guide pages are cached by Cloudflare, so a crawler or a traffic
   spike does not hit Next.js, the backend and Postgres.
5. **Measure, then change one thing at a time** (deploy smoke + legal gate stay the guard).

## 3. Decisions

| # | Change | Effect | Risk / guard | Owner action |
| --- | --- | --- | --- | --- |
| A | **Query embeddings → Cloudflare Workers AI `@cf/baai/bge-m3`** (same model as TEI, 1024 dims). TEI stays as the fallback and for builds. Backend selected by `EMBED_BACKEND=cf`, automatic fallback to TEI on any error/timeout (> 3 s). | Removes TEI from the hot path; frees ~2.5 GB of RAM pressure in practice (TEI stays idle/swapped). Free tier 10,000 neurons/day ≈ 9 M input tokens/day; our queries are ~50 tokens. | Must pass the same parity test as Modal (min cosine ≥ 0.999 against TEI on 50 real texts) before it is switched on. | Create a Cloudflare API token with *Workers AI: Read* + account id, enter both with `set_server_env.sh` (`CF_ACCOUNT_ID`, `CF_AI_TOKEN`). |
| B | **Disk guard timer** (hourly): build-cache prune to 3 GB, old agent worktrees removed, Telegram alert ≥ 88 %. | Disk can no longer silently fill. | Never prunes images, volumes or rollback tags. | none (taskq 17) |
| C | **Edge caching** for `/laws/*`, `/regulations/*`, `/guides/*`, sitemaps: `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` + a Cloudflare cache rule. Chat, auth, payment, `/owner` never cached. | Crawlers and spikes stop reaching the origin. | Pages are `force-dynamic` (#765) because the layout reads headers; the header is set per route, verified with `cf-cache-status`. | Maybe one cache rule in the Cloudflare panel (we will give exact clicks if the API token cannot do it). |
| D | **Per-container memory caps** (`mem_limit` + `mem_reservation`) in `docker-compose.prod.yml` for every service; `restart: unless-stopped`. | One leaking service cannot push the database into swap. | Caps set at measured peak × 1.5; rollout through autodeploy, smoke rolls back on failure. | none |
| E | **Retire idle services**: `research-stack-crawl4ai` (exited 8 days, 8.6 GB image), duplicate research image (removed), Twenty CRM (3 containers) unless the owner wants it set up. | 8–10 GB disk, ~0.3–0.5 GB RAM. | Images can be pulled again. | Decide on Twenty (see §5). |
| F | **Swap policy**: keep zram (compressed RAM) first, swapfile second; `vm.swappiness=20` so app memory stays resident and idle services get swapped. | Faster chat latency under pressure. | sysctl only, reversible. | none |
| G | **Slim app image**: torch/sentence-transformers move to an optional build stage (`WITH_LOCAL_ML=0` default) once A is live; local reranker/embedder already default off. | App image 3.4 → ~1.2 GB, faster deploys, 2 GB less per rollback copy. | Only after A and the reranker flag are confirmed unused in prod. | none |
| H | **LiteLLM → keep for now.** Bifrost (Go) uses ~3× less memory in vendor benchmarks, but LiteLLM is 0.35 GB here and carries our key-pool config; re-evaluate when RAM is still tight after A–F. | — | — | none |

Not adopted: Qdrant quantization (collection is 26 MB), moving Postgres to Neon as primary (latency from
Iran users + Neon free compute limits; Neon stays the off-site restore target), Kubernetes/Nomad (one box).

## 4. Order

1. Now: B (queued), F, image cleanup (done), E for crawl4ai.
2. A: build the `cf` backend + parity test (taskq), owner token, parity pass, switch on.
3. C and D together (one deploy, smoke-guarded).
4. G after a week of A in production.

## 5. Owner decisions

- **Cloudflare Workers AI token** (A): needed; free.
- **Twenty CRM**: it is already installed but empty. Either the owner creates the workspace and API
  key (docs/ops/CRM_SYNC.md, ~10 minutes) so customers and payments appear in a CRM, or we stop it and
  keep using the `/owner` admin console, which already lists users, payments and tickets. Recommendation:
  stop it until there are real paying customers to manage.
