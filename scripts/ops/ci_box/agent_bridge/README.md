# Agent bridge v0 (GitHub issue #965)

Lets the Mac hub (login mahan-films) hand work to the box hub without the owner relaying messages.
Everything goes through comments on issue #965, so there is an audit trail. Refs #1021, research in `docs/research/R21_AGENT_BRIDGE.md`.

## Protocol

Mac hub posts a comment (use `scripts/dev/hub_wave.sh`):

    WAVE: 20261120-1000-box-ci
    ```yaml
    id: 20261120-1000-box-ci
    lane: box-ci
    task: |
      Check the latest CI runs and summarise failures.
    acceptance:
      - one-paragraph summary
    max_turns: 30        # default 30
    mode: read           # read (default) or write
    ```

The box timer (every 5 minutes) answers with `REPORT: <id>` (status, lane, duration, cost, summary).
Read answers with `bash scripts/dev/hub_reports.sh [since-id]`. A WAVE that cannot be parsed gets
`REPORT: c<comment-id>` with status `rejected`.

## Safety rules enforced by `bridge.py`

- Only comments whose author numeric id is in `allowed_user_ids` (config) and whose body starts with `WAVE:` are acted on. `REPORT:` and all other comments are never acted on.
- Comments that were edited (`updated_at != created_at`) are ignored.
- Dedupe by last-processed comment id in `~/.local/state/roxira-bridge/state.json`, written before the run starts. The first run only sets a baseline and ignores older comments.
- Kill switch: `touch ~/.config/roxira-bridge/STOP`. `flock` allows one run at a time.
- HTML comments, control and zero-width characters are stripped; the task goes inside `<untrusted_task_data>` in a fixed prompt.
- `claude -p --output-format json --permission-mode dontAsk --allowedTools ... --disallowedTools ... --max-budget-usd N`. This claude build has no `--max-turns`, so the script only passes it when `claude --help` lists it; the wall-clock timeout (45 min) and the budget cap always apply. `max_turns` from the WAVE (clamped to 1-100) is given to the model as a step budget.
- Read mode: Read, Grep, Glob, `git status/log`, `gh pr list`, `gh issue view`, `gh run list`. Write mode adds Edit/Write, git add/commit/switch/push, `gh pr create/view/checks/comment`. Denied in both: `--no-verify`, `--force`, `-f`, pushes naming `main`, `git reset --hard`, `git clean`, `gh pr merge` (denied outright in v0), `rm -rf`.
- Reports pass a redaction step (key prefixes, PEM blocks, IPv4 other than 127.0.0.1) before posting.
- Logs go to journald: `journalctl --user -u roxira-bridge -f`.

## Install (box, as mahanfilms, no sudo)

    cd ~/roxira-platform && git pull
    bash scripts/ops/ci_box/agent_bridge/install_user.sh
    $EDITOR ~/.config/roxira-bridge/env      # put the real local proxy port in, keep chmod 600
    systemctl --user restart roxira-bridge.timer
    systemctl --user start roxira-bridge.service   # first run: logs "baseline set"
    journalctl --user -u roxira-bridge -n 20

Owner step (needs sudo, once, so the timer runs without a login session):

    sudo loginctl enable-linger mahanfilms

`install_user.sh` copies `bridge.py` to `~/.local/share/roxira-bridge/` so a write-mode agent cannot edit the code that runs it. Rerun the script after updating the repo. Requires gh logged in as mahansudo, `claude` logged in, python 3.11+.

The allowlist ids in `bridge.example.toml` came from `gh api users/<login> --jq .id`. Re-check before trusting them.

## Tests

    python3 -m pytest scripts/ops/ci_box/agent_bridge -q

Not covered: a live end-to-end run through the box proxy, and the exact deny-rule glob semantics of the installed claude build (verify with a read-mode WAVE that tries a denied command).
