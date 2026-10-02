# Server-side auto-merge for rx PRs (issue #351)

This is the design for automatic merging of trusted-agent `issue-<n>` pull
requests. `scripts/ci/merge_gate.py` is the **pure decision library** built by
this issue; a later issue wires it into a workflow. Read this before enabling
anything.

## Research facts (verified 2026-10-02)

- **GitHub auto-merge only works on a PR that cannot merge immediately.** If a
  PR is already `clean`, or `unstable` (a non-required check red/pending),
  `enablePullRequestAutoMerge` is refused with
  `Pull request is in clean/unstable status (enablePullRequestAutoMerge)`.
  A client that enables auto-merge right after opening the PR is therefore
  racing CI, and depends on a flaky Mac network.
- **The merge queue is not available** for private repos on the Team plan.
- **A merge made with `GITHUB_TOKEN` does not trigger workflows.** Merging with
  the built-in token produces no CI on `main` and no auto-deploy. A PAT or a
  GitHub App token must be used instead.
- Our `main` ruleset has 4 required checks (`Detect changes`,
  `Secret scan (new commits only)`, `Pytest (unit)`, `Frontend gate`), strict
  up-to-date = **false**, 0 required approvals, and repository admins can
  bypass via PR.

Conclusion: merging must be decided **server-side, after CI finishes**, by
trusted code, with an explicit check list.

## Design

```
CI finishes on the PR head
        │
        ▼
trusted workflow on main (workflow_run / workflow_dispatch)
        │  gathers pr.json, checks.json, files.txt
        ▼
scripts/ci/merge_gate.py :: decide(...)
        │  {"action": "merge" | "wait" | "block", "reasons": [...]}
        ▼
action == merge ?
        │
        └─► gh pr merge --squash --match-head-commit <sha>   (PAT/App token)
```

- The workflow always checks out `main`, never the PR head, so the gate itself
  can never be modified by the PR it is judging.
- `--match-head-commit <sha>` makes the merge fail if the head moved between
  the decision and the merge. The gate also refuses (`wait`) when `head_sha`
  differs from the `expected_sha` the run was scheduled for.
- The merge uses a PAT / GitHub App token so that `push` on `main` fires CI and
  the auto-deploy. A `GITHUB_TOKEN` merge would not.

### The decision library

`decide(pr, checks, files, *, expected_sha, allowed_actors, now=None)` returns
`{"action": ..., "reasons": [...]}`. Rules, in order:

1. `state != "OPEN"`, `is_draft`, or a `hold` label -> **block**.
2. `head_ref` must match `^issue-[0-9]+$` and `author_login` must be in
   `allowed_actors` -> otherwise **block**.
3. `head_sha != expected_sha` -> **wait** ("head moved; a newer run will decide").
4. `mergeable == "CONFLICTING"` -> **block**; `"UNKNOWN"` -> **wait**.
5. Every name in `REQUIRED + EXTRA_REQUIRED`: missing or not `completed` ->
   **wait**; completed with a conclusion other than `success` -> **block**.
   An `Agent review` check that `failure`/`cancelled`/`timed_out` -> **block**;
   `success`/`skipped`/`neutral`/absent is fine. No other check can block --
   report-only jobs are allowed to be red.
6. `additions + deletions > 1500` -> **block**.
7. Any changed path matching `SENSITIVE` without the `hub-approved` label ->
   **block**.
8. Otherwise -> **merge**.

**A block beats a wait, and a wait beats a merge.** `REQUIRED` mirrors the
ruleset; `EXTRA_REQUIRED` (`Undefined names`, `System inventory up to date`) is
deliberately stricter, because a red CI would not stop the platform merge but
*would* stop the auto-deploy. So the gate must stop it too.

## One-time owner step: `MERGE_BOT_TOKEN`

Create a **fine-grained PAT limited to this repository** with:

- Contents: **write**
- Pull requests: **write**
- Metadata: **read**

Store it as the Actions secret `MERGE_BOT_TOKEN`. It is never printed, echoed,
or written to a log or artifact by any workflow.

## Kill switches

- **Repo variable `AUTO_MERGE_ENABLED`** -- the workflow's own `if:` guard. When
  it is not exactly `true`, no gate logic runs at all (not merely gated at
  decision time).
- **Label `hold`** -- `decide` blocks any PR carrying it. This stops a single
  PR without touching the global switch.

## Label `hub-approved` for sensitive PRs

`SENSITIVE` covers `.github/`, `scripts/ops/`, `ops/`, `config/models.yaml`,
`docker-compose`, `nginx`, `migrations/`, `docker/`, any `*.sql`,
`src/factory_pipeline/budget.py`, `.semgrep/`, `scripts/ci/merge_gate.py` and
`scripts/dev/rx`. A PR touching any of these only merges once a human adds the
`hub-approved` label -- a deliberate second pair of eyes on the paths where a
bad merge is expensive.

## Why the explicit check list matters despite admin bypass

Admins can bypass the ruleset via PR, and the ruleset only requires 4 checks.
If the gate trusted the ruleset alone, a PR that is red on `Undefined names` or
`System inventory up to date` would still be "mergeable" and would break the
auto-deploy after merge. The gate therefore re-checks an explicit list of
checks (a superset of the ruleset), refuses drafts, non-`issue-<n>` branches,
untrusted authors, conflicts, oversized diffs and sensitive paths -- so the
bypass and the missing checks cannot be turned into an automatic bad merge.

## What this issue does *not* do

It builds and tests only the decision library and this doc. It performs no
network calls and writes no workflow. Wiring the library into a trusted
workflow that merges with `MERGE_BOT_TOKEN` is a follow-up issue.

## Workflow

`.github/workflows/rx-automerge.yml` wires the decision library into a trusted
workflow. The section above describes the library-only first step; this
workflow is the follow-up.

**Flow.** When the `CI` or `Agent review` workflow completes for a pull request
whose head branch starts with `issue-`, the `gate` job runs (also on manual
`workflow_dispatch`). It checks out the **default branch only** with
`persist-credentials: false` and runs one step,
`python3 scripts/ci/merge_gate_run.py`. The script reads the PR, its changed
files and its check-runs through `gh` (paginated with `--paginate --slurp`),
calls `merge_gate.decide`, and acts. It never checks out or executes PR code.
`MERGE_BOT_TOKEN` is passed only in the environment of that single step, and
only the `gh pr merge` call uses it. Runs are serialized
(`concurrency: rx-automerge`, no cancellation).

**Outcomes.**

- `merge` -- `gh pr merge N --squash --match-head-commit <sha>` with
  `MERGE_BOT_TOKEN`. If that secret is missing the gate does not merge; it
  only posts the marked comment and exits non-zero.
- `wait` -- no writes. CI or mergeability is not settled, or the head moved; a
  later `workflow_run` decides.
- `block` -- the reasons are written to the PR and the PR is left alone.

**Where the reasons appear.** In ONE marked PR comment (first line
`<!-- rx-merge-gate -->`, then `Merge gate: BLOCK` and one `- reason` bullet
each). The gate creates it once and PATCHes it on later runs. The decision JSON
is also in the step log and the step summary. A failing `gh` call makes the job
fail with `error: gh failed (exit N)` (no arguments or tokens printed).

**Kill switches.** Set repo variable `AUTO_MERGE_ENABLED` to anything other
than `true` (for example `false`) and the job does not run at all. Add label
`hold` to stop a single PR.

**Sensitive paths.** A PR touching `SENSITIVE` paths (for example `.github/`)
only merges after a human adds the label `hub-approved`.

**PAT expiry.** Fine-grained PATs expire. The owner records the expiry date of
`MERGE_BOT_TOKEN` (for example in `docs/STATE.md`) and renews it before then;
after expiry the gate reports `error: gh failed` instead of merging.

**Testing.** Open a harmless docs-only `issue-<n>` PR by a trusted author, wait
for CI, then run the workflow from the Actions tab with `workflow_dispatch` and
the PR number as `pr_number`. With no run SHA, the gate judges the PR's current
head. Check the job log or the marked PR comment; with
`AUTO_MERGE_ENABLED=true` a clean PR is squash-merged.
