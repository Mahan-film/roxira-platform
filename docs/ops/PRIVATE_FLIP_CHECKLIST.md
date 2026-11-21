# Private flip checklist (GitHub Free, USD 0)

Goal: make `Mahan-film/roxira-platform` private on the **Free** plan without merging or CI
stopping. Plan and owner decision: `docs/strategy/PRIVATE_REPO_PLAN_2026-11-17.md` (option A,
2026-11-18). **The flip itself is done by the main hub or the owner**, not by the box hub.
Status as of 2026-11-21 (box hub). Update the Status column as items land; every command below is
read-only unless the row says otherwise.

## 1. What a private repo on GitHub Free loses (checked 2026-11-21)

Source: GitHub's docs source (`github/docs`, `data/reusables/gated-features/*`) and the billing
pages; quotes are short.

| Feature | Private on Free | Source | Our replacement |
|---|---|---|---|
| Merge queue | **gone**: "private repositories owned by organizations using GitHub Enterprise Cloud" only | [managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | box merge gate (`scripts/ops/ci_box/merge_gate`, #1029) |
| Protected branches | **gone**: "available in public repositories with GitHub Free" | [about protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | merge gate + pre-push hooks + direct-push alert (#951) |
| Rulesets (our `main-protection`) | **not enforced**: "available in public repositories with GitHub Free" | [about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) | same as above |
| Auto-merge (`gh pr merge --auto`) | **gone** (same plan list as protected branches) | [automatically merging a PR](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) | merge gate |
| Environments + environment secrets (`production` in `deploy-prod.yml`) | **gone**: private repos need Pro, Team or Enterprise | [gated-features/environments.md](https://github.com/github/docs/blob/main/data/reusables/gated-features/environments.md) | main hub: pull deploy with a read-only deploy key (#1020) |
| GitHub Pages (`project-pages.yml`) | **gone**, a published site is unpublished ([gated-features/pages.md](https://github.com/github/docs/blob/main/data/reusables/gated-features/pages.md)) | [setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) | none needed now (main hub decides) |
| Code scanning / CodeQL (`codeql.yml`), secret scanning, push protection | **stop working** without a paid GHAS / Code Security / Secret Protection licence | same page | Semgrep CE required (#949), gitleaks pre-push + CI, OSV (#1032) |
| Hosted Actions | **USD 12/month of compute, 500 MB storage**; "usage is blocked once you consume the included compute usage" when no payment method is on file | [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | box runs CI (self-hosted) |
| Self-hosted runners | **free**: self-hosted runners "Are free to use with GitHub Actions" | [self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) | box JIT pool (#1024) |
| `ubuntu-slim` (1 vCPU, 15 min max) | billed from the USD 12 (`actions_linux_slim`, USD 0.002/min) | billing page above | only the `Pick runner` job uses it |
| Dependabot alerts / updates, collaborators | kept | plan docs | — |

Not verified: the history of the per-minute self-hosted "platform charge" that GitHub announced in
December 2025 and then postponed. The current billing page lists self-hosted runners as free.
Re-check that page right before the flip.

## 2. Prerequisites

| # | Prerequisite | Status | Verify (read-only) |
|---|---|---|---|
| P1 | Scanners: gitleaks pre-push + CI, OSV, Semgrep (#1032) | **done** (merged) | `gh pr view 1032 -R Mahan-film/roxira-platform --json state -q .state` |
| P2 | gitleaks hook installed in every clone and worktree (box, Mac, colleague) | box: done; Mac and colleague: unknown | in each clone: `grep -c gitleaks .git/hooks/pre-push` (expect ≥1); fix with `bash scripts/dev/install_hooks.sh` |
| P3 | Semgrep CE blocking on new findings, named `Semgrep CE (new findings)` (#949) | **open**, PR #1044 | `gh pr view 1044 -R Mahan-film/roxira-platform --json state -q .state` |
| P4 | Secret guard (`Agent guards (money, tenant scope, model ids, secrets)`) in the merge gate's required checks | **done** | `grep -n "Agent guards" ~/.config/roxira-merge-gate/merge_gate.toml` (box, mahanfilms) |
| P5 | Merge gate installed, dry-run, proxy set, `required_checks` equal to real check names | **done** (dry-run). After #1044 merges: add `"Semgrep CE (new findings)"` to the live toml | `systemctl --user is-active roxira-merge-gate.timer`; `journalctl --user -u roxira-merge-gate -n 20` |
| P6 | Merge gate works with gh 2.46 on the box (no `--slurp`) | **open**, PR #1035 | `gh pr view 1035 -R Mahan-film/roxira-platform --json state -q .state` |
| P7 | Nightly mirror + weekly issue/PR export live (#1030) | **not installed** on the box yet (needs #1035, then `07_user_mirror_export.sh`; `06_root_reliability.sh` by the owner) | `ls ~/.config/systemd/user/ \| grep -i mirror`; `box-backup-status` (after 06) |
| P8 | Runner picker in `ci.yml`, fork guard, `runner` dispatch input, nightly run (#949) | **open**, PR #1044 | `gh variable list -R Mahan-film/roxira-platform` (expect `CI_RUNNER_MODE` unset until P11) |
| P9 | Remote local CI `LOCAL_CI_REMOTE` (#947) | **open**, PR #1045 | `LOCAL_CI_REMOTE=runner@roxira-ci scripts/dev/local_ci.sh` from the Mac |
| P10 | JIT pool: owner root script run, Playwright seeded (`seed_playwright.sh`), controller live, two green JIT runs, fallback tested (#1024) | **open**, PR #1046; blocked on the owner running `08_root_ci_pool.sh`. Box run on #1044: 16 jobs green, 3 wait for that script | `python3 ~/roxira-jit/jit_pool.py --status` (both `launcher=alive`); `docs/ops/CI_JIT_POOL.md` steps 5–6 |
| P11 | `CI_RUNNER_MODE=auto` for a full day before the flip, CI green on the box | not started | `gh variable get CI_RUNNER_MODE -R Mahan-film/roxira-platform`; job `runner_name` of the last CI runs starts with `jit-` |
| P12 | Direct-push-to-main alert (#951) | **open**, PR #1005 has a blocker (duplicates the merge gate; alert would fire on the daemon's audit pushes) | `gh pr view 1005 -R Mahan-film/roxira-platform --json state -q .state` |
| P13 | Hosted-minute budget fits USD 12 | **at risk**, see section 3 | GitHub → Mahan-film → Settings → Billing and licensing → Usage (org owner) |
| P14 | Production deploy no longer needs the `production` environment | main hub (#1020) | `grep -n "environment:" .github/workflows/deploy-prod.yml` |
| P15 | No payment method on the org, so overage blocks instead of billing | owner check | GitHub → Mahan-film → Settings → Billing and licensing |

## 3. Hosted minutes after the flip (estimate)

Measured on runs created 2026-11-18 to 2026-11-21 (wall-clock per run; billing rounds each job up
to a whole minute):

| Workflow | Runs in ~3.2 days | Avg min | After the flip |
|---|---|---|---|
| CI | 189 | 5.5 | box (picker). Hosted part: `Pick runner` ≈ 1 min each on `ubuntu-slim` ≈ 1,800 runs/month ≈ **USD 3.6** |
| Review desk (`review-desk.yml`, hard-coded `ubuntu-latest`, every 2 h + dispatches) | 31 | 5.3 | hosted: ≈ 290 runs/month × 6 min × USD 0.006 ≈ **USD 10** |
| CodeQL | 34 | 4.6 | stops (no code scanning on private Free): disable the workflow |
| Uptime, factory, agent workflows | few | <1 | hosted, small |

Total ≈ USD 14 > USD 12: without a change the allowance runs out late in the month and hosted
jobs (the picker included, which then falls back to `"ubuntu-latest"` and fails to start) stop
until the 1st. Options, cheapest first (owner / main hub decide):
1. Review desk every 4 h instead of 2 h and dispatch it once per hub round (≈ USD 5).
2. Run the review desk on the box as a user timer through the local proxy, like the bridge (USD 0;
   needs the review keys in the box environment, part of #1021/#1022).
3. Pick runner: set `CI_RUNNER_MODE=box` (static) and skip the picker job; the fallback becomes the
   manual `-f runner=hosted` dispatch only (saves ≈ USD 3.6).

## 4. Flip (main hub or owner; in this order)

1. All of P1–P13 done; P14 decided by the main hub. Announce a 30-minute merge freeze on #592.
2. Merge queue empty (repo → Pull requests → Merge queue on `main`) and no CI run in progress for
   `merge_group`: `gh run list -R Mahan-film/roxira-platform -e merge_group -s in_progress`.
3. Disable workflows that cannot work on private Free:
   `gh workflow disable codeql.yml -R Mahan-film/roxira-platform`
   `gh workflow disable project-pages.yml -R Mahan-film/roxira-platform`
   and, if #1020 has not replaced it, `gh workflow disable deploy-prod.yml -R Mahan-film/roxira-platform`.
   `agent-automerge.yml` and `rx-automerge.yml` call `gh pr merge --auto`, which fails without
   auto-merge: `gh workflow disable agent-automerge.yml -R Mahan-film/roxira-platform` and
   `gh workflow disable rx-automerge.yml -R Mahan-film/roxira-platform`.
4. Merge gate live (box hub, on the main hub's "go live"): set `dry_run = false` in
   `~/.config/roxira-merge-gate/merge_gate.toml`; watch one tick in
   `journalctl --user -u roxira-merge-gate -n 20`.
5. Flip:
   `gh repo edit Mahan-film/roxira-platform --visibility private --accept-visibility-change-consequences`
6. Verify within the hour:
   - `gh api repos/Mahan-film/roxira-platform -q .private` → `true`;
   - a small docs PR: `Pick runner` summary says box, checks green, review desk verdict, merge gate
     merges it (`journalctl --user -u roxira-merge-gate`);
   - `bash scripts/dev/claim.sh new "flip smoke test" --agent claude` works, then close that PR;
   - the colleague can clone and push a branch;
   - `gh api repos/Mahan-film/roxira-platform/actions/runners -q '.runners[]|.name+" "+.status'`
     shows the JIT runners;
   - post `BOX: private flip verified` on #592.
7. Later cleanup PR: drop the `merge_group` triggers from `ci.yml` (inert on private Free) and the
   merge-queue wording that is left in docs.

## 5. Rollback

Any of: merging stops for more than 2 hours, CI cannot run anywhere, the colleague loses access.

1. Make it public again (same command, reversible):
   `gh repo edit Mahan-film/roxira-platform --visibility public --accept-visibility-change-consequences`
   Going public again exposes the Actions history and logs to everyone, so first check that no log
   printed a secret.
2. The ruleset `main-protection` and the merge queue apply again as soon as the repo is public; set
   the merge gate back to `dry_run = true` so it does not race the queue.
3. Re-enable the workflows from flip step 3 with `gh workflow enable <file> -R Mahan-film/roxira-platform`.
4. CI: `gh variable set CI_RUNNER_MODE -b hosted -R Mahan-film/roxira-platform` (hosted minutes are
   free again on a public repo).
5. Pages: re-publish only if it was in use (`project-pages.yml` dispatch).
6. Report on #592 with what failed.

What a rollback cannot undo: public forks detached at the flip stay detached (0 forks on
2026-11-17), and the repo leaves the GitHub Archive Program.
