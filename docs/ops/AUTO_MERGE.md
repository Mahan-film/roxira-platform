# Auto-merge for `agent/*` pull requests (W13)

This is the owner checklist for `.github/workflows/agent-review.yml` and
`.github/workflows/agent-automerge.yml`. Read this before setting
`AUTO_MERGE_ENABLED=true`.

## Why this stays off by default

The repo is **private on GitHub Free**. Branch protection / rulesets on
`main` are a GitHub Pro (or Team/Enterprise) feature -- the API returns
"Upgrade to GitHub Pro" for this repo today. Without a ruleset:

- Nothing stops a direct `git push` to `main` by anyone with write access.
- Nothing stops a manual merge from the GitHub UI that skips CI or the
  `agent-review` check.
- `agent-automerge.yml`'s `gh pr merge --squash --auto` is a **safety net for
  one specific path** (an agent's own PR going through its own workflow),
  not an enforced gate. It only runs the checks the workflow itself asks for.

`AUTO_MERGE_ENABLED` therefore defaults to unset (off). Turn it on only after
buying GitHub Pro and creating the ruleset below -- at that point the
workflow's gate and the platform's ruleset back each other up, which is the
actual safety property this was built for.

## Checklist to go live

1. **Buy GitHub Pro** for the account/org that owns this repo (private repos
   need Pro or higher for rulesets/branch protection).
2. **Create a ruleset on `main`** (Settings -> Rules -> Rulesets -> New
   branch ruleset):
   - Target branch: `main`.
   - Require a pull request before merging.
   - Require status checks to pass: `ci` (the CI workflow's job names -- at
     minimum `ruff`, `pytest`, `gitleaks`) **and** `agent-review`.
   - Block force pushes.
   - Do not allow bypass (no "Repository admin" bypass list entry) -- a
     bypass entry defeats the point of the ruleset for exactly the actors
     most likely to be operating unattended.
3. **Enable "Allow auto-merge"** in repo settings (Settings -> General ->
   Pull Requests -> Allow auto-merge). `gh pr merge --auto` requires this to
   be on at the repo level even when the workflow's own gate already passed.
4. **Create the `needs-human` label** (Settings -> Labels), alongside the
   existing `agent` / `agent-pr-open` labels from W10.
5. **Set repo variables** (Settings -> Secrets and variables -> Actions ->
   Variables):
   - `AGENT_REVIEW_MODEL` -- an OpenRouter model id for the reviewer. **Must
     differ from the executor model** (`AGENT_OPENCODE_MODEL` /
     `deepseek/deepseek-v4.1-flash`) -- reviewing a PR with the same model
     that wrote it defeats the point of a second opinion. `review_gate.py`
     reads this with no default and fails closed (posts a `request_changes`
     verdict, sets the `agent-review` status to `failure`) if it is unset.
   - `AUTO_MERGE_ENABLED=true` -- only once steps 1-4 are done.
   - `AGENT_ALLOWED_ACTORS` -- same comma-separated allowlist `agent-task.yml`
     already uses (default `mahan-films`).
   - `AGENT_AUTOMERGE_MAX_DIFF_BYTES` -- optional, default `60000`.
   - `AGENT_DAILY_BUDGET_USD` -- optional, default `2`. See "Cost guard"
     below for what this can and can't actually enforce.
6. **Set the repo secret** `OPENROUTER_AGENT_KEY` if it isn't already set
   from W10 (same dedicated, capped key `agent-task.yml` uses -- never the
   product's main key).
7. Run one real agent PR end to end with `AUTO_MERGE_ENABLED` still **off**
   first, and confirm the `agent-review` comment + commit status look right,
   before flipping it on.

## How the gate works

`agent-review.yml` runs on every `pull_request` from an `agent/*` branch
(same-repo only, never a fork). It:

1. Computes the diff against the PR's base commit.
2. Waits for `ci.yml`'s conclusion on that commit.
3. Sends the diff + CI status to `AGENT_REVIEW_MODEL` via OpenRouter, with
   the diff explicitly framed as **untrusted input** (a coding agent's diff
   can contain a prompt-injection attempt, e.g. a comment telling the
   reviewer to approve regardless of content -- the reviewer prompt tells the
   model to treat that as data to flag, not an instruction to follow). See
   `output_apps/ecosystem_core/src/factory/review_gate.py`.
4. Posts the verdict (`approve`/`request_changes`, `risk`, `reasons`) as a PR
   comment and sets a commit status named `agent-review`.

`agent-automerge.yml` runs only when `AUTO_MERGE_ENABLED == 'true'`, and
merges (`gh pr merge --squash --auto`) only when **all** of these hold
(`output_apps/ecosystem_core/src/factory/automerge_gate.py::decide`):

- Branch starts with `agent/`.
- PR author is in `AGENT_ALLOWED_ACTORS`.
- CI concluded `success`.
- `agent-review` verdict is `approve` **and** risk is `low`.
- Diff is at or under `AGENT_AUTOMERGE_MAX_DIFF_BYTES`.
- No changed path matches the deny list: auth (`*auth*`, `*_auth*`), payments
  (`zibal`, `*/payment/*`), secrets (`.env`, `.env.*`), `.github/**`,
  `docker-compose*.{yml,yaml}`, `*nginx*.conf`, `*.service`,
  `config/models.yaml`, `scripts/ops/**`, `**/migrations/**`.

Any failing condition labels the PR `needs-human` and comments why, instead
of merging.

## Cost guard

Every ephemeral GitHub Actions runner starts empty, so a per-workflow-run
JSONL ledger (`output_apps/ecosystem_core/src/factory/cost_ledger.py`) is a
same-run sanity check only, not a cross-run daily budget -- it cannot see
what other runs spent today. The **real** daily cap is the
`OPENROUTER_AGENT_KEY`'s own `limit` with `limit_reset: daily` (set via the
OpenRouter dashboard or the Provisioning API), exactly as documented for
`agent-task.yml` in `docs/AGENTS_WORKFORCE.md` #6.

`agent-review.yml` additionally calls `cost_ledger.check_daily_budget()`
before spending anything: a cheap, read-only `GET /api/v1/key` call. When the
key reports a daily-scoped `limit_remaining`, the workflow skips (posts a
"skipped: daily budget guard" comment, sets `agent-review` to `pending`)
once that's exhausted -- a real, if same-run, enforcement. When the key has
no daily `limit_reset` configured, this check cannot tell "today's spend"
from "all-time spend" and does **not** block (a false positive here would
silently stop every future review) -- it only documents that the key's own
`limit_reset` is the real guard. Set `limit_reset: daily` on the key to get
the stronger behavior.

`scripts/cost_report.py` aggregates whatever ledger files you point it at
(the product router's usage log, an agent-task ledger, an agent-review
ledger) into a daily/weekly summary, in English or Persian
(`--lang fa`). It is a local/offline reporting tool -- it does not fetch
anything cross-run on its own, since GitHub Actions doesn't give a workflow
a persistent place to write one without adding external storage.

## How to turn auto-merge off

Set the repo variable `AUTO_MERGE_ENABLED` to `false` or delete it. The
workflow's own `if:` guard (`vars.AUTO_MERGE_ENABLED == 'true'`) means the
job is entirely skipped, not merely gated at decision time -- no gate logic
runs at all. `agent-review.yml` is independent and keeps running either way
(it posts a verdict; it never merges).
