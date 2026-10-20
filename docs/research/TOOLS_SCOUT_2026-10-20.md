# Tools scout - 2026-10-20

Method: web search + GitHub README fetches only. Nothing installed, no repo code run. GitHub pages did not expose last-commit dates to the fetcher, so "last commit" is UNVERIFIED for all repos (check with `gh api repos/<o>/<r> --jq .pushed_at` before any trial). Star counts are as seen on the page today.

## Summary table

| # | Tool | Real repo | Stars | License | Verdict |
|---|------|-----------|-------|---------|---------|
| 1 | Hermes Agent (platform) | NousResearch/hermes-agent | ~255k | MIT | SKIP (overlaps our server agents; not needed) |
| 1a | gbrain | garrytan/gbrain | ~31k | MIT | SKIP (overlaps codebase-memory + engram/qmd); maybe revisit |
| 1b | skills-hub | agentskills.io (Hermes Skills Hub, community registry) - not a single repo | n/a | per skill | SKIP (supply-chain risk); read skills as markdown only |
| 1c | agent-reach | Panniantong/Agent-Reach | ~100k | MIT | TRIAL ON SERVER (narrow) or SKIP |
| 1d | open-design | nexu-io/open-design | ~103k | Apache-2.0 | TRIAL ON SERVER (Docker, low priority) |
| 1e | hermes-studio | EKKOLearnAI/hermes-studio (now "ekko-studio", ex hermes-web-ui); also unrelated JPeetz/Hermes-Studio (72 stars) | ~11.5k | BSL-1.1 | SKIP (needs Hermes; BSL; default admin/123456) |
| 2 | Understand Anything | Egonex-AI/Understand-Anything (earlier Lum1104/...) | ~87k | MIT | TRIAL (local, one-off, small scope) |
| 3 | Harness^2 | google-research/harness2 (arXiv 2610.14224) | ~14.6k | Apache-2.0 | SKIP now; borrow the idea for roxira-selfimprove |
| 4 | Ghost Downloader 3 | XiaoYouChR/Ghost-Downloader-3 | ~10.1k | GPL-3.0 | SKIP (no legitimate need; risk flagged) |

Caveat on star counts: they are very high and some third-party sources disagree wildly (e.g. Understand Anything 2k vs 87k depending on capture date). Several are likely inflated by hype/automation; stars are not evidence of quality. The "5 free tools" bundle from deployaibots is a curated social-media list; the five items are unrelated projects from different authors, only loosely tied to Hermes.

## 1. Hermes ecosystem

**What Hermes is (verified):** Hermes Agent by Nous Research (github.com/NousResearch/hermes-agent), MIT, released Feb 2026. A self-hosted persistent agent: memory, auto-created skills from experience, cron-style automations, subagents, messaging gateways (Telegram/Slack/WhatsApp...), many LLM providers, Docker/SSH backends. Install is `curl | bash`. Docs mention command approval and container isolation. Releases section empty in the capture; recency unverified.

Overlap: this is basically what our server agents (OpenCode + DeepSeek/Groq, taskq) plus Claude Code hub already do. Adopting it means a second agent runtime to secure and operate, with a `curl | bash` installer and a messaging gateway (new inbound attack surface). No clear gain.

**gbrain** (garrytan/gbrain, MIT, ~31k, Garry Tan/YC): markdown notes in git indexed into Postgres/PGLite with keyword + semantic search and a typed graph; CLI + MCP; Bun 1.4+. Install ONLY from GitHub (the npm `gbrain` is an unrelated package - a typosquat trap). Semantic features need Voyage/OpenAI/Ollama keys; cloud providers see your text. Optional "Memorable" relay is off by default. Overlap: codebase-memory MCP (code graph), engram (memory), qmd (docs search). It targets personal/people/company notes, not code or Persian legal data. Verdict SKIP. If we ever want a personal CRM-style memory, trial with `--pglite --no-embedding` in a scratch dir.

**skills-hub** (agentskills.io / Hermes Skills Hub): a registry aggregating community skills (claims of 600 to 90,000+ skills depending on source). Has trust tiers and a scanner, but sources conflict on whether official skills are scanned. The adjacent ClawHub registry had hundreds of confirmed malicious skills (Koi Security: 341 of 2,857, later 824). Skills are markdown that instruct an agent with shell access = prompt-injection / supply-chain vector. Verdict SKIP. If a specific skill looks useful, read the SKILL.md and re-write it by hand into `.claude/skills`.

**agent-reach** (Panniantong/Agent-Reach, MIT, ~100k): a CLI routing layer that bundles yt-dlp/feedparser and wires up Jina Reader, Exa via mcporter, gh, and cookie-auth CLIs for Twitter/Reddit/Xiaohongshu/Bilibili. Default `install` only checks env; `--system` changes things; `--dry-run` available. Credentials in `~/.agent-reach/config.yaml` (0600). Beware: cookie-based social access risks account bans; README warns of crypto scams using the name and of a same-named PyPI package that is NOT this project. Overlap: we already have SearXNG (8888), a marketing engine, and WebFetch. Value for us: low (Persian legal research uses ekhtebar/nezamat/qavanin, not social platforms). Verdict TRIAL ON SERVER only if marketing wants social-listening; else SKIP.

**open-design** (nexu-io/open-design, Apache-2.0, ~103k): open-source Claude Design alternative; local Express+SQLite daemon (127.0.0.1:7456), driven by a coding-agent CLI or BYOK, 100+ skills and ~150 design systems, exports slides/prototypes/video. Docker compose available. Telemetry: product analytics consent-gated, but "scrubbed safety and reliability telemetry is always on" - flag. Overlap: we have the impeccable/design skills and a Next.js+shadcn standard. Possible use: landing pages / slide decks for marketing. Verdict TRIAL ON SERVER, low priority.

**hermes-studio** (EKKOLearnAI/hermes-studio, renamed ekko-studio, BSL-1.1, ~11.5k): web/desktop console for Hermes Agent and 14 coding agents. Not an official Nous product (page states no affiliation). BSL = not open source. Default bootstrap login admin/123456. Useless without Hermes. SKIP. Name collision: JPeetz/Hermes-Studio is a different, tiny project.

## 2. Understand Anything

Repo: github.com/Egonex-AI/Understand-Anything (MIT, ~87k stars, 7.4k forks, 858 commits). Provenance is muddy: third-party guides cite Lum1104/ and Lumina-Labs/ paths; LICENSE names Yuxiang Lin / "Infinite Universe, Inc." Use only the path the repo README gives, and confirm the plugin marketplace owner before installing.

Does: Tree-sitter deterministic parsing + LLM multi-agent pipeline (scanner, file/architecture analyzers, tour builder) -> interactive dashboard graph, plus /understand-chat, -explain, -onboard, -diff. First run is token-heavy (one review: ~200k tokens / ~30 min on a demo repo); later runs incremental; can use local model. Installer clones to `~/.understand-anything/repo`. Viewer claims no LLM calls; no telemetry statement found.

Overlap: codebase-memory MCP already gives us a structural graph with search_graph/trace_path for agents. Understand Anything's added value is the human-facing visual dashboard, tours and onboarding - useful for the solo founder to grasp unfamiliar parts or onboard the second person. It does not improve agent answers beyond what we have, and burns tokens.

Verdict: TRIAL (local, optional, not on prod server). Plan: in a throwaway clone at `~/trials/ua/` of a single subtree (e.g. `output_apps/generated_modules/smartjudge/`), using a cheap/free model or Ollama; `/plugin install` from the Egonex-AI marketplace only after reading plugin hooks/commands for network calls. Measure: tokens spent, wall time, whether the layer/tour view surfaces 3 architectural facts we did not know, vs. 10 min with codebase-memory `get_architecture`. Do not enable globally; remove plugin after.

## 3. Harness^2 (Google)

Verified real: github.com/google-research/harness2 (Apache-2.0, ~14.6k stars, only 3 commits in the page, v0.1.0, arXiv 2610.14224). README states "not an officially supported Google product". It is a research code drop, not a maintained tool.

Does: keeps model weights fixed and improves the harness (prompts, tools, memory, skills) via task-level Propose-Probe-Compose recursion (no ground-truth feedback) and a persistent "improvement harness" across tasks. OpenCode and Codex executors; benchmarks JobBench, LAB, WorkBuddy-Bench. Reported gains: +4.5 to +11.8 points on benchmarks (authors' claims, different configs, editor model Claude Opus 4.8; not independently verified; no evidence of production-cost or review-effort gains).

Risks: requires Vertex AI / gcloud ADC, Linux, Python 3.12, Node 20+, Docker for one bench. Executor network access is unrestricted and Codex runs with sandbox disabled (a run fetched a public benchmark rubric unprompted). Cost multiplies (4k executions per task at k parallel rounds) plus editor/judge calls. None of the benchmarks match Persian legal tasks. Our rule "free models first" conflicts with its Opus-editor setup.

Overlap: our `roxira-selfimprove-*` timers are the same idea in lightweight form. Verdict: SKIP adoption. Cheap win: read the paper and README for the Propose-Probe-Compose structure and gating (adopt change only if a held-out probe improves) and port the concept into the selfimprove loop with a regression set from smartjudge evals. If someone insists on running it: docker with no credentials, egress-deny firewall, budget cap, `/opt/trials/harness2`, run `harness2-demo` only (needs no model credentials).

## 4. Ghost Downloader 3

Repo exists: XiaoYouChR/Ghost-Downloader-3, GPL-3.0, ~10.1k stars, 1,528 commits, owner XiaoYouChR (single maintainer). PySide6/Qt desktop download manager: HTTP, BT/magnet, ed2k, FTP, M3U8/DASH, yt-dlp-based YouTube/Bilibili, GitHub/HuggingFace mirror acceleration, browser extension, aria2-compatible RPC, `ghd` CLI. Bundles FFmpeg, libtorrent, N_m3u8DL-RE, "cat-catch" and wreq.

Flag: README advertises "real-browser TLS fingerprints, invisible to anti-bot checks" (wreq TLS-fingerprint emulation). That is anti-bot evasion, which our policy treats as prohibited (no bypassing bot detection), and it also carries ToS/legal exposure for scraping. A browser extension plus RPC port plus binary releases (Nuitka-compiled) is a large, hard-to-audit footprint, single maintainer, GPL (copyleft if ever embedded). No telemetry statement found (unverified).

Legitimate need for us: none. Large legal datasets come from ekhtebar/nezamat/qavanin via our own scrapers with rate limits; model weights via `huggingface-cli`/`curl`. Verdict: SKIP. Do not install on the Mac or the servers.

## Cross-cutting rules if anything gets trialed

- Server only, `/opt/trials/<tool>` as a non-root user or Docker with no host mounts, no prod env files, no keys from `roxira.env`; a dedicated throwaway OpenRouter/Groq key with a spend cap.
- Egress allowlist, bind to 127.0.0.1 only, never to reserved ports (check `ss -tulnp | grep <PORT>` first; open-design 7456 and ekko 8648/6060/8642 are not reserved but verify).
- Read installer scripts before running; never `curl | bash` blind. Pin to a commit SHA.
- Time-box 2 days, success metric written beforehand, delete the trial dir selectively afterwards (no bulk rm).

## Unverified items

Last-commit dates for all repos; whether the "5 free tools" video's exact names map to the repos above (inferred); any telemetry beyond what READMEs state; real star-count integrity; Harness^2 benchmark gains; whether hermes-studio is endorsed by Nous.
