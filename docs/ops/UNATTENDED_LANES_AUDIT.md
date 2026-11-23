# Unattended Lane Credential Audit & Operating Rules (T272 / R22)

**Audit Date**: 2026-11-22  
**Source Specification**: `docs/strategy/research/R22_DIGEST.md` (Stage 1 + Stage 2 Skeptical Review)  
**Security Classification**: Public Engineering Standard (No secrets, no external IP addresses)

---

## 1. Executive Summary & Policy Invariants

Following the evaluation of automated AI execution on subscription logins (R22), Roxira Platform enforces a strict architectural boundary between **interactive personal tools** and **unattended background infrastructure**:

1. **Absolute Ban on Consumer Subscriptions for Unattended Execution**:
   - Consumer subscription logins (Claude Pro/Max, Antigravity consumer, Gemini CLI consumer, ChatGPT Plus/Team) are **strictly prohibited** on unattended runners, background daemons, cron jobs, and CI/CD pipelines.
   - Terms of Service analysis:
     - *Anthropic Consumer Terms (Clause 3.7)* explicitly prohibit bot/script automation without dedicated API agreements.
     - *Google Antigravity Terms (Clause 6)* prohibit programmatic invocation in third-party product pipelines; consumer Gemini CLI authentication was decommissioned on 2026-06-18.
     - *OpenAI Terms* prohibit credential sharing and subscription rate-limit circumvention.
   - Consumer subscriptions remain reserved strictly for human interactive engineering in dedicated single-user local IDE contexts.
2. **Key-Pool Gateway Architecture**:
   - All unattended lane execution runs through the local loopback LiteLLM key-pool gateway (`http://127.0.0.1:4181/v1` on the box, forwarded via loopback SSH tunnel to production).
   - Free-tier provider models run first; paid models (e.g. DeepSeek via API) serve as capped fallback under virtual keys.
3. **Defense-in-Depth Isolation**:
   - Unattended workers operate only on public code/docs; private tenant data is never routed through free/may-log providers.
   - Credentials reside exclusively outside repositories in file-permission-locked configuration (`mode 600`).
   - Schedulers enforce non-aligned execution offsets (never on the hour `:00`) to prevent traffic synchronization and provider rate-limiting.

---

## 2. Lane-by-Lane Credential & Operating Matrix

| Lane / Bridge | Execution Context | Login / Auth Mechanism | Daily Spend & Attempt Caps | Key Injection Method | Schedule Stagger | Turn / Timeout Caps |
|---|---|---|---|---|---|---|
| **L5 (Core Ledger)** | Unattended box runner (`lane-run`) | LiteLLM Key-Pool Virtual Key (`box-lanes`) | USD \$0.50 / day; 12 attempts / day (`lane_budgets.box.json`) | Mode 600 file: `~/.config/roxira-lane/gateway.env` (`KEYPOOL_MASTER_KEY`) | Systemd timer `*:07,37` + random delay (90–330s offset) | 900s timeout per run; 1 issue in-progress cap |
| **L6 (Country Packs)** | Unattended box runner (`lane-run`) | LiteLLM Key-Pool Virtual Key (`box-lanes`) | USD \$0.50 / day; 12 attempts / day (`lane_budgets.box.json`) | Mode 600 file: `~/.config/roxira-lane/gateway.env` (`KEYPOOL_MASTER_KEY`) | Systemd timer `*:07,37` + random delay (90–330s offset) | 900s timeout per run; 1 issue in-progress cap |
| **L7 (CI Box Autonomous Tasks)** | Unattended box runner (`lane-run`) | LiteLLM Key-Pool Virtual Key (`box-lanes`) | USD \$0.50 / day; 12 attempts / day (`lane_budgets.box.json`) | Mode 600 file: `~/.config/roxira-lane/gateway.env` (`KEYPOOL_MASTER_KEY`) | Systemd timer `*:07,37` + random delay (90–330s offset) | 900s timeout per run; 1 issue in-progress cap |
| **Orchestrator (`orch.py` / `taskq.py`)** | Central queue dispatcher daemon | GitHub CLI App/Token + Keypool Master | Global: 30 attempts / day on box; 60 on server | Environment variable `ORCH_GH` + `KEYPOOL_MASTER_KEY` outside repo | Periodic polling tick with minimum 900s cooldown | Circuit breaker: trip on 3 consecutive failures for 3600s |
| **Review Desk (`review_desk.py`)** | Local and CI PR reviewer | Direct provider API keys (Gemini, Mistral, Groq, SambaNova, OpenRouter) | USD \$0.50 / day; 40 attempts / day (`lane_budgets.json`) | `~/Secrets/roxira/roxira.env` (loaded strictly in-process, mode 600) | Triggered per PR push event; max 5 PRs per execution batch | 150s per HTTP request; chunk-size capped at 90k chars |
| **Legacy Bridge (`claude -p` relay)** | Deprecated pilot (2026-11-21) | Claude Pro Subscription Login | *None* (hit 5h limit; failed pilot) | Session cookies / interactive login | None (ad-hoc polling) | **DECOMMISSIONED**: Replaced by `orch.py` and `lane-run` |

---

## 3. Detailed Operating Rules & Security Guardrails

### 3.1. Credential Ingestion & Storage
- **File System Permissions**: Environment files containing gateway tokens or SSH configuration (`gateway.env`, `tunnel.env`, `roxira.env`) MUST be set to file mode `0600` (read/write only by the operating user).
- **Prohibition of Repository Placement**: No credential file may ever reside within git-tracked workspaces or temporary shared locations (`/tmp`, `/var/tmp`).
- **Secret Redaction**: All loggers, orchestrators, and runners enforce programmatic regex stripping of high-entropy strings, provider API key prefixes (`sk-`, `AIza`, `gsk_`, `ghp_`, `gho_`), and private keys before emitting logs or stdout.

### 3.2. Egress & Network Containment
- **Loopback-Only Binding**: Unattended lane runners only connect to local endpoints (`127.0.0.1:4181`). Any attempt to pass an external IP or non-loopback `GATEWAY_URL` causes `lane-run` to immediately exit with status code 3.
- **Tunnel Encryption & Pinning**: The loopback forwarding tunnel (`roxira-gateway-tunnel.service`) authenticates with a dedicated, shell-restricted SSH key (`restrict,permitopen`) and strictly pins the destination host key in `~/.ssh/known_hosts_roxira_gateway`.
- **Egress Firewall**: Production runners enforce nftables egress filters (`agent_egress.nft`) permitting only Git remote endpoints and local tunnel sockets.

### 3.3. Execution Safety & Anti-Loop Mechanisms
- **Bot Author Blacklist**: Runners reject tasks originated by automated agents (`--author` ending in `[bot]`, `-bot`, or members of `BOT_LOGINS`).
- **Loop Prevention Label**: Work submitted by automated workers carries the tracking label `OWN_LABEL` (`lane-runner`). Runners ignore issues or PRs containing this label to prevent infinite reciprocal triggering.
- **Draft-Only PR Invariant**: Unattended workers are authorized strictly to open or update **Draft Pull Requests**. Automated merging by unattended agents is strictly prohibited; human review or the review desk merge gate is required.
- **Untrusted Prompt Isolation**: Text from issue titles, descriptions, and comments is treated as untrusted data. Schedulers wrap external strings within `<untrusted-data source="...">` tags with internal delimiter escaping to prevent prompt injection.

### 3.4. Telemetry & Audit Trails
- Every execution emits a structured JSON record to `~/.local/state/roxira-lane/logs/lane-run.jsonl`:
  ```json
  {"ts": "2026-11-22T22:00:00Z", "lane": "L5", "model_group": "agent-strong-free", "model_alias": "deepseek-v4-flash", "tokens": null, "cost_usd": 0.0, "exit": 0, "status": "ok", "git_sha": "5f38e57c", "duration_s": 42.5}
  ```
- No raw prompts, secrets, or internal server paths are recorded in telemetry logs.

---

## 4. Identified Gaps & Follow-Up Action Items

The credential audit identified the following operational gaps, tracked as follow-up engineering rows:

| ID | Area | Identified Gap | Planned Resolution |
|---|---|---|---|
| **GAP-R22-1** | CI Box | Token usage is recorded as `null` in `lane-run.jsonl` because LiteLLM `/key/info` returns aggregate tokens rather than per-request delta | Implement local token counter wrapper in `taskq-runner.sh` |
| **GAP-R22-2** | Gateway | LiteLLM server-side key expiration is manual; no automatic 90-day key rotation daemon | Add key expiration metadata to `virtual_keys.py` |
| **GAP-R22-3** | Review Desk | Local review desk relies on local `~/Secrets/roxira/roxira.env` rather than automated secret store injection | Migrate secret loading to Linux CI box secret relay |
| **GAP-R22-4** | Budget Sync | Box lane budget (`lane_budgets.box.json`) is maintained independently from server budget (`lane_budgets.json`) | Unify daily budget telemetry via weekly automated sync |
