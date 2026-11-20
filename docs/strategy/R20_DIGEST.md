# R20 digest: two machines, many agents, private repo (2026-11-20)

Raw report: `docs/strategy/research/R20_TWO_MACHINE_RAW.md` (Stage 1 blueprint + Stage 2 review).
Follow-up research: R21 (`docs/research/R21_AGENT_BRIDGE.md`, issue #965).
Spend and account decisions stay with the owner; rows below say where one is needed.

## Hub verdict

The report confirms the core design (GitHub as queue and audit trail, cross-family review desk,
pull deploy, no production keys on the box, proxy egress lock). It changes three things:

1. **One deterministic dispatcher instead of two LLM hubs relaying through the owner.** A small
   service on the always-on box (`roxira-orch`) polls GitHub, claims work, enforces WIP and
   file locks, starts headless CLIs (`claude -p`, `gemini -p` with an API key, `opencode run`)
   and posts results. LLM tokens are spent on coding, not on polling.
   Step 1 is the R21 fallback timer (poll #965, run `WAVE:` comments, post `REPORT:`).
2. **Antigravity stays interactive only.** Unattended lanes move to headless CLIs. Automating a
   consumer Google login is a ban risk (report claim, unverified); unattended Google lanes use
   an API key. Claude subscription use for unattended jobs stays low-volume and must be
   switchable to an API key in one env var.
3. **Private repo on GitHub Free is possible at $0**, but merge queue, auto-merge, branch
   protection, rulesets, environments, secret scanning, push protection and CodeQL disappear.
   Replacements must be live before the flip (rows #947/#949/#951 plus R20-1..R20-4).

## Decisions

| # | Area | Decision | Owner input |
|---|------|----------|-------------|
| D1 | Forge | Stay on GitHub Free, go private after the replacements land. Nightly `git clone --mirror` to the box HDD + weekly issues/PR JSON export. Forgejo/GitLab/Codeberg rejected for now. | none ($0) |
| D2 | CI runner | Ephemeral JIT runners (two slots: no-docker and compose). Fallback selector on `ubuntu-slim` must check `busy==false` and pin actions to SHAs. | none |
| D3 | Mac and box link | Test NetBird Cloud Free reachability from the box first; fallback reverse SSH through the existing proxy exit. Tailscale/ZeroTier free tiers are non-commercial, so they're not used. | create NetBird account |
| D4 | Orchestration | `roxira-orch` on the box (SQLite WAL queue; scopes in a join table, not `LIKE`; leases; provider cooldowns; cost log). GitHub stays the backlog. A2A, BullMQ, OpenHands, Mergify are not adopted. | $5 Google AI Studio prepay (optional) |
| D5 | Agent security | Builder users get a domain-allowlist egress proxy in front of xray; no tokens in builder shells (a publisher pushes); `--ignore-scripts` installs; new dependencies need human review; PreToolUse/PostToolUse redaction hooks. | none |
| D6 | Box reliability | Battery cap, lid ignore, security-only unattended upgrades, guarded weekly reboot, restic backups to HDD (+ R2 later), Sunday restore drill, Telegram alerts. The phone stack moves off the laptop before real customer calls. | R2 account; small VPS for phone later |

## Bugs found in the report's own snippets (do not copy them as-is)

- SQLite claim query: `LIKE prefix || '%'` treats `_`/`%` as wildcards and allows one prefix only.
- Signed deploy tag guard: "newest tag must verify" lets anyone push a higher unsigned tag and stop
  all deploys. Pick the newest tag that *passes* verification.
- `Edit` + `Bash(pytest *)` in `allowedTools` is not a sandbox: an agent can edit a test and run code.
- `actions/checkout@v4` style tags must be pinned to commit SHAs.

## Conflicts with what we have seen

- "Gemini CLI consumer access ended 2026-06-18": the box signed in to Gemini CLI with Google on
  2026-11-19, so this claim is UNVERIFIED and we don't act on it.
- The report suggests 30 days with no auto-merge. The hub keeps today's rule: review desk APPROVE
  plus green CI merges low-risk PRs; migrations, workflows and prod scripts need the owner.

## Rows (GitHub issues, label `research-row`)

| Row | Lane | Work |
|-----|------|------|
| R20-1 | L1 | gitleaks CLI binary (not gitleaks-action) + OSV-Scanner + Semgrep CE in pre-push and CI |
| R20-2 | L1 | Polling merge gate on the box to replace merge queue/auto-merge after the flip |
| R20-3 | L7 | Nightly bare mirror + weekly GitHub issues/PR export to the box HDD |
| R20-4 | L1 | Production pull with a read-only deploy key; signed-tag guard for migrations (corrected loop) |
| R20-5 | L7 | `roxira-orch` v0: the R21 GitHub-polling timer, then SQLite claims/locks/leases |
| R20-6 | L7 | Builder egress allowlist proxy + no-token builders + redaction hooks |
| R20-7 | L7 | Box reliability pack (battery, lid, upgrades, restic, restore drill, alerts) |
| R20-8 | L1 | Ephemeral JIT runner pool + offline fallback selector |
