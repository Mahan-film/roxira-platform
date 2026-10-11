# Best-practice check, 2026-10-09

Scope: read-only review of our deploy, secrets, hardening, RAG-eval and delivery approach against 2026 sources. No code or server changes. Effort: S = under 2 h, M = half a day to 1 day, L = several days.

Evidence tags: **REPO** = read in this repo today. **SRC** = a web source found today (URL given). **MEM** = my own knowledge, not re-verified; check before acting. Many web results are vendor blogs; where a claim rests on one, I say so.

## 0. Findings that matter most (read this first)

1. **The 12.9 GB image is almost certainly the default CUDA build of PyTorch.** `Dockerfile.prod` (REPO) runs `pip install sentence-transformers faster-whisper ...`, then `docling`, then `lightrag-hku`, all from default PyPI, in one stage, with `gcc` left in. On Linux x86_64 the default torch wheel pulls the `nvidia-*` CUDA libraries (several GB). A Hetzner VPS has no GPU. Sources report 9.74 GB dropping to 1.74 GB just by using the CPU wheel index (SRC https://oneuptime.com/blog/post/2026-02-08-how-to-reduce-docker-image-size-for-python-applications/markdown, SRC https://shekhargulati.com/tag/pytorch). Also `./src` and `./output_apps` are bind-mounted over the copied code (REPO compose), so the `COPY` lines add size and no immutability.
2. **The "read-only" Docker socket is not read-only, and the backend has more than the socket.** `roxira_enterprise_backend` mounts `/var/run/docker.sock:ro`, adds the docker GID, and mounts the whole repo `./:/opt/roxira_platform` read-write (REPO). That repo directory contains the server `.env` with every secret. A bug in the NestJS app (or a malicious dependency) means root on the host plus all keys. `:ro` only blocks file operations on the socket node; API calls still work (MEM, widely documented; SRC https://docs.datadoghq.com/security/default_rules/def-000-jgj describes socket-based breakout).
3. **Iran-side reachability is a product risk, not just a hardening item.** 2026 reporting says Iran ran near-total international blackouts (January 8, and again from February 28) with a whitelist model; the domestic National Information Network stayed up (SRC https://filter.watch/english/2026/03/10/investigative-report-irans-strategic-internet-shutdown-of-february-28/, SRC https://www.thenationalnews.com/future/technology/2026/05/08/iranians-reach-120-days-without-the-internet-as-blackout-continues/). One research page (machine-extracted, unverified) says Cloudflare IP ranges were put behind a DPI/NAT that cut sessions (SRC https://corpus.lantern.io/findings/2026-tuleo1-internet-analysis-shutdown__iran-dpi-not-ip-blocks/). If paying users are inside Iran, a Hetzner (Germany) origin behind Cloudflare may be unreachable during shutdowns, whatever we do on the server. This needs an owner decision (section 7).
4. **Per-IP rate limits are the wrong key for OTP, and Iranian users share IPs.** `nginx.conf` has `auth` zone 5 r/min per `$binary_remote_addr` (REPO). Mobile carriers in Iran use heavy CGNAT, so many real users share one IP, while SMS-pumping attackers spread across IPs (SRC https://stytch.com/docs/resources/policies/messaging/toll-fraud). Limit per phone number and per session in the app; keep nginx per-IP as a loose backstop.
5. **Docker publishes 80/443 straight through iptables, bypassing ufw** (MEM, well known). Use a Hetzner Cloud Firewall (free, outside the host) to allow only Cloudflare ranges on 80/443; do not rely on ufw alone.

## 1. Single-VPS compose deploy

**Current (REPO):** owner runs `deploy_local.sh` over ssh; it does `git merge --ff-only` on the server, tags current images `:prev`, `docker compose build <svcs>` on the server, `up -d --no-deps`, `sleep 20`, smoke test, auto-rollback to `:prev` + previous commit. Compose services use `restart: always`, json-file log rotation 20m x 3 (good). `pgbouncer` and `qdrant` use `:latest` (unpinned).

### 1a. Build on server vs build elsewhere and push to a registry

**Verdict: keep building on the server for now; change what is built.** Reasons:
- A registry hop helps when the build machine is cheaper or faster than the target. Here the owner is in Iran with a slow, filtered link. Pushing a 13 GB image from Iran to GHCR would be far worse than a server build; after the image is cut to ~2 GB (below) it would still be slower than building on a Hetzner box with fast pulls.
- Docker Hub blocks Iranian IPs (403, export-control notice), reported on a developer forum (SRC https://forum.terra-master.com/en/viewtopic.php?p=35651). GHCR for Iranian IPs is unconfirmed (no source found). Because the build runs on the Hetzner server, base-image pulls come from a German IP, so this does not bite. Do not build on the owner's Mac and push.
- Note a third-party report that some Hetzner IP ranges are flagged by other providers because of past sanction-evasion traffic (SRC https://blog.cloud66.com/hetzner-connectivity-issues-due-to-sanction-busting-activities, undated). If a pull ever fails with 403 from the server, that is the first thing to check.
- Revisit a registry only if build time or server load during build becomes a problem. Option then: GitHub Actions is off, so the only free way is building on the server and keeping local tags (what we do). A private registry on the same box adds nothing.

| Item | Effort |
|---|---|
| Keep server-side build | none |
| Pin `pgbouncer`, `qdrant`, `redis` to versions/digests (`:latest` can change at the next `build`/`pull` and break rollback) | S |

### 1b. Why 12.9 GB and how to cut it (expected 2-3 GB for the app image)

Causes, in order of likely size (REPO Dockerfile.prod + SRC above):
1. CUDA PyTorch and `nvidia-*` wheels pulled by `sentence-transformers`, `docling`, `faster-whisper` (via ctranslate2/torch variants), `lightrag`. Likely 6-9 GB.
2. `docling` also drags OCR/vision stacks (onnxruntime, opencv, rapidocr etc.) and downloads model weights at first use (MEM).
3. Single stage with `gcc`, `libpq-dev`, pip metadata, `COPY output_apps` and `COPY src` (which may include large data/test files; check `.dockerignore`), and no layer cache discipline.
4. Models baked in or downloaded to the container layer at runtime.

Recommended, in order of payoff:
- Install torch from the CPU index before everything else: `pip install torch --index-url https://download.pytorch.org/whl/cpu`, then the rest. With uv: `[[tool.uv.index]] name="pytorch-cpu" url="https://download.pytorch.org/whl/cpu" explicit=true` plus `[tool.uv.sources] torch = {index="pytorch-cpu"}`, as the uv PyTorch guide describes (MEM; confirm on https://docs.astral.sh/uv/guides/integration/pytorch/). Check with `pip show torch` in the image that no `nvidia-*` packages remain.
- Find what requires torch: `pipdeptree -r -p torch` (SRC https://discuss.pytorch.org/t/reducing-docker-size-with-pytorch-model/78991 mentions the approach). If `sentence-transformers` is only used for local embeddings that could run via OpenRouter/another service, or via ONNX/`fastembed`, drop it. Same question for `docling`: is it needed in the web-serving image or only in an offline ingest job? **Split into two images**: `app` (FastAPI serving, no docling, no faster-whisper unless STT runs locally) and `ingest` (docling/lightrag/batch tools, built on demand). This alone is likely the largest single saving.
- Multi-stage build: builder stage with gcc and `uv sync --frozen`, copy only the venv into `python:3.11-slim` (SRC https://community.livekit.io/t/docker-image-size-too-large-with-python-livekit-agents-2-7-gb-is-this-normal-for-production/1114).
- Lock dependencies (`uv.lock`) instead of unpinned `pip install a b c`; builds become reproducible and cacheable, and a surprise upgrade cannot break a deploy.
- Drop the `COPY src` and `COPY output_apps` lines or the bind mounts; having both is confusing. Prefer baked-in code (immutable image = true rollback) and remove the bind mounts. Add/verify `.dockerignore` (data/, archive/, backups/, node_modules, .git).
- Put model weights in a named volume or build-time download, not the image.
- Use `docker history`/`dive` on the current image once to see the actual top layers before and after (read-only, S).

Effort: CPU torch + multistage + uv lock: **M**. Splitting app/ingest images: **M-L**. Pin infra images: **S**.

### 1c. Disk hygiene automation (150 GB disk, two 13 GB images tagged live + prev)

Current: log rotation per container is set (REPO). No prune policy visible in the repo, and `:prev` tags keep a second full copy of each rebuilt image.
- After a successful deploy (inside `deploy_local.sh`, after smoke passes): `docker image prune -f` (dangling) and `docker builder prune -f --filter until=72h --keep-storage 10GB` (SRC https://docs.docker.com/engine/manage-resources/pruning.md , https://docs.docker.com/reference/cli/docker/image/prune/). Do **not** run `docker image prune -a` or `docker system prune -a`/`--volumes` automatically: it would remove the `:prev` rollback image if its container is stopped and would risk named volumes (postgres/qdrant data). Keep the existing rule in AGENTS.md section 6 (no bulk destructive commands); these two commands only touch dangling images and old cache.
- Weekly systemd timer or cron: `docker builder prune -f --filter until=168h`, and an alert (existing health cron) when `df /` passes 75%.
- Journald cap: `/etc/systemd/journald.conf.d/size.conf` with `SystemMaxUse=500M`, `SystemKeepFree=5G`, `MaxRetentionSec=14day`, then `systemctl restart systemd-journald` (SRC https://www.debugpoint.com/systemd-journald-clean/). One user reported a drop-in not taking effect until checked with `journalctl --disk-usage`; verify after applying.
- Set daemon-wide log defaults in `/etc/docker/daemon.json` (`log-driver json-file`, `max-size 20m`, `max-file 3`) so containers outside this compose file also rotate (MEM). Requires a docker restart: owner approval.
- Also rotate pg_dump backups (keep last N) and copy one off-box (already recommended in SECRETS_AND_SAFE_DEPLOY section 4).

Effort: **S**. Needs owner approval to edit files on the server.

### 1d. Zero downtime at this scale

Current: `up -d --no-deps` recreates the container (a gap of seconds), then `sleep 20` (REPO). 
**Verdict: do not adopt a platform (Kamal, Coolify, dokku); do fix the wait.** One server, one owner, low traffic: a few seconds of 502 behind Cloudflare is acceptable if it is handled well.
- Replace `sleep 20` with polling `docker inspect --format '{{.State.Health.Status}}'` (up to 90 s) or `docker compose up -d --wait` (MEM; verify on server compose version). The compose healthchecks already exist for most services (REPO).
- Smoke test should compare the SHA reported by `/health` to the target SHA (already suggested in SECRETS_AND_SAFE_DEPLOY section 4 gap 4).
- Cheap real zero-downtime if ever needed: `docker-rollout` plugin (scale to 2, wait healthy, remove old) (SRC https://github.com/wowu/docker-rollout via search summary; verify). It needs nginx to re-resolve upstream names: use `resolver 127.0.0.11 valid=10s;` and a variable in `proxy_pass`. Only worth doing for the stateless services (frontend, backend, app), not postgres/qdrant. Your nginx already uses `$judge_backend` variables in at least one location (REPO), which is the right pattern.
- Also set Cloudflare to serve a friendly "origin unavailable" page rather than a raw 502 (free).

Effort: wait loop **S**; rollout plugin **M** (optional, defer).

## 2. Secrets on a single VPS

**Current (REPO + STATE.md):** local `~/Secrets/roxira/roxira.env` (chmod 600) pushed to server `.env` via `set_server_env.sh`; compose `env_file: .env` plus `${VAR:?}` interpolation. Existing research (SECRETS_AND_SAFE_DEPLOY_2026-10.md) recommended sops + age locally.

**Verdict: keep the .env-on-server model; adopt sops+age on the Mac only if the plaintext local file remains a leak risk; do not adopt Docker secrets, Infisical or Doppler now.**
- Docker's own docs recommend files over env vars, via `*_FILE` variables (SRC https://docs.docker.com/engine/swarm/secrets/), but that page frames secrets for swarm; compose supports file-based `secrets:` for standalone use (MEM). Every service would need `*_FILE` support in code: Medium effort, small gain on one box where the root user can read both anyway. The real exposure is not the file at rest but (a) the repo mount into the backend container (point 0.2), (b) `docker inspect` showing env, (c) incidents where values got into chat/git. Fix (a) first.
- Doppler free (3 users) and Infisical cloud add a hosted dependency and an Iran/sanctions reachability risk that the earlier research could not test (REPO doc). Infisical self-host means running another Postgres+Redis stack for one person. Skip.
- sops + age remains the best fit for the Mac side (offline, free, no SaaS). Adopt when time allows: encrypt `roxira.env`, run scripts under `sops exec-env`. The plan in the existing doc stands (steps 4-5).
- Quick wins now: mount only what the backend needs instead of `./:/opt/roxira_platform` (see section 3); `chmod 600` and root ownership on server `.env` (already planned); one OpenRouter key per purpose with a spend cap (REPO doc; API supports `limit`/`expires_at`); keep a rotation register.
- Git hygiene: gitleaks pre-commit (currently "feature complete" with Betterleaks as successor per the repo doc); GitHub push protection is on for public repos.

Effort: stop mounting repo/.env into backend **S-M**; sops+age **M**; the rest already planned.

## 3. Docker socket in the NestJS container

**Current (REPO):** `/var/run/docker.sock:ro`, `group_add: DOCKER_GID`, plus repo mounted rw, used for `GET /health/system` (container status) and "Tech Radar" live script execution. Also `enterprise_app` mounts the host `/usr/bin/docker` binary.

**Verdict: change. Remove the need rather than filter it.**
- Anything that can talk to the socket can start a privileged container mounting `/`, i.e. root on the host (SRC https://answers.securityscientist.net/q/21262/what-is-docker-socket-exposure-and-why-is-it-so-dangerous, SRC https://securelayer7.net/learn/containers/what-is-the-docker-socket). `:ro` on the bind mount does not restrict API methods (MEM).
- Best option, removes the dependency: have a host cron/systemd timer (already exists for host health, per compose comment) write `docker ps --format json` / health to a JSON file in a small read-only shared directory; the NestJS endpoint reads that file. No socket, no docker binary, no group. Effort **S-M**.
- Second option: `tecnativa/docker-socket-proxy` with `CONTAINERS=1`, `POST=0`, everything else 0, on an internal network only the backend joins (SRC https://github.com/tecnativa/docker-socket-proxy). Caveats: the proxy itself mounts the socket; it needs elevated privilege; and a search result reports **CVE-2026-78122** (HAProxy rules in <= 0.5.0 allow read-only `/containers` endpoints like filesystem archive, logs and `/top` to leak when `CONTAINERS=1`; sources disagree on whether a fix exists: https://app.opencve.io/cve/CVE-2026-78122, https://feed.craftedsignal.io/briefs/2026-08-docker-socket-proxy-auth-bypass/). I did not verify the CVE details; check before using. Since `CONTAINERS=1` would expose container env (and thus secrets) via inspect, this is weaker than the file approach.
- Whatever is chosen: drop the `./:/opt/roxira_platform` rw mount. Tech Radar script execution should use a read-only mount of just the scripts and reports directory (or move that job to a host timer). Add `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true` with tmpfs for the backend, as a hardening default (MEM; test before enabling).
- Remove the `/usr/bin/docker` mount from `enterprise_app` if unused.

Effort: **M** overall (file-based health + narrower mounts). Needs owner approval (compose is L4).

## 4. nginx behind Cloudflare: hardening checklist

**Current (REPO nginx.conf):** `server_tokens off`; TLS 1.2/1.3; `set_real_ip_from` list of 15 Cloudflare ranges with `real_ip_header CF-Connecting-IP` (good, but hard-coded); rate zones `auth` 5 r/min and `api` 30 r/s per IP; headers: nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, **HSTS max-age=300**, CSP **Report-Only**; Let's Encrypt cert for `ghazihoushmand.ir` mounted from the host; no `ssl_verify_client`.

Checklist (priority order):
1. **Origin firewall.** Hetzner Cloud Firewall (free, evaluated before the VM; not bypassed by Docker's iptables rules): allow 80/443 only from Cloudflare ranges (https://www.cloudflare.com/ips/), allow 22 only from owner IPs (note: owner is in Iran; ssh from a fixed jump IP or use key-only plus fail2ban rather than IP allow-listing that could lock the owner out). Update ranges monthly; add a script that diffs the nginx `set_real_ip_from` list against the live list. Effort **S**.
2. **Authenticated Origin Pulls (mTLS).** Download the Cloudflare AOP CA, set `ssl_client_certificate` and `ssl_verify_client optional` first, check logs, then `on`; enable in the Cloudflare dashboard (SRC https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/). SSL mode must be Full (strict). This stops anyone who finds the origin IP from talking to nginx, even if the IP allow-list drifts. Test with curl directly against the origin IP (should fail). Note the AOP cert is Cloudflare's shared cert (anyone with a Cloudflare account could present it), so keep the IP firewall too (MEM). Effort **S-M**; nginx is L4, owner applies.
3. **Real-IP correctness.** Keep `real_ip_header CF-Connecting-IP`; make sure `X-Forwarded-For` passed upstream is built from the real IP; the `limit_req_zone` key must use the real client IP (it does via `$binary_remote_addr` after realip, REPO). Add `real_ip_recursive on`.
4. **OTP/SMS abuse controls** (SRC https://stytch.com/docs/resources/policies/messaging/toll-fraud, https://gatewayapi.com/help-center/what-is-sms-traffic-pumping-fraud/): in the NestJS auth service, limit per phone (for example 3 sends per 5 minutes and 10 per hour; thresholds are a vendor suggestion from https://tasrieit.com/blog/cloudflare-rate-limiting-production-patterns, tune them), 60 s resend cooldown, per-IP/device cap, validate Iranian mobile format (+98 9xx) and reject others unless allowed, daily global send cap with alert, monitor OTP verify rate. Add Cloudflare rate-limiting rule on the OTP path in log mode first (SRC https://developers.cloudflare.com/waf/custom-rules/rate-limiting). Per-IP only in nginx (`limit_req_zone ... rate=5r/m`, `burst=3`), loose enough for CGNAT. Kavenegar/sms.ir cost is the thing being protected; set the provider-side daily cap too. Effort **M** (app logic).
5. **Security headers.** Move HSTS from 300 s to 6 months after a clean week (add `preload` only if all subdomains are HTTPS). Promote the CSP from Report-Only to enforced after reviewing reports; the current policy allows `'unsafe-inline'` scripts, so it adds little; plan nonces in Next.js later. Add `Cross-Origin-Opener-Policy` and `X-Content-Type-Options` is already there. Headers are repeated in four server blocks (REPO): move them to an `include` snippet. Effort **S** for HSTS/include; **M** for enforced CSP.
6. Other: `client_max_body_size 50M` globally; restrict to upload routes. Add `ssl_session_tickets off`, `ssl_prefer_server_ciphers off`, OCSP stapling. Block `/admin`, `/docs` (OpenAPI), `/metrics` at nginx (STATE.md says `/admin` already 404 after next deploy). Cloudflare: turn on Bot Fight Mode, set a WAF custom rule for `/api/*/otp` paths, keep "Always HTTPS". `nginx -t` before reload (done in deploy script).
7. Postgres/Redis/Qdrant already bind to 127.0.0.1 (REPO): keep it; verify with `ss -tulnp` per AGENTS.md section 7.

## 5. Legal RAG eval

**Current:** plan = 50-question Persian set, Promptfoo gate in `local_ci` (STATE.md, TOOLS_ADOPTION). Bake-off (BAKEOFF_2026-10-04.md) measured models without RAG: best pass rate 0.23. Collection `iran_laws_mistral_v1`, 1,444 articles. Reranker plan: bge-reranker-v2-m3 behind a flag.

### 5a. Promptfoo vs Ragas vs DeepEval
**Verdict: keep Promptfoo as the gate; do not add Ragas/DeepEval yet.**
- Comparison articles agree: Ragas = deepest RAG metrics but no CI assertions and a fading maintenance signal (last commit Feb 2026 per one roundup); DeepEval = pytest-style CI; Promptfoo = YAML, prompt/model comparison, red-team (SRC https://qaskills.sh/blog/promptfoo-vs-deepeval-vs-ragas-2026, https://aicoolies.com/comparisons/ragas-vs-deepeval-vs-promptfoo). These are mostly vendor-affiliated blogs; no neutral benchmark exists.
- For a legal citation task the most valuable metrics are **deterministic**, not LLM-judged: (1) retrieval hit: is the gold article ID in top-k (recall@k, MRR); (2) citation validity: every cited article exists in the corpus (`citation guard`, already built); (3) citation correctness: cited article set contains the gold article; (4) refusal when no support. These need no judge model. Do them as Promptfoo `javascript`/`python` assertions on JSON output, plus a standalone Python script for retrieval metrics.
- Use an LLM judge only for "answer is supported by the cited text" on a small slice, from a different model family than the generator, and never send case data to a `:free` model (AGENTS.md rule 4). The bake-off already uses strict citation criteria; add the same to the RAG run (the 0.23 figure is without RAG).
- 50 questions are enough to catch regressions, not to rank models finely (a difference of 3-4 questions is noise). Keep a second, held-out set of 20-30 not used for prompt tuning; have a lawyer verify gold articles (STATE.md already says the Deep Research draft is unverified).
- Promptfoo is now part of OpenAI (repo doc, TOOLS_ADOPTION); keep `PROMPTFOO_DISABLE_TELEMETRY=1` (repo doc marks the variable name unverified: check) and keep configs provider-neutral.
Effort: **M** (set + scripts), as already planned.

### 5b. Reranker
**Verdict: keep bge-reranker-v2-m3 as the default behind a flag; evaluate one alternative.**
- bge-reranker-v2-m3: Apache-2.0, 0.6B, multilingual (SRC https://www.promptlayer.com/models/bge-reranker-v2-m3). I found no published number on Persian legal text (search result gap), so the claim "good for Persian" is unverified; the only way to know is your eval set: recall@5 with and without it.
- Alternative: Qwen3-Reranker (0.6B/4B/8B). One third-party table lists Qwen3-Reranker-4B 72.74 vs bge-reranker-v2-m3 58.36 on MMTEB-R (SRC https://dev.to/farrruh/mastering-text-embedding-and-reranker-with-qwen3-5455; a blog table, not Persian-specific). The 0.6B variant is the realistic CPU option; the 4B/8B need a GPU or an API. A GPU-less Hetzner box will make reranking 20 candidates per query slow; consider running it only on the top 20 and caching.
- Cheap trick first: because the corpus is structured by article, boost exact-article/regex matches ("ماده ۱۰") before any reranker; the repo already has exact-article lookup.

### 5c. Embeddings
**Verdict: change candidate, test before changing. Do not re-index production until an eval shows a gain.**
- FaMTEB (63 datasets, EMNLP 2025 Findings) is the Persian benchmark (SRC https://arxiv.org/abs/2502.11571).
- **Hakim** (124M params, a Farsi-specific embedder) reports FaMTEB 73.81 vs bge-m3 65.29 (567M), jina-v3 64.53, multilingual-e5-large 64.40 (SRC https://arxiv.org/html/2505.08435v3). Hakim-small (38M) gets 70.45. It is smaller and faster than bge-m3 on CPU. I could not confirm its license or availability from the fetched text; check Hugging Face before depending on it. Benchmarks are on general Persian tasks, not statutes.
- Qwen3-Embedding (0.6B-8B) leads English-centric multilingual MTEB (SRC https://arxiv.org/pdf/2506.05176) but I found no Persian-specific score.
- Note the collection name `iran_laws_mistral_v1` implies Mistral embeddings via API (REPO log: "migrate RAG pipeline to iran_laws_mistral_v1"), which sends article text, not case data, to a third party; fine for public law. For case text keep embeddings local (bge-m3 or Hakim).
- Plan: run the 50 questions against three embedders into three throw-away Qdrant collections (1,444 articles is tiny: minutes of work), compare recall@5/MRR, with and without the reranker. Production ingest into a new collection with a switch, as STATE.md already requires.
Effort: **M**.

## 6. Multi-model agent orchestration for a solo owner

**Current (STATE.md + AGENTS.md):** hub (Opus-class strategist) never merges or deploys; workers are cheap models (`rx <issue> dsflash`) or Claude `implementer` subagents in worktrees; `reviewer` subagent must be a different family; autonomy ladder L0-L4 gates paths; model roles in `config/models.yaml`.

**Verdict: keep. The split matches what practitioners converge on; the weak points are cost of the hub and review reliability, not the structure.**
- Separate builder and reviewer, reviewer read-only, preferably a different model family, is the common recommendation in 2026 (SRC https://codex.danielvaughan.com/2026/04/07/cross-model-review-loop-automation/, https://github.com/atompilot/claude-code-cross-review). Evidence is practitioner reports, not controlled studies. OpenAI's own plugin warns review gates can loop and burn usage; supervise (SRC https://www.mindstudio.ai/blog/openai-codex-plugin-claude-code-cross-provider-review).
- Keep teams small (3-5 agents) and cost scaling in mind (same Codex-oriented guide, https://codex.danielvaughan.com/2026/05/18/multi-agent-orchestration-patterns/).
- The path-based autonomy ladder is stronger than anything off-the-shelf: it bounds blast radius deterministically. Keep.
- Gaps worth fixing: (1) rx not wired to `task_caps.py` (STATE.md open work): cap spend/iterations per task so a looping cheap worker cannot run up cost; (2) enforce the reviewer by a script gate in `local_ci` (diff size limit, tests present, no L3/L4 paths) rather than by convention; (3) the Gemini reviewer's own score on the legal bake-off is only 0.23, so for legal-reasoning prompts the reviewer should check **citations against the corpus mechanically**, not by judgment; (4) the hub is the expensive part: keep its context small via `docs/STATE.md`, handoffs, and the codebase-memory MCP (already the practice).
- No tool I found beats this for a solo owner on a zero budget. OpenCode/Brick style routers promise 60-80% savings, but those figures are self-reported vendor numbers (SRC https://regolo.ai/opencode-brick-for-multi-agent-coding-and-optimize-costs-up-to-80.md); not worth adding a router layer when roles already map to models in `config/models.yaml`.
Effort for the gaps: **M**.

## 7. Iran-specific delivery

**Current (REPO):** Cloudflare proxy in front of a Hetzner origin; Let's Encrypt certs; frontend Next.js; Kavenegar/sms.ir for OTP; Google OAuth login; `public/factory/index.html` references a Google or CDN host (grep matched `fonts.googleapis`/`unpkg`/`jsdelivr` patterns in it and in `DESIGN.md`; the main app does not use `next/font/google` by grep).

Findings and recommendations:
1. **Cloudflare reachability from Iran is unreliable in 2026.** Iran's January and post-February-28 blackouts left only whitelisted services reachable (SRC filter.watch, The National, links in section 0). A reported (unverified) detail is DPI cutting sessions to Cloudflare IPs. Cloudflare Radar (https://radar.cloudflare.com) and NetBlocks give live status; make it part of the monitoring.
2. **Decision for the owner: who are the users and when must they be served?** If users are in Iran during shutdowns, the only designs that work are hosting inside the National Information Network (an Iranian datacenter/VPS and an Iranian CDN) behind a domestic domain (.ir), possibly with the Hetzner stack as the AI backend reachable over an allowed path. Iranian CDNs exist (ArvanCloud and others). Note ArvanCloud was sanctioned by US Treasury (June 2021) and removed from the EU list in April 2024 (SRC https://www.rferl.org/a/iran-us-sanctions-internet-censirship-arvan-cloud/32442065.html, https://tehranbureau.com/softqloud-and-arvancloud-controversially-removed-from-sanctions-list/). Sanctions and the owner's bank/payment channels are legal questions for the lawyer, not for me. If the diaspora and international users are the target, Cloudflare remains correct.
3. **Cheap resilience step regardless:** a static status/landing page and the OTP + login pages should work with no third-party calls, so a partially reachable network still loads them.
4. **Self-host everything the browser loads.** Google Fonts, `unpkg`, `jsDelivr`, Google Tag Manager and Google Identity scripts are unreliable or blocked from Iran. Self-host the Persian font (Vazirmatn is under OFL; bundle via `@fontsource/vazirmatn` or `next/font/local`), icons, and any script. Use a CSP to catch leftovers (`script-src 'self'`). Fix `public/factory/index.html` or remove it from production. Google OAuth: login with `accounts.google.com` may not load from Iran at all, so keep OTP login as the primary path and treat Google login as optional.
5. **Docker/registry/package access from Iran.** Docker Hub 403s Iranian IPs (SRC above); GitHub restricts some features for Iran (SRC https://www.abhs.in/blog/iran-sanctions-developers-github-npm-blocked-2026, a 2026 developer blog; unverified). The owner's workflow should not depend on pulling images from the owner's network: all builds and pulls happen on the Hetzner server; the owner only runs ssh and git push. Keep that.
6. **Backup / DNS independence.** Keep DNS at a registrar you control and a second NS or low TTL so you can switch to an Iranian CDN or a different origin quickly (MEM). Keep an off-box encrypted DB backup on the owner's Mac (already recommended).
7. **Latency from Iran to Germany** is high and variable; make pages light (no heavy JS), enable Cloudflare compression/Brotli, long cache for static assets.

Effort: self-host fonts/scripts **S**; decision + domestic mirror **L** (owner decision first); monitoring **S**.

## 8. Prioritized change list (top 10)

1. Rebuild `Dockerfile.prod` with CPU-only torch, multi-stage, uv lockfile; split ingest/docling out of the serving image (12.9 GB to roughly 2-3 GB). **M**
2. Remove the Docker socket and the rw `./:/opt/roxira_platform` mount from the NestJS backend (host cron writes health JSON; narrow read-only mounts); drop `/usr/bin/docker` mount from the app. **M**
3. Owner decision on Iran-side reachability: if users are inside Iran, plan an NIN-hosted front/API (domestic host + CDN) instead of relying only on Cloudflare + Hetzner. **L (decision first)**
4. Hetzner Cloud Firewall allowing 80/443 only from Cloudflare ranges (Docker bypasses ufw), plus Authenticated Origin Pulls on nginx. **S-M**
5. OTP abuse controls in the app: per-phone and daily caps, resend cooldown, +98 validation, spend alert; keep nginx per-IP loose (CGNAT). **M**
6. Post-deploy prune policy: `docker image prune -f` and `docker builder prune --filter until=72h --keep-storage`, journald `SystemMaxUse`, `df` alert; never `-a`/`--volumes` automatically. **S**
7. Replace `sleep 20` with a health-status poll and SHA check; pin `pgbouncer`, `qdrant`, `redis` images. **S**
8. Self-host Persian font and all scripts; remove Google/CDN references from `public/factory/index.html`; make OTP login primary (Google login optional). **S**
9. Build the 50-question set with deterministic checks (gold-article recall@k, citation validity, refusal) in Promptfoo; compare bge-m3, Hakim, and the current Mistral embeddings, with and without bge-reranker-v2-m3 (and Qwen3-Reranker-0.6B), before any re-index. **M**
10. HSTS to 6 months, enforce CSP after review, move repeated headers into one include; sops+age for the local secrets file; wire `rx` to `task_caps.py` and gate reviewer rules in `local_ci`. **S-M each**

## Limits of this review
- Web search results are partly vendor blogs; CVE-2026-78122 details, Hakim licensing, Qwen3 vs bge reranker numbers on Persian, Cloudflare DPI claims, and GHCR reachability from Iran were NOT verified from primary sources.
- I did not touch the server, so disk usage, running image layers, and actual Cloudflare/firewall state are unknown; run `docker history`, `docker system df`, `ufw status`, `iptables -S DOCKER-USER`, and `ss -tulnp` read-only before acting.
- Current Iranian connectivity (October 2026) was not available; check NetBlocks and Cloudflare Radar.
