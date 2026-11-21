# Making the repository private (plan, 2026-11-17)

Owner direction 2026-11-17: make `Mahan-film/roxira-platform` private and move the CI/CD load to the owner's HP laptop (`docs/ops/LINUX_CI_BOX.md`). Hub-checked facts on the same day: the `Mahan-film` organisation is on the **Free** plan, with 0 forks and two collaborators.

**Owner decision 2026-11-18: option A (private on the Free plan, no GitHub spend).** Merges move to the merge desk on the CI box (#951, T229). The hub flips visibility itself (`gh repo edit --visibility private`) once #947, #949 and #951 are done.

## What changes when the repo goes private
| Today (public) | Private on the Free plan | Private on the Team plan | Replacement we use |
|---|---|---|---|
| Unlimited free Actions minutes | small monthly compute allowance (USD 12 of usage) | USD 18 of usage | the CI box runs all jobs (self-hosted runner minutes are free) |
| Protected `main`, required checks, rulesets | **not available** | available | Team: a ruleset on `main` |
| Auto-merge (`gh pr merge N --auto --squash`) | **not available** (needs protected branches) | available | Team: unchanged commands. Free: a merge script on the box |
| Merge queue | not available (private repos need Enterprise Cloud) | not available | auto-merge + "branch must be up to date", or the merge script |
| Secret-scanning push protection | lost (paid add-on, Secret Protection) | lost (same add-on) | gitleaks + our key-pattern scanner + the T207 secret guard (#891), in pre-push and in CI on the box |
| CodeQL code scanning | lost (paid add-on, Code Security) | lost | Semgrep Community Edition job on the box, weekly + on PRs |
| Dependabot alerts and updates | kept | kept | — |
| Collaborators | unlimited | each member is a paid seat | — |

Already-public history stays in clones and caches. Going private does not undo a leak: the three secrets printed on 2026-11-17 must still be rotated.

## Options (the plan is the owner's spend decision)
- **A — private on Free (USD 0).** No protected branch, so anyone with write access, including an agent, can push straight to `main`. The only guard is the local pre-push hook. Merges go through a hub script on the box: review desk "no blocker" on the head plus green checks, then `gh pr merge N --squash`.
- **B — private on Team (USD 4 per user per month; 2 users = USD 8 per month).** Protected `main` with required checks and the review-desk status, and auto-merge works as today. The colleague needs a seat. Hub recommended B because Antigravity agents push all day and a protected `main` is the only server-side guard; the owner chose A, so #951 adds an alert on any direct push to `main`.
- **C — stay public.** No cost, but the code and legal content stay visible, and the self-hosted runner keeps the fork-PR risk (mitigated by the guards in `LINUX_CI_BOX.md`).

## Order (do not flip visibility before steps 1–3, or CI stops)
1. CI box live and runner "Idle" (#947).
2. All workflows run on `runs-on: [self-hosted, hp]`, with a `workflow_dispatch` fallback to hosted runners; `merge_group` triggers become `push` to `main` plus a nightly run (#949, lane L1).
3. Semgrep CE job and the secret guard are required checks; gitleaks runs in pre-push (#949).
4. Merge desk (#951) live on the box and merging instead of the queue; direct-push alert on.
5. Docs and prompts: replace "merge queue" wording (`TEAM_SPLIT_2026-11-17.md`, `OPERATIONS_RUNBOOK.md` §7–8, lane prompts). Under A, lanes stop calling `gh pr merge`; the merge desk merges.
6. **The hub flips visibility** (`gh repo edit Mahan-film/roxira-platform --visibility private --accept-visibility-change-consequences`), owner-approved 2026-11-18.
7. Check: CI runs on the box, the colleague can clone and push, `claim.sh` and the review desk work, nothing waits on hosted minutes.
