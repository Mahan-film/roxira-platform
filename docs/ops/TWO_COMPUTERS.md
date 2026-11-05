# Two computers: the Mac and the Windows laptop

Written 2026-11-03. Read with [COLLABORATION.md](../COLLABORATION.md) (rules for two people and their agents) and [PUBLIC_REPO_MIGRATION.md](PUBLIC_REPO_MIGRATION.md).

No secret, password or private IP address belongs in this file. The repo is public.

## The design in one paragraph

GitHub is the only shared place for code and work state: issues, claims, draft PRs, the merge queue and PR handoff blocks.

Each computer has:
- its own clone
- its own GitHub login
- its own Claude login (Anthropic terms: one account per person)
- its own SSH key for the server
- its own copy of the secrets

The Windows laptop runs Claude Code inside **WSL 2 (Ubuntu)**. The repo lives in the Linux file system there, because the repo has more than 120 bash scripts and Mac/Linux-only hooks.

The shared Wi-Fi (5 GHz LAN) is a convenience, never a dependency. Use it to:
- copy secrets once, encrypted
- optionally sync one notes folder
- keep an offline git fallback

Do not use it to share a working tree.

## What each computer does

| | Mac | Windows laptop (WSL 2) |
|---|---|---|
| Lanes (issue #61) | owner of the infra lanes | the other lanes |
| Scheduled jobs | backup pull (restic), daily team report, law watch, Iran relay, repo sync, cleanup (all launchd) | none at first; launchd scripts do not run on Windows |
| Production changes | yes (infra lane owner) | read-only until agreed in #61 |
| Secrets | `~/Secrets/roxira/` | `~/Secrets/roxira/` inside WSL, `chmod 600` |

Install each scheduled job on **one** computer only. Two copies of the team report send two messages. Two backup pulls double the disk use.

## How the two Claude sessions work together

A Claude session cannot move between computers. Its memory and transcript stay on the computer that ran it. Continuity therefore comes from files both sessions read, not from the chat.

1. **Rules:** `CLAUDE.md`, `AGENTS.md` and `docs/COLLABORATION.md` are committed, so both sessions follow the same rules.
2. **Current state:** `docs/STATE.md` and `docs/AI_HANDOFF.md`. Update them in a PR when a workstream ends.
3. **Who works on what, right now:**
   ```bash
   bash scripts/dev/whoswhat.sh
   python3 scripts/dev/team_status.py --no-ssh
   ```
   Also the daily Telegram report.
4. **Claim before work:**
   ```bash
   bash scripts/dev/claim.sh <issue> --agent <tool>
   ```
   One issue, one branch, one worktree per agent. The draft PR is the lock.
5. **Handoff:** the Handoff block in the PR template. The next session reads the PR, not a chat log.
6. **Messages between sessions:** Claude's session-to-session messaging only reaches sessions of the **same** Claude account. Two people's sessions talk through GitHub: an issue comment, a PR comment or a review.

## Wi-Fi checks (once)

1. **Same network, no client isolation.** Some routers put Wi-Fi clients in "AP isolation", which blocks one laptop from reaching the other. Test from WSL:
   ```bash
   ping <mac-name>.local
   ```
   Or ping the Mac's LAN address. If it fails, turn off AP/client isolation in the router.
2. **Fixed addresses.** Give both computers a DHCP reservation in the router, so their LAN addresses do not change.
3. **WSL 2 networking.** Put this in `%UserProfile%\.wslconfig` (Windows 11 22H2 or later) so WSL shares the laptop's LAN address and other machines can reach it:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
   Then run `wsl --shutdown` and reopen.
4. **Firewall.** Open only what you use: SSH (22) between the two machines, and Syncthing (22000/tcp+udp, 21027/udp) if you use it. Allow it on the private network profile only.

## Windows laptop setup (step by step)

Each step lists its rollback.

1. **WSL 2.** In an admin PowerShell, run `wsl --install -d Ubuntu`, reboot, then create the Linux user.
   Rollback: `wsl --unregister Ubuntu`.
2. **Tools.** In WSL:
   ```bash
   sudo apt update && sudo apt install -y git curl jq ripgrep age openssh-client python3 python3-venv python3-pip
   ```
   Then install `gh` from GitHub's apt repository. Install Node.js (LTS) with `nvm` if the frontend will be built there.
3. **Identity.** Log in with the second person's own accounts:
   ```bash
   gh auth login
   git config --global user.name "<name>"
   git config --global user.email "<github noreply email>"
   ```
   Commits must not say "Test User".
4. **SSH key.** Create the key:
   ```bash
   ssh-keygen -t ed25519 -C "<name>@windows-wsl"
   ```
   - Add the public key to the person's GitHub account.
   - Send the **public** key to the infra owner, who adds it on srv1 for a read-only user that is **not in the docker group**. Docker access equals root.
   - Copy `scripts/ops/ssh_config.example` into `~/.ssh/config`.
   Rollback: delete the key line on srv1 and on GitHub.
5. **Claude Code.** Install the native build inside WSL (`curl -fsSL https://claude.ai/install.sh | bash`), then run `claude doctor` and log in with the person's own account. The Windows desktop app can open a WSL session. In that mode the file pane is view-only and plugins are not available.
6. **Clone.** Clone into the Linux file system, never under `/mnt/c`:
   ```bash
   mkdir -p ~/Developer && cd ~/Developer
   git clone git@github.com:Mahan-film/roxira-platform.git
   cd roxira-platform
   bash scripts/dev/install_hooks.sh
   ```
   The hook installs the pre-push guard that refuses the old, pre-2026-11-03 history.
7. **Secrets.** Follow "Moving secrets" below. Then check the keys without printing their values:
   ```bash
   python3 scripts/check_keys.py
   ```
8. **First task.** Run `bash scripts/dev/whoswhat.sh`, pick an issue in your lane (#61), then run `claim.sh <n> --agent claude`.

## Moving secrets (once, encrypted)

Never send secrets in chat, email, a git repo, a public paste or the Syncthing notes folder.

1. On Windows/WSL:
   ```bash
   age-keygen -o ~/.config/age/key.txt
   chmod 600 ~/.config/age/key.txt
   ```
   Send only the printed **public** key (`age1...`) to the Mac.
2. On the Mac:
   ```bash
   age -r age1... -o roxira.env.age ~/Secrets/roxira/roxira.env
   ```
3. Copy `roxira.env.age` over the LAN (`scp`) or by USB.
4. On WSL:
   ```bash
   mkdir -p ~/Secrets/roxira
   age -d -i ~/.config/age/key.txt -o ~/Secrets/roxira/roxira.env roxira.env.age
   chmod 600 ~/Secrets/roxira/roxira.env
   rm roxira.env.age
   ```
5. Better: each person creates their own AI-provider keys, so either can be revoked alone. Share only the service keys the product needs (SMS, payment, OAuth). A shared password-manager vault (Bitwarden or 1Password) is the long-term home for these.

Do not copy `restic-dr.pass` to the laptop. The restic backup lives only on the Mac.

## Optional LAN helpers

- **Notes folder (Syncthing):** sync one folder, `~/Notes/roxira-handoff`, outside every repo, for notes that should not go into a public repo.
  - Add `.stignore` entries for `*.env`, `*.key`, `*.pass` and `.git`.
  - Never sync a repo, a worktree or `.git`. Two live copies of a git directory corrupt each other.
- **Offline git fallback:** if GitHub is unreachable for a while, one machine can host a bare repo over LAN SSH:
  ```bash
  git init --bare ~/lan-remote/roxira.git
  git remote add lan <user>@<mac-name>.local:lan-remote/roxira.git
  ```
  Push branches there to hand work over. Push them to GitHub when it is back. The pre-push guard runs here too.
- **Not recommended:** an SMB/network share holding a repo. Locking, line endings and file watching break, and it exposes one disk to the other.

## Sharing the Mac's LLM key pool with the laptop

Owner decision 2026-11-05: the laptop's OpenCode agents use the Mac's pool, but the real provider keys never leave the Mac.

- **Proxy.** `scripts/infra/pool_share/` runs LiteLLM (docker, image already on the Mac) plus a private Postgres container (virtual keys need a database) as the launchd agent `ir.roxira.pool-share` (`KeepAlive`, restarts on failure). The config is rendered from `config/key_pool.yaml` at every start, so it has the same role chains as the server pool (`agent-light-free`, `agent-free`, `agent-free-paid`, `best-all`) and writes the cost log to `~/Library/Logs/roxira-pool-share/requests.jsonl`.
- **Network.** It listens on one LAN address only (`en0`, port 4180; never `0.0.0.0`). The container itself is published on `127.0.0.1:4181`, because Docker Desktop cannot publish on the LAN address reliably; `lan_forward.py` is a small TCP forwarder from the LAN address to it. Port 4180/4181 are free in AGENTS.md section 7. The macOS firewall is off on the Mac; if it is turned on, allow only `python3` / port 4180.
- **Install on the Mac:** `bash scripts/infra/pool_share/install.sh` (`--uninstall` removes the agent). The master key and DB password are generated into `~/Secrets/roxira/` (mode 600) and are never printed.
- **Laptop key.** `bash scripts/dev/pool_key_rotate.sh` creates the virtual key `laptop-mahansudo` (2 USD per day on paid models, 60 requests/min, LLM routes and the five agent roles only) and writes it to `~/Secrets/roxira/laptop-pool.key`. Running it again revokes the old key first. `--revoke-only` cuts the laptop off. Free calls cost 0; when the daily budget is used up the whole key pauses until the next day.
- **Laptop side.** The owner moves `laptop-pool.key` once (AirDrop or USB) into `~/Secrets/roxira/pool.env` as `ROXIRA_POOL_KEY=...`, then points OpenCode at `http://<mac-lan-address>:4180/v1` as an OpenAI-compatible provider. The address is private, so it lives in the owner's handover note, not in this repo.
- **Public data only.** The free tiers may log prompts. Never send customer data through this proxy.
- **Away from the LAN.** Install Tailscale (free) on both machines, then start the agent with `POOL_SHARE_BIND=<mac tailscale address>`. Do not install it without the owner.
- **Known limits.** ExpressVPN on the Mac must allow local network traffic (`allowLANTraffic`). From the Mac itself a connection to its own LAN address is reset by the VPN, so Mac-side admin calls use `127.0.0.1:4181`. Groq is blocked from Iran, Mistral keys were out of budget on 2026-11-05, so free traffic mostly lands on Gemini, SambaNova and OpenRouter `:free`, then paid.

## Line endings

`.gitattributes` (PR #71) keeps every checkout LF and leaves test fixtures byte-exact. Several fixtures are CRLF or Windows-1256 on purpose. Do not set `core.autocrlf=true`.

## Risks and rollback

| Risk | Guard | Rollback |
|---|---|---|
| Old-history branch pushed from a stale copy | pre-push guard + GitHub ruleset | rebase onto `origin/main` |
| Secret committed from either machine | GitHub push protection, gitleaks in CI | rotate the key, then remove it from the branch |
| Two agents edit the same file | `claim.sh`, draft PR as lock, overlap list in `team_status.py`, merge queue | close one PR, rebase the other |
| Job installed on both machines | one-machine rule above | uninstall on one machine (`install_*.sh --uninstall`) |
| Router blocks laptop-to-laptop | nothing depends on the LAN | use GitHub only |
| Windows laptop lost | per-person SSH key, age key and accounts | revoke that key on srv1 and GitHub, rotate shared service keys |
