# Local integrator

GitHub Actions is off for this private repo, so merging is done by a local script the
OWNER runs with their own `gh` login. Nothing here stores or prints a token.

## Usage

    scripts/dev/merge_check.py <pr>          # classify only
    scripts/dev/integrate.sh <pr>            # dry run: rebase, local_ci, merge_check
    scripts/dev/integrate.sh <pr> --merge    # merge if AUTO_MERGE_OK and local_ci green

`integrate.sh` fetches the PR head into a temp worktree, rebases it on `origin/main`,
runs `scripts/dev/local_ci.sh`, then `merge_check.py`. With `--merge` it runs
`gh pr merge <pr> --squash --match-head-commit <sha>` using the exact SHA it tested, and
refuses if the PR head moved. It never uses `--admin`; for `OWNER_REVIEW` PRs the owner
runs `gh pr merge --admin` by hand after reading the diff.

## Verdicts (exit codes)

- `AUTO_MERGE_OK` (0): L0/L1 and every rule passes.
- `OWNER_REVIEW(Ln)` (10): L2 without `hub-approved`, any L3/L4 path, a changed
  lockfile/manifest, more than 400 changed lines, or code without a new/extended test.
- `BLOCK(reasons)` (20): test file deleted or reduced, net loss of test functions,
  reviewer verdict `fail` (label `review:fail`), closed/draft PR, or `gh` data unavailable.

The level table, size cap and labels are data in `config/autonomy_ladder.json`
(L0 docs, L1 other code, L2 smartjudge prompts/retrieval/citation/corpus and
`config/models.yaml`, L3 auth/billing/migrations/manifests/DTO/OpenAPI/tenant,
L4 `.github`, `scripts/ci`, `scripts/dev/rx*`, ops, compose, nginx, `budget.py`).

## Hold period

Whether to wait (for example 15 minutes) between a green dry run and `--merge` is the
owner's call; the scripts do not enforce a delay.
