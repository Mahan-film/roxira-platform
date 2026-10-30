# Factory gap audit against the owner's reference architecture (2026-10-30)

Read-only audit of the repo, srv1 and the owner's Mac. Reference: the five-layer "fully automated software factory"
report the owner supplied. Key names and counts only; no secret was read.

## 1. Live evidence
- **srv1**: 4 vCPU, 7.5 GB RAM, swap 4.1 GB used, disk 81 %. 16 containers healthy. Deployed = `origin/main`
  (75f1f67d), last autodeploy check 2026-10-30 09:15 UTC. No failed SHA recorded since 2026-10-23.
- **taskq**: 46 tasks, 33 done, 13 failed. Key pool last report: 78 % of calls free, $3.50 paid.
- **Mac**: Antigravity app (owner-run, no agent access), OpenCode, Aider, Goose, Codex, Gemini CLI, `rx` installed. Nothing listens
  on 4000 or 20128, so the Mac LiteLLM and OmniRoute are down and `rx` steps 2-3 will fail until they are started.
- **GitHub**: no claimed issues; 14 relay data PRs (#867-#877 range) waiting, in same-day pairs that look duplicated.
  Agent PRs #840, #843, #844, #855 are still draft or on hold.
- **`STATE.md`** was last updated 2026-10-22.

## 2. Layer by layer
| Layer | Reference | We have | Verdict |
| --- | --- | --- | --- |
| 1 Research + spec | DeerFlow, MetaGPT | research service (SearXNG + Tavily), radar timers, `brief_to_spec.py`, `HOUSE_STACK.md` | **Covered.** Skip MetaGPT and DeerFlow unless a bake-off beats `brief_to_spec.py` |
| 2 Gateway | LiteLLM + Postgres + Redis, MCP gateway, budgets | LiteLLM 1.77.7 key pool with ladders, cost log, per-key cooldown | **Gaps:** image has 45 Critical CVEs; no shared MCP gateway; budgets not per lane (#843 on hold) |
| 3 Parallel agents | OpenHands + ACP | taskq + OpenCode + worktrees + workbench + model ladder | **Mostly covered.** Missing reviewer automation and an architect template (#843). OpenHands stays a bake-off candidate |
| 4 Sandbox | gVisor or E2B, no egress | Checks run in hardened `--network none` containers. **The agent itself runs on the production host** as `roxira-agent`, under runc, with no gVisor and no egress control. Daytona backend is built, 4 keys exist, but `WORKBENCH_BACKEND` is not set in the taskq unit | **Largest gap** |
| 5 Deploy + templates | Coolify/Dokploy/Openship, template library | Autodeploy with backup, migrate, smoke, rollback and Gate 4; `projectctl` multi-project deploy; `saas-chassis`, `roxira-fullstack`, `roxira-static-rtl`, `preview` | **Deploy covered.** Only one project has used it. No shop, CRM-marketing or AI-chat templates |
| Cost metric | Cost per accepted task | Cost per call and per answer | **Gap:** taskq does not record cost against accepted tasks |

## 3. Decisions
Do not install on srv1: Coolify, Dokploy, n8n, Paperclip, OpenHands, MetaGPT. The box has 7.5 GB RAM with swap in use,
nginx owns 80/443, and autodeploy plus timers already do this work. Any of these goes on a separate server, and only
after a measured win on our own tasks (`FACTORY_V2_2026-10-22.md` §5).

**Report prices checked against the OpenRouter catalogue today** ($/M in, out):
| Model | Report (GPTProto) | OpenRouter |
| --- | --- | --- |
| gpt-6-luna | 0.08 / 0.40 | 0.10 / 0.50 |
| claude-haiku-5.5 | 0.09 / 0.45 | 0.10 / 0.50 |
| glm-5.3-flash | 0.15 / 0.50 | 0.15 / 0.50 |
| deepseek-v4.1-flash-1017 | 0.30 / 1.20 | 0.30 / 1.20 |
| deepseek-v4.1-flash (plain) | not listed | 0.045 / 0.50 |
| minimax-m3 | 0.48 / 0.96 | 0.30 / 1.20 |
| gemini-3.8-flash | 0.90 / 4.50 | 0.825 / 4.125 |
| grok-4.7 | 1.20 / 3.60 | 2.00 / 6.00 |

GPTProto answers on `/v1/models` but we hold no key and its rates are unverified. Treat it as an optional paid rung,
tested in a bake-off, never the base of the ladder. The report's "under $2 per web app" is unmeasured; the new
cost-per-accepted-task metric will produce our real number.

## 4. Execution order
**P0, safety and hygiene**
1. Sandbox agents on srv1 (decided after probing: the agent user could reach Postgres, Redis and Qdrant on loopback):
   a transient systemd unit plus a uid-scoped nftables table, with a pre-run control test that fails closed
   (`agent_sandbox.sh`, `agent_egress.nft`, `install_agent_sandbox.sh`). The kernel stays shared; Daytona remains the
   next step for checks. Tasks must use the gateway or HTTPS only.
2. Rebuild the key pool on a patched LiteLLM image, side by side, checking `/v1/embeddings` first (the known blocker).
3. Triage relay data PRs, stale draft PRs and the 13 failed taskq tasks. Refresh `STATE.md`.

**P1, cost and throughput**
4. Add cost per accepted task to taskq. Revive #843 (lane budgets, architect template). Automate the cross-family reviewer.
5. UI lane: the owner runs Antigravity by hand on the laptop and relays reports; Claude reviews. No `agy` automation.

**P2, capability**
6. MCP gateway: Playwright MCP and GitHub tools behind one endpoint, read-only by default.
7. Bake-off on our own tasks: OpenCode vs OpenHands vs Aider, and GPTProto rungs.

**P3, personal projects**
8. A second cheap server with `projectctl`, so personal apps never share a box with production.
9. New templates, built only when a real personal project needs one.

**Added 2026-10-30:** fix the DR backup first, because it blocks recovery. Key and cluster jobs are in
`docs/infra/KEY_INVENTORY.md`. Personal projects use existing templates first, then one open source base per project,
chosen when the project is named.

## 5. What the owner must do
- Name the first personal project; it decides which template is built first.
- Approve any second server (recurring cost).
- Lift the 2026-10-22 hold on operator agents, or P0.1 and P1 cannot start.
