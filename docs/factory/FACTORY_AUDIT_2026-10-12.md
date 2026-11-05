# Roxira software-factory audit (2026-10-12)

Scope: developer tooling on the owner's Mac (16 GB). No production access. Smoke tests used
non-sensitive prompts; total paid spend for this audit was about $0.01 (OpenRouter key counter
moved from $0.0248 to about $0.032 for the day, which includes one OpenCode edit, one Aider edit,
one Goose "pong").

## 0. Executive summary

- The tools are mostly installed and mostly working. The real problems are wiring and
  hygiene, not missing software: one MCP server is dead (stale lock), OmniRoute's
  "auto" combos route into broken providers, LiteLLM cannot resolve DNS from its container,
  and the **OpenRouter account balance is only about $6.19** (credits 125.06, used 118.87).
- Three gateways overlap (OmniRoute :20128, LiteLLM :4000, direct OpenRouter). That is
  the lock-in-free design the owner asked for, but nobody documents which tool uses which.
  Section 4 fixes that with one rule table.
- Biggest cost lever is not a new tool: it is routing mechanical edits to DeepSeek V4.1 Flash
  (about $0.05 per 100k-token task) and keeping Opus to planning only.

## 1. Inventory (verified 2026-10-12)

| Tool | Status | Version | Smoke test |
|---|---|---|---|
| OpenCode | WORKING | 1.18.34 (`~/.opencode/bin/opencode`) | Headless edit via `dispatch_opencode.sh`, 12 s, one file created, correct diff |
| Goose | WORKING | installed `~/.local/bin/goose`; config: openrouter + deepseek/deepseek-v4.1-flash | `goose run -t ... --no-session` answered "pong". Note: needs `~/.local/state/goose/logs` writable (fails inside the Claude sandbox, fine in a normal terminal) |
| Aider | WORKING | 0.86.2 (`/opt/homebrew/bin/aider`) | Edit with `openrouter/deepseek/deepseek-v4.1-flash`, cost $0.00034 |
| Claude Code | WORKING | 2.1.296 | (this session) |
| RTK | WORKING | 0.50.0 | `rtk gain`: 1515 commands, 209.6K tokens saved (59%) |
| OmniRoute | WORKING (partly) | docker `diegosouzapw/omniroute:latest`, healthy 10 days, bound to 127.0.0.1:20128 | `/api/health` 200; `/v1/models` lists 491 ids; `team-coding` combo answered via Codestral; `oc/deepseek-v4-flash-free` returned 401 "not supported"; `auto/deepseek` failed ("dva" provider: `DEVIN_AGENTIC_HOME must be an absolute path`); `/api/usage/analytics` is 403 for the API key (dashboard session auth) |
| LiteLLM "pool" | WORKING | docker `litellm:main-stable`, 127.0.0.1:4000 | `/health/liveliness` 200. Logs show `openrouter.ai: Temporary failure in name resolution` from inside the container, so the `dsflash` pool alias (OpenRouter) falls over; Groq/Mistral/SiliconFlow aliases are separate |
| qmd | WORKING | 2.8.3 | status: 27 docs, 150 vectors, collection `roxira-docs` |
| gh | WORKING | 2.97.0 | |
| docker | WORKING | 29.8.0 | not reachable from the Claude sandbox (socket denied); fine from a terminal |
| engram | WORKING | 2.2.1 | `engram doctor`: 9/9 ok |
| ollama / local models | NOT INSTALLED | no `ollama`, no `~/.ollama` | Fine for 16 GB; see 4.5 |
| Crush | NOT INSTALLED | | |
| codebase-memory MCP | **BROKEN** | binary 0.10.8 | see 1.1 |
| context7 | configured (HTTP MCP), not tested | | |

### 1.1 codebase-memory-mcp: why it will not connect

Symptom (Claude Code mcp-logs, repeatedly): `CBM daemon could not start within 30000 ms`.
Running the binary by hand: `CBM CLI could not start because a pre-coordination or unverified CBM
generation is active`. The daemon's own log shows every index worker failing with the same message,
so the graph has not been refreshed since 2026-10-03 (`Users-mac-Developer-roxira-platform.db` is
dated Oct 3).

Root cause: stale version-cohort lock state in `/tmp/cbm-daemon-501/`. The file
`cbm-version-cohort-lifetime-v1.lock` records build `144f813a...` while the installed binary is build
`996bad5f...` (the binary was updated in place on a machine where the previous generation never shut
down cleanly). No CBM process is running and no process holds the lock (checked with `ps`, `lsof`).
Pointing `CBM_CACHE_DIR` somewhere else does not help because the coordination dir is per-uid in `/tmp`.

Proposed fix (owner terminal, reversible, state files are recreated on start; I did NOT run it
because it is outside the repo):

```bash
pgrep -fl codebase-memory || echo "no cbm processes"   # must print the second line
rm -rf /tmp/cbm-daemon-501                             # coordination locks only, not the graph DBs
codebase-memory-mcp cli list_projects                  # should now print projects
```

If it still fails: `codebase-memory-mcp update -y`, then repeat. Housekeeping: `~/.cache/codebase-memory-mcp`
is 1.0 GB (16 project DBs, one per old worktree, plus 3,948 log files); delete DBs for worktrees that no
longer exist with `codebase-memory-mcp cli delete_project <name>`. Prevent recurrence: after any
`brew`/`update` of the binary, quit all Claude sessions first.

## 2. Keys and providers (names only; values never read)

`~/Secrets/roxira/roxira.env` (names): OPENROUTER_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY,
SAMBANOVA_API_KEY, KIRA_API_KEY, OMNIROUTE_API_KEY (+ OMNIROUTE_BASE_URL),
JINA_API_KEY, EXA_API_KEY, BRAVE_SEARCH_API_KEY, FIRECRAWL_API_KEY, TAVILY_API_KEYS,
ASSEMBLYAI_API_KEYS, plus app secrets (Zibal, Kavenegar, Google OAuth, JWT, DB).
`~/.config/litellm/keys.env` (names): GROQ_KEY_1..3, MISTRAL_KEY_1..4, SILICONFLOW_KEY_1..3,
OPENROUTER_API_KEY, LITELLM_MASTER_KEY.

| Provider | Key present | Wired into | Status / note |
|---|---|---|---|
| OpenRouter | yes (one key, $4/day cap, balance about $6.19) | opencode.json (repo), Goose, Aider, LiteLLM `dsflash`, product runtime (llm_router) | OK. Single key is shared by dev and prod usage: no isolation |
| Mistral | yes (1 in roxira.env, 4 in LiteLLM) | opencode repo config, LiteLLM `codestral`/`mmedium`, OmniRoute `team-coding` | OK, free Codestral tier is the best free coder |
| Groq | yes (1 + 3) | LiteLLM `gptoss`/`qwen` (global opencode default model is `pool/gptoss`) | repo docs say 403 and excluded; the LiteLLM keys may differ: run `check_keys.py` |
| SiliconFlow | 3 keys (LiteLLM only) | `glm`, `dspro` aliases | labelled "needs credit" |
| SambaNova | yes | opencode.json provider with EMPTY model list | **configured but unusable** (no model ids) |
| KIRA | yes | product code only | not a builder-tool provider |
| Jina / Exa / Brave / Firecrawl / Tavily | yes | research scripts / SearXNG fallbacks | unused by agents as MCP tools |
| AssemblyAI | yes | STT bake-off | n/a |
| OmniRoute | yes | opencode (repo + global), rx `team` alias | OK but see 1; global config expects `OMNIROUTE_OPENCODE_KEY`, a name that is NOT in roxira.env (that var is not exported in my shell), so the global OmniRoute provider only works if set elsewhere |
| ChatGPT/Codex, Gemini, xAI OAuth | `~/.config/goose/{chatgpt_codex,gemini_oauth,xai_oauth}` dirs exist | Goose possible providers | Codex first in rx chain but docs say exhausted/unsupported from Iran; verify before relying |

## 3. Gaps: configured but unused, and broken

Broken
1. codebase-memory MCP (stale lock, 1.1). Structural queries fall back to grep.
2. OmniRoute combos `auto/*` route into the Devin ("dva") and Cloudflare ("cfp") providers that error; `oc/deepseek-v4-flash-free` rejected. Only `team-coding` was proven healthy. 491 listed models, most are web-scraped free providers (aihorde 166) of unknown retention: treat as non-sensitive only.
3. LiteLLM container DNS failure for openrouter.ai (Docker Desktop DNS). `pool/dsflash` is therefore unreliable; direct `openrouter/...` in OpenCode is not affected.
4. OpenRouter balance about $6.19 against a $4/day key cap: one bad loop can empty the account.
5. `rx` chain starts with `codex`; if Codex is exhausted each run pays a failed first attempt.
6. Legacy root scripts (`autonomous_agent_factory.py`, `factory_engine.py`, `factory_dispatch_api.py`, daemons) hardcode `/opt/roxira_platform` and server paths. They are server-side artifacts, not Mac tooling.

Configured but unused
- SambaNova (free/fast capacity), Jina rerank/Exa/Brave/Firecrawl as agent tools.
- OpenCode `serve`/`--attach` (listed as an open spike in STATE.md); OpenCode is only used as a one-shot `run`.
- Goose recipes/scheduler (enabled, no recipe in the repo), Goose `summon` sub-agents.
- Prompt caching: nothing in the builder lane sets cache hints; DeepSeek caches automatically on prefix match but our prompts vary at the front.
- `critical-reviewer` and `free` opencode agents exist but `rx` never invokes them.
- OpenRouter per-key limits: only one key, so no dev/prod split.

## 4. Recommended division of labour and cost

### 4.1 Roles

| Lane | Tool / model | Does | Never does |
|---|---|---|---|
| Strategist | Claude Code Opus (subscription) | planning, architecture, task writing, reading diffs, final judgment | edits more than a few lines, long searches, running batches |
| Implementer / reviewer | Claude Code subagents `implementer` (Sonnet), `tester` (Haiku), `reviewer` (different family than the author) | scoped features across 3+ files, tests, review | exploration of the whole repo |
| Mechanical batch | OpenCode `build` agent, `openrouter/deepseek/deepseek-v4.1-flash` (fallback `pool/codestral`, `omniroute/team-coding`) via `scripts/dev/dispatch_opencode.sh` or `rx` | renames, docs, boilerplate DTOs, test scaffolds, lint fixes, <=3 files / <=80 lines | auth, billing, migrations (autonomy ladder L3/L4) |
| Interactive pair edit | Aider with the same model | small human-in-the-loop refactors with git auto-commit off | unattended runs |
| Recurring / MCP-heavy chores | Goose recipe (scheduler + summon) with DeepSeek Flash | nightly docs-drift check, tech-radar summary, `gh` triage, corpus-crawl orchestration; chosen because it has native recipes, scheduler and 70+ MCP extensions | code on sensitive paths |
| Free tier | `:free` models, OmniRoute free combos, Groq | public-repo doc typos, formatting scans, summaries of public web pages | any customer/case data, ever (`dispatch_opencode.sh` refuses `:free` without `--public`) |

### 4.2 How the hub dispatches to OpenCode headless and gets a diff

```bash
# 1. isolated worktree (never main)
git fetch origin && git worktree add --no-track -b tmp/task-123 .wt/task-123 origin/main

# 2. run the cheap model, scoped prompt, 10 min cap; prints the diff, saves log+diff under $TMPDIR/dispatch_opencode/
scripts/dev/dispatch_opencode.sh -w .wt/task-123 -t 600 \
  -m openrouter/deepseek/deepseek-v4.1-flash \
  -p "Rename X to Y in src/a.py and update the 2 call sites. Touch no other file."

# 3. hub (or reviewer subagent) reads the diff; exit code 0 = diff, 1 = no change, 3 = failed
# 4. accept: git -C .wt/task-123 add -A && git -C .wt/task-123 commit ; reject: git -C .wt/task-123 checkout -- .
# 5. cleanup: git worktree remove .wt/task-123 && git branch -D tmp/task-123
```
The raw command underneath is `opencode run --dir <wt> --agent build --model <provider/model> "<prompt>"`
(`--format json` gives machine events; `--attach http://localhost:4096` reuses a warm `opencode serve`).
Smoke test result: 12 s, 1 file, diff printed, nothing committed. For parallel batches use `rx`
(`scripts/dev/rx`), which already adds the ruff gate, repair round and PR creation.

### 4.3 Cost estimate (DeepSeek V4.1 Flash, $0.30 in / $1.20 out per 1M tokens)

- One mechanical task, about 120k input + 12k output tokens: about $0.05 (cache hits lower it).
- 20 tasks/day: about $1.0/day, about $22/month; the $4/day key cap is a 4x safety margin.
- Strategist/implementer lanes ride the Claude subscription (no per-token bill). Moving the bulk of
  edits off Opus/Sonnet to Flash is where the saving is; the Persian-legal product runtime is
  budgeted separately in `config/models.yaml`.
- Immediate need: top up OpenRouter (balance about $6.19 covers roughly 120 tasks).

### 4.4 Not locked in

Rule: every tool speaks OpenAI-compatible HTTP, and model ids live in `config/models.yaml` plus three
routing endpoints: direct OpenRouter (`openrouter/...`), OmniRoute (`omniroute/...`, local, many
free providers), LiteLLM (`pool/...`, own key rotation). Any tool (OpenCode, Aider, Goose, Crush) can use any
of the three; swapping a tool or a model is a config line. Keep `AGENTS.md` as the single instruction
file (OpenCode, Aider `--read`, Goose and Claude all read it).

### 4.5 Local models

16 GB: a 7-8B Q4 model fits but is too weak for code edits and competes with Docker for RAM. Skip
ollama for builders. Only worthwhile later for embeddings/reranking (bge-m3, bge-reranker-v2-m3),
which STATE.md already lists as a trial.

## 5. Token-management plan

Per-tool daily budgets (soft, tracked by `llm_spend.sh`):

| Lane | Budget/day | Enforcement |
|---|---|---|
| OpenCode/Aider/rx batch | $2.00 | dedicated OpenRouter key `..._DEV`, limit $2 daily |
| Goose recurring chores | $0.50 | dedicated key `..._GOOSE` or free combos only, limit $0.50 |
| CI/eval/bake-off | $1.00 | key `..._EVAL`, limit $1 |
| Production product (llm_router) | owner-set | key `..._PROD`, never used on the Mac; limit per product plan |
| Claude Code | subscription | RTK + context packing |

Steps:
1. Create 3-4 OpenRouter keys in the dashboard (owner click; needs a management view), each with a
   daily `limit` and `limit_reset: daily`. Put them in roxira.env as `OPENROUTER_API_KEY_DEV`,
   `_EVAL`, `_GOOSE`, `_PROD`. `llm_spend.sh` already reports every `OPENROUTER_API_KEY*` it finds.
   Keep `include_byok_in_limit` off.
2. Dashboard: `scripts/dev/llm_spend.sh` (today / week / month, remaining per key, account balance,
   warns under $5). OpenRouter `GET /api/v1/key` and `/api/v1/credits` work with a normal key (tested).
   Per-request detail: `GET /api/v1/generation?id=...`. OmniRoute's own analytics need its dashboard
   login (API key gets 403); use its UI at 127.0.0.1:20128 for per-provider counts.
3. Prompt caching: keep the stable prefix first (AGENTS.md rules, file contents), the variable task last;
   DeepSeek caches prefixes automatically and bills cached input at a fraction. For Claude lanes keep
   CLAUDE.md small (it is already). Do not reorder or timestamp the prompt header.
4. RTK: already active (59% saved). Keep `rtk proxy` only for unusable output. Extend to the
   OpenCode/Aider shells by prefixing noisy commands (`rtk git diff`, `rtk pytest`) in task prompts.
5. Context packing: use qmd/codebase-memory first (after fixing the lock); give workers file paths,
   not the repo; `scripts/dev/pack_agent_context.sh` only for documented cross-cutting tasks; issue
   size cap 80 lines/3 files (already in `scripts/dev/README.md`); never pack `data/`, snapshots, secrets.
6. Alarms: run `llm_spend.sh` at the start of each hub session; stop batches when remaining < 25%.

## 6. Tool evaluations (each verified by web search on 2026-10-12; star counts vary by source and are not relied on)

| Candidate | Verified | Verdict | Reason |
|---|---|---|---|
| OpenCode | yes, installed 1.18.34, headless run proven | **ADOPT** (primary batch runner) | MIT, provider-agnostic, `run`/`serve`/`--attach`, per-agent permissions in `opencode.json`. Next step: the `opencode serve` spike for warm sessions |
| Goose | yes, installed, works | **ADOPT narrowly** (recipes, scheduler, MCP chores) | now under the Linux Foundation AAIF; do not use as a second code-editing lane |
| Aider | yes, 0.86.2 works | **ADOPT as fallback** | cheapest per edit ($0.0003 here), git-native; keep for interactive use |
| Crush (Charm) | yes, terminal agent with MCP/LSP | **SKIP** | duplicates OpenCode; license wording differs between sources (FSL vs MIT), check before any use |
| OmniRoute | yes, running | **KEEP, harden** | great for free-tier pooling; but a gateway holding keys and seeing prompts is a trust boundary. Fix broken combos, bind localhost only (done), never route customer data through its web-scraped free providers |
| LiteLLM (in use) | yes | **KEEP for key rotation** | fix the container DNS (`--dns 1.1.1.1`) |
| crawl4ai | yes, Apache-2.0, Playwright-based, LLM-ready markdown | **ADOPT (server side, already planned)** | for the legal-corpus crawl; no managed anti-bot, so respect the existing "do not bypass 403" rule |
| graphify | yes, MIT, tree-sitter local graph, PyPI `graphifyy` | **TRIAL** vs codebase-memory | try it only if codebase-memory stays broken after the lock fix; non-code inputs go through your model, so no customer docs |
| browser-use | yes, MIT, LLM drives browser | **SKIP for now** | we already have Claude-in-Chrome/Playwright MCP; revisit for scripted portal navigation |
| LangGraph / deer-flow | yes (ByteDance, built on LangGraph, Docker sandboxes) | **SKIP** | heavy runtime; `rx` + Project Factory ledger already cover orchestration |
| hermes-agent (Nous) | yes, MIT, self-improving personal agent | **SKIP** | personal-assistant shape, not a code factory |
| archify | partly: an AI architecture-diagram tool trending on GitHub; I found no official repo page, other "Archify" hits are unrelated companies | **SKIP / unverified** | do not install until the repo is confirmed |
| ECC (everything-claude-code) | yes, affaan-m, MIT, agents/skills/hooks bundle | **SKIP wholesale, cherry-pick** | critics call it over-engineered; our `.claude/agents` + skills are enough. Read for ideas only |
| deepseek-harness (`dsh`) | yes, DeepSeek official, MIT, developer preview | **TRIAL (time-boxed)** | built for DeepSeek models, `npx @deepseek-ai/dsh web`; preview status means breaking changes. Needs owner approval to run npx; compare to OpenCode on 5 tasks |
| Newer tool that clearly beats these | none found | | no replacement justified; the gain is in wiring and budgets |

## 7. Honest assessment of the Roxira factory platform

What exists and works
- `rx`/`rxall`: issue to worktree to worker chain to ruff gate to PR to auto-merge; fallback chain, repair round, logs.
- Local CI (`local_ci.sh`, quarantine), autonomy ladder L0-L4 (`config/autonomy_ladder.json`), merge gate (`merge_check.py`), model registry (`config/models.yaml` + `check_models.py`), bake-off scripts, deploy tooling (owner-run), Project Factory ledger/planner (`src/factory_pipeline/*`, many modules).
- Role definitions in `.claude/agents` and opencode agents.

Partly working
- Project Factory was designed around GitHub Actions; Actions are off, so the end-to-end "brief to PRs" path depends on local manual triggering. Task caps are not wired into `rx` (STATE.md).
- Model registry is the single source in theory, but `rx` aliases (`dsflash`, `dspro`), LiteLLM and `opencode.json` each carry their own ids.

Vapour or legacy
- Root-level "autonomous" daemons and Persian-commented orchestrators (`autonomous_master_daemon.py`, `chaos_swarm_orchestrator.py`, `factory_engine.py`, `autonomous_agent_factory.py`): hardcode `/opt/roxira_platform`, predate the current model; treat as unproven unless a log shows them running.
- "Self-improving" claims (`TECH_RADAR_*`, handover files in the repo root): reports, not a closed loop.
- About 230 stale worktrees and the dead codebase-memory graph are real operational debt.

Top 5 fixes (ordered by value per effort)
1. Clear the CBM lock (3 commands, 1.1) and prune old graph DBs.
2. Top up OpenRouter, then split keys dev/eval/goose/prod with daily limits (section 5).
3. Make `rx` and `dispatch_opencode.sh` read ids from one place (`config/models.yaml` executor role via `model_registry.py`), and drop `codex` from the default chain unless it is verified working.
4. Repair OmniRoute: delete/disable the `dva` and `cfp` providers in the `auto/*` combos, add a SambaNova provider, define one healthy `team-coding-paid` combo; fix LiteLLM DNS.
5. Retire or archive the legacy root daemons into `docs/archive` or a `legacy/` dir (owner-approved, per the zero-destruction rule), and run the `opencode serve` spike so batch runs share a warm session.

## 8. Owner approval needed

- Run the lock cleanup in 1.1 (outside the repo).
- OpenRouter top-up and creation of the extra keys (dashboard clicks).
- Any new global install: `deepseek-harness` via npx (trial), `graphifyy` via pip/uv (trial), Crush (not recommended). Nothing new was installed by this audit.
- Docker DNS change for LiteLLM and OmniRoute provider cleanup (container restarts).

## 9. Files created by this audit

`docs/factory/FACTORY_AUDIT_2026-10-12.md`, `docs/factory/DEEP_RESEARCH_PROMPT.md`,
`scripts/dev/dispatch_opencode.sh`, `scripts/dev/llm_spend.sh`.
(The smoke worktree `.wt/opencode-smoke` and branch `tmp/opencode-smoke` were created and removed.)
