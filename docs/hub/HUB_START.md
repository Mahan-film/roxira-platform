# Hub restart guide (new Claude account, new Mac user or new machine)

Use this when the owner switches Claude account, macOS user or computer. Everything the hub
needs is in git or in the owner's own secrets folder. Nothing depends on one Claude account.

## 1. What lives where

| Thing | Where | Account-bound? |
|-------|-------|----------------|
| Shared map: machines, accounts, stack, flows, plan | `docs/hub/SYSTEM_OVERVIEW.md` (read this first) | no (git) |
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

## 2a. Switching the Mac's Claude account (planned 2026-11-21)

The Mac's Claude login moves to the colleague, now the main owner. The current account moves to
the Linux laptop. Same macOS user, so `~/.claude/` (memory, settings, local MCPs such as engram,
codebase-memory and qmd), `~/Secrets/roxira/`, `~/.ssh/config`, the gh logins and the
`ir.roxira.*` launchd jobs all stay.

What does **not** carry over, because it belongs to the claude.ai account:
- desktop app session history and the sidebar (this hub's old chats);
- claude.ai artifacts, cloud routines and connectors. Checked on 2026-11-21: no artifacts, no
  scheduled tasks and no cron jobs exist, so nothing is lost;
- plan, models and usage limits. Check them on the new account with `/status`.

Before logging out (old account):
1. All hub work is merged on `main`, and the handover PR shows **MERGED**.
2. `python3 scripts/dev/hub_memory.py export` has run, and its diff is committed.

Switch:
1. In the Claude desktop app, sign out (account menu), then sign in with the colleague's account.
2. In any terminal Claude Code, run `/logout`, then `/login`.
3. Open `~/Developer/roxira-platform` and paste the first prompt from §4.

On the Linux laptop (user `mahanfilms`), **after** the Mac switch and after the handover PR is merged:
1. Let the box hub finish its current item and post its `BOX:` report on #592.
2. Pause the bridge: `touch ~/.config/roxira-bridge/STOP`.
3. Run `claude`, then `/logout` and `/login` with the account that leaves the Mac.
4. Resume the bridge: `rm ~/.config/roxira-bridge/STOP`.
5. Check it: `systemctl --user start roxira-bridge.service && journalctl --user -u roxira-bridge -n 20`.
   The bridge (`claude -p`) uses the new login from then on.

GitHub does not change. If anyone logs gh into a third account, add its numeric id
(`gh api users/<login> --jq .id`) to `~/.config/roxira-bridge/bridge.toml` on the laptop.

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

A new macOS user also loses the per-user launchd jobs `ir.roxira.*` (`~/Library/LaunchAgents`:
backup-pull, reposync, lawwatch, diskguard, mac-cleanup, iranrelay, team-status, llm-tunnel, fleet).
Copy the plists from the old user, fix the paths, and run `launchctl bootstrap gui/$(id -u) <plist>` for each.

## 4. First prompt for the new hub

```text
You are the Roxira main hub on this Mac: chief architect, planner and general manager of the
project. Read docs/hub/HUB_START.md, docs/hub/MAIN_HUB_MASTER_BRIEF.md, docs/STATE.md and
docs/hub/memory/MEMORY.md (open single notes only when needed). Do not trust the docs for live
state: rebuild it from GitHub (gh pr list -R Mahan-film/roxira-platform -L 60; the latest WAVE
and BOX: comments on #592; the latest WAVE:/REPORT:/ASK-HUB: comments on #965). Then tell me
which model you are running as (I run /status myself for the limits). Reply to me in Persian. Continue the work
in the order of MAIN_HUB_MASTER_BRIEF.md section 7, delegating bulk work to the laptop (#965),
the Antigravity lanes and cheap subagents.
```

## 5. Keeping the copy fresh

At the end of a session (or in `/handoff`), the hub runs:

```bash
python3 scripts/dev/hub_memory.py export && git diff --stat docs/hub/memory
```

and commits the result in a small docs PR. The export refuses files with key patterns and
replaces server/LAN IPs and phone numbers. The repo is public, so read the diff before pushing.
