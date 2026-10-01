# scripts/dev: rx and rxall

Run a worker on a GitHub issue in its own git worktree, then open a PR.

Install:

    ln -sf "$PWD/scripts/dev/rx" ~/bin/rx && ln -sf "$PWD/scripts/dev/rxall" ~/bin/rxall

## Usage

    rx <issue> [model] [base-branch]
    rxall [-m model] <issue> [<issue> ...]     # max 3 in parallel

- `model`: `codex` (default), `dsflash`, `dspro`, or `codestral`. `codex` uses
  `codex exec` and the Codex CLI's ChatGPT subscription login—no API key and no
  Claude quota. The other models run through the OpenCode pool.
- If a run ends with no changes, fails, or times out, rx retries once with the
  next model in `codex -> dsflash -> dspro -> codestral`, and prints which model
  produced the result. If the Codex CLI is unavailable, rx skips `codex`.
- `RX_TIMEOUT_SECS`: per-worker-attempt timeout in seconds (default `900`). A
  timed-out worker is stopped and rx continues to the next fallback model.
- `RX_REPAIR`: enable repair round on ruff gate failure (default `1`). When enabled, the worker gets one repair round with the lint output before giving up.
- `base-branch`: worktree starts from `origin/<base-branch>` (default `main`),
  so a worker can continue an existing PR branch. The PR still targets `main`
  from `issue-<n>`.
- Pre-PR gate: `python3 -m ruff check --select F821,F811,E9` on changed `*.py`
  files (skipped if ruff is missing). Failure means no commit and no PR.
- Full log: `~/rx-logs/<issue>.log`; stdout has a short summary.

## Exit codes

- 0: PR opened
- 1: no changes from any model
- 2: usage error
- 3: ruff gate failed (nothing committed)

## Issue sizing (docs/decisions/0003-agent-operating-model.md)

Write issues for the cheap lane as: at most ~80 changed lines, at most 3 files,
and every fact the worker needs inline in the issue body (file paths, function
names, signatures). rx warns when the body is over 6000 characters or names no
file path.
## PR auto-merge

After `rx` opens a PR, it enables squash auto-merge unless the diff touches a sensitive path. Set `RX_AUTOMERGE=0` to skip this step; sensitive PRs remain for hub review.
