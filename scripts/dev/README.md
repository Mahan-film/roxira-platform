# scripts/dev: rx and rxall

Run a cheap OpenCode worker on a GitHub issue in its own git worktree, then open a PR.

Install:

    ln -sf "$PWD/scripts/dev/rx" ~/bin/rx && ln -sf "$PWD/scripts/dev/rxall" ~/bin/rxall

## Usage

    rx <issue> [model] [base-branch]
    rxall [-m model] <issue> [<issue> ...]     # max 3 in parallel

- `model`: `dsflash` (default), `dspro`, `codestral`. If a run ends with no
  changes or opencode fails, rx retries once with the next model in the chain
  `dsflash -> dspro -> codestral`, and prints which model produced the result.
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
