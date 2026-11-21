# Box lane runner (T275, issue #1078)

The Linux box runs lanes L5-L7 with **no Claude, Antigravity or other consumer login**. The worker is OpenCode, the
model comes from the free-first LiteLLM key pool on the production server (`docs/infra/KEY_POOL.md`), reached through a
loopback ssh tunnel on local port 4181 with a restricted per-machine virtual key. Free providers first; the paid
DeepSeek fallback only through that key's daily cap. Everything is in `scripts/ops/ci_box/lane_runner/`.

Public code and docs only. The free groups may log prompts, so private or customer data never goes through this
runner: `lane-run` refuses a task without `--public`, refuses `private`/`customer`/`confidential` labels, and the
virtual key cannot reach the `private` or product groups anyway.

## What is in the pack

| File | Purpose |
|---|---|
| `roxira-gateway-tunnel.service` | systemd **user** unit: `ssh -N -L 127.0.0.1:4181:127.0.0.1:4000`, loopback bind, through the box proxy (`nc -X connect -x 127.0.0.1:10809`), `Restart=always`, no secrets |
| `roxira-lane-taskq.service` / `.timer` | one `taskq.py run --once` pass, gateway ladder only, `OnCalendar=*:07,37` (never `:00`). Installed but **not enabled** |
| `lane-run` | provider-agnostic wrapper around `run_task.sh --gateway --public` (guards, caps, log line) |
| `lane-run.conf.example` | the single config file: gateway URL, tier, model group, bot guard |
| `lane_budgets.box.json` | per-lane daily caps for `lane_budget.py` (lanes `l5`, `l6`, `l7`, `smoke`) |
| `taskq-runner.sh` | `TASKQ_RUNNER` for the box; hands taskq steps to `lane-run` |
| `install_user.sh` | part 1, no sudo, dry-run by default |
| `install_root.sh` | part 2, root, one wrapper and one sudoers line, dry-run by default |
| `gateway.env.example`, `tunnel.env.example` | empty templates for the two files outside the repo |
| `test_lane_run.sh` | offline test (no network, no sudo) |

Model ids are not written anywhere in the pack. `TIER` (`light`, `strong`, `best`) picks the gateway group
(`agent-light-free`, `agent-strong-free`, `best-all`); the ids behind a group live in `config/key_pool.yaml` and
`config/models.yaml`. `MODEL_GROUP` in the config must match the tier and must be an `agent-*` / `best-*` group.

## What `lane-run` does

```
lane-run --lane L5 --public --task-file t.md [--scope docs/] [--tier light|strong|best]
         [--issue-file i.txt] [--comment-file c.txt] [--author LOGIN] [--labels a,b] [--dry-run]
lane-run --smoke          # = run_task.sh --smoke --gateway --public, nothing pushed
lane-run --budget --lane L5
```

- Refuses (exit 3) without `--public`, with a private/customer label, with a non-loopback `GATEWAY_URL`, or with a
  non-agent model group. Over the daily cap: exit 4.
- Caps: `lane_budget.py` with `lane_budgets.box.json` (attempts per day and paid USD per day, UTC day). Counted from
  the box's own log. Tokens are not metered (see "Not verified"), so only attempts and USD bind.
- Stagger: it never starts in the `:00` minute (it waits a lane-specific 90-330 s instead); the timer fires at `:07,:37`
  with up to 120 s random delay.
- Bot-loop guard: `--author` ending in `[bot]`/`-bot`, in `BOT_LOGINS`, or `--labels` containing `OWN_LABEL`
  (`lane-runner`): logged as `skipped_bot`, exit 0, no model call. Have your comment-posting code add that label to
  everything the runner writes.
- Untrusted text: `--issue-file` / `--comment-file` are appended inside `<untrusted-data source="...">` with a rule that
  it is data, not instructions; a literal `untrusted-data` inside the text is neutralised so it cannot close the block.
  `run_task.sh` additionally denies secrets/data paths and limits edits to `--scope`.
- Log: one JSON line per run in `~/.local/state/roxira-lane/logs/lane-run.jsonl`:
  `ts, lane, model_group, model_alias, tokens, cost_usd, exit, status, git_sha, duration_s`. No prompts, no keys.
- The key is read from `gateway.env` (must be mode 600) and passed to `run_task.sh` only as the environment variable
  `KEYPOOL_MASTER_KEY`. It is never printed or logged.

## Owner steps (in this order)

Names below in angle brackets are placeholders. Do not paste any key, host or user value into chat, issues or PRs.

1. **Read first, change nothing.** On the box as the lane user:
   `bash scripts/ops/ci_box/lane_runner/install_user.sh` (dry-run, prints the plan and warnings). On the box as admin:
   `sudo bash scripts/ops/ci_box/lane_runner/install_root.sh --lane-user <lane user>` (dry-run).
2. **Server side, one restricted key.** The box must NOT get a production login (`docs/hub/BOX_HUB_MASTER_BRIEF.md`
   section 1). The tunnel therefore uses a separate key that can only forward to the gateway port. After step 4 gives you
   the public key, add this one line to the `authorized_keys` of a **dedicated tunnel-only account** on the server (not a
   deploy/admin account), keeping the key text between `ssh-ed25519` and the comment:
   `restrict,port-forwarding,permitopen="127.0.0.1:4000",command="/bin/false" ssh-ed25519 <public key> roxira-box-gateway-tunnel`
   (`restrict` turns off shell, pty, agent and X11; `permitopen` limits forwarding to the gateway). Creating that account
   is a production change: do it yourself or approve it; this pack does not touch production.
3. **Admin installs the prerequisites** (only what the dry-run warned about): `netcat-openbsd` (needs `nc -X`), the box
   proxy ON (`sudo box-proxy on`, it listens on `127.0.0.1:10809`), and then, as the lane user, OpenCode into the user
   prefix (for example `NODE_USE_ENV_PROXY=1 npm install -g --prefix ~/.local opencode-ai`, with `~/.local/bin` on PATH).
4. **Install, part 1 (lane user, no sudo):** `bash install_user.sh --apply`. It creates `~/.config/roxira-lane/`
   (mode 700) with the config and two EMPTY mode-600 files, makes the state dir `~/.local/state/roxira-lane`
   (taskq db, worktrees, logs), makes a bare clone of the public repo, creates the tunnel key `~/.ssh/roxira_gateway_tunnel`
   and prints its PUBLIC half for step 2.
5. **Install, part 2 (admin, once):** `sudo bash install_root.sh --lane-user <lane user> --apply`. It installs
   `/usr/local/sbin/roxira-lane-root` (verbs `linger-on`, `linger-off`, `status`, no other argument) and the single
   sudoers line `<lane user> ALL=(root) NOPASSWD: /usr/local/sbin/roxira-lane-root`, so the user units survive logout.
   Then re-run `install_user.sh --apply` (it calls `linger-on`). Undo: delete those two files.
6. **Server side, the virtual key.** On the production server the key `laptop-mahansudo-srv` already exists
   (`docs/ops/TWO_COMPUTERS.md`). Create a separate one for the box instead of reusing it (so it can be capped and
   rotated alone): add a `box-lanes` entry to `gateway.virtual_keys` in `config/key_pool.yaml` (a normal reviewed PR),
   then on the server `python3 scripts/infra/key_pool/virtual_keys.py` (agent groups only, paid spend capped per day,
   suggested 1 USD). Its value lands in `generated/virtual-keys.env` on the server and is never printed.
7. **Give the box the secrets, without pasting.** Use the owner relay of `scripts/ops/set_server_env.sh` (hidden prompt
   or `--from-local`; see `docs/ops/ADD_LLM_KEY.md`) to put `KEYPOOL_MASTER_KEY` (the box virtual key from step 6) into
   `~/.config/roxira-lane/gateway.env`, and `TUNNEL_HOST`, `TUNNEL_USER`, `TUNNEL_PORT` into
   `~/.config/roxira-lane/tunnel.env`. Both files stay mode 600 and are outside the repo. Also pin the server host key
   once into `~/.ssh/known_hosts_roxira_gateway` (compare the fingerprint with the server's before accepting; the unit
   uses `StrictHostKeyChecking=yes`).
8. **Start the tunnel:** `bash install_user.sh --apply --enable-tunnel`, then
   `curl -s http://127.0.0.1:4181/health/liveliness` must print `"I'm alive!"`. Status: `systemctl --user status roxira-gateway-tunnel`.
9. **Smoke test:** `lane-run --smoke` (same as `run_task.sh --smoke --gateway --public` with the box environment).
   It must end with `"ok": true` and `"smoke_ok": true`, and add a line to `lane-run.jsonl`.
10. **Only after step 9 passes**, enable the queue: `systemctl --user enable --now roxira-lane-taskq.timer` and queue
    work with `ROXIRA_AGENTS_HOME=~/.local/state/roxira-lane python3 scripts/infra/server_agents/taskq.py add --lane l5 --public --ladder free ...`.
    Check caps any time: `lane-run --budget --lane L5`.

Roll back: `systemctl --user disable --now roxira-gateway-tunnel roxira-lane-taskq.timer`, delete
`~/.config/systemd/user/roxira-*`, `~/.config/roxira-lane`, `~/.local/state/roxira-lane`, the tunnel key and its
`authorized_keys` line on the server, and (admin) `/usr/local/sbin/roxira-lane-root` plus `/etc/sudoers.d/roxira-lane-root`.

## What the owner has to provide

- The restricted tunnel key line on the server (step 2) and the dedicated tunnel-only account.
- The `box-lanes` virtual key (step 6) and its daily USD cap (a business decision).
- The secret values, entered only through `scripts/ops/set_server_env.sh` (step 7).
- An admin on the box for steps 3 and 5.

## Open points and not verified

- **Not verified on the box or on production** (no access from the authoring environment): the nftables egress lock
  allowing `nc -X connect` to the proxy, the proxy reaching the server's ssh port, `nc` flavour, OpenCode
  installability and its version, `loginctl enable-linger` under the existing polkit rules, the user systemd instance,
  and the real smoke test. Dry-run and the offline test were run on a Mac only.
- **Conflict to decide:** the brief says "no production SSH key on this box". This pack uses a forwarding-only key
  (`restrict,permitopen`, no shell) on a dedicated account. If that is still not acceptable, the alternative is a
  reverse tunnel started from the server side, which needs a server-side unit (not built here).
- The `/key/info` endpoint (used for `cost_usd`) and the exact `virtual_keys.py` entry format were not checked against
  the running LiteLLM version; if `/key/info` fails, `cost_usd` is logged as `null` and the USD cap then does not bind
  (the attempts cap and the server-side per-key cap still do). Tokens are always `null`.
- `lane_budget.py` was reused unchanged; the box log does not feed the server's gateway cost log, so the caps here are
  local and per box.
- `taskq.py` was written for the server (root); a run as a normal user with `--max-parallel 1` was not tested. Its
  review hook and notifier are switched off in the unit (`TASKQ_REVIEW=0`, `TASKQ_NOTIFY=0`) because they need other
  keys; review stays with the existing cross-family review on the PR.
- No pytest file was added: `test_lane_run.sh` is bash and CI does not collect it. Run it by hand:
  `bash scripts/ops/ci_box/lane_runner/test_lane_run.sh`.
