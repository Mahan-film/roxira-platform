# Hub restart guide (new Claude account, new Mac user or new machine)

Use this when the owner switches Claude account, macOS user or computer. Everything the hub
needs is in git or in the owner's own secrets folder. Nothing depends on one Claude account.

## 1. What lives where

| Thing | Where | Account-bound? |
|-------|-------|----------------|
| Rules for every agent | `CLAUDE.md`, `AGENTS.md`, `docs/agents/LESSONS.md` | no (git) |
| Current state and plan | `docs/README.md` (index), `docs/STATE.md`, `docs/STRATEGY_NOW.md`, `docs/FACTORY.md`, `docs/ARCHITECTURE.md` | no (git) |
| Hub memory (decisions, owner feedback, traps) | `docs/hub/memory/*.md` (scrubbed copy) | no (git) |
| Box hub rules + full brief (Linux laptop) | `docs/hub/BOX_HUB_CLAUDE.md`, `docs/hub/BOX_HUB_MASTER_BRIEF.md` | no (git) |
| Work queue | GitHub issues with `lane:Lx` labels; WAVE comments on #592; agent bridge #965 | no (GitHub) |
| Research | `docs/strategy/research/*_RAW.md` + digests (`R18`, `R20`, ...) | no (git) |
| Secrets | `~/Secrets/roxira/roxira.env` on the owner's Mac (never in git) | macOS user |
| Production SSH | `~/.ssh/config` alias `roxira-prod` (install: `scripts/ops/install_ssh_alias.sh`) | macOS user |
| GitHub CLI login | `gh auth status` (accounts `mahan-films` and `mahansudo`) | macOS user |

## 2. New Claude account, same Mac user

Nothing to move: Claude Code keeps `~/.claude/` (memory, settings) when you log in with another
account. Log in, open the repo, and say: "Read docs/hub/HUB_START.md and continue."

## 3. New Mac user or new Mac

```bash
git clone https://github.com/Mahan-film/roxira-platform.git ~/Developer/roxira-platform
cd ~/Developer/roxira-platform && python3 scripts/dev/hub_memory.py restore
gh auth login            # mahan-films (owner) first, then mahansudo if needed
bash scripts/ops/install_ssh_alias.sh
```

Then copy `~/Secrets/roxira/` from the old user or machine by hand (USB or password manager), with
mode 700/600. Never send it through chat, email or git. In git, memory notes show IPs and phone
numbers as `<ip>` and `<phone>`. The real values are in the SSH config and the secrets folder.

## 4. First prompt for the new hub

```text
You are the Roxira main hub. Read docs/hub/HUB_START.md, then docs/README.md, docs/STATE.md,
docs/STRATEGY_NOW.md and docs/hub/memory/MEMORY.md (open single notes only when needed).
Reply to the owner in Persian. Check open PRs (gh pr list -R Mahan-film/roxira-platform),
the latest WAVE on #592 and the latest comments on #965, then continue the work.
```

## 5. Keeping the copy fresh

At the end of a session (or in `/handoff`), the hub runs:

```bash
python3 scripts/dev/hub_memory.py export && git diff --stat docs/hub/memory
```

and commits the result in a small docs PR. The export refuses files with key patterns and
replaces server/LAN IPs and phone numbers. The repo is public, so read the diff before pushing.
