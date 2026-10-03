# Zero-cost CI: run the checks locally

GitHub Actions minutes cost money. `scripts/dev/local_ci.sh` runs the same checks as
`.github/workflows/ci.yml` on your machine.

## 1. local_ci.sh

```bash
pip install -r ci/requirements-test.txt   # ruff, pytest, pytest-timeout, pyyaml
brew install gitleaks                     # optional; skipped with a notice if missing
scripts/dev/local_ci.sh                   # base ref defaults to origin/main
scripts/dev/local_ci.sh --base main
LOCAL_CI_SKIP_PYTEST=1 scripts/dev/local_ci.sh
```

Steps (mirroring CI):

| Step | Blocking | Notes |
|---|---|---|
| ruff statistics | no | same as CI (pre-existing violations) |
| undefined names (F821/F822/F823) | yes | same paths and excludes as CI |
| system inventory | yes | `gen_system_inventory.py --check`; fix with `python3 scripts/gen_system_inventory.py` and commit |
| pytest unit | yes | `pytest -m "not integration" -q --timeout=60`; side-effecting files are excluded by `src/conftest.py` from `src/ci_quarantine.py`. The script refuses to run if conftest stops applying the quarantine. Never run pytest any other way over `src/`. |
| gitleaks | yes, if installed | only commits added since the base ref |
| frontend `npm ci`, lint, build | build yes, lint no | only if `output_apps/enterprise_hub/frontend/` changed |

It prints a PASS/SKIP/FAIL summary and exits non-zero on any failure. Semgrep, Trivy and
the compose/template jobs are report-only in CI and are not run locally.

## 2. Pre-push hook

```bash
scripts/dev/install_hooks.sh
```

Every `git push` then runs `local_ci.sh`. Skip once with `SKIP_LOCAL_CI=1 git push`. An
existing pre-push hook is saved as `pre-push.bak`.

## 3. Local secrets

Run from outside the repo (the script refuses to run inside it):

```bash
cd ~ && /path/to/roxira-platform/scripts/dev/setup_secrets.sh
$EDITOR ~/Secrets/roxira/roxira.env      # fill in values
source ~/Secrets/roxira/load_secrets.sh  # exports them into this shell
```

It creates `~/Secrets/roxira` (mode 700) and `roxira.env` (mode 600) holding only empty
`NAME=` placeholders taken from `.env.example` and `docker-compose.prod.yml`. Re-running
keeps existing values and appends only missing names. No values are ever printed.
`*.env` is already in `.gitignore`, which covers `roxira.env`.

## 4. Optional: self-hosted runner on the owner's Mac (PRIVATE repo only)

Only needed if you want Actions to trigger the same checks on your own hardware.

**Never attach a self-hosted runner to a public repository.** Anyone can open a pull
request whose workflow code then executes on your machine. If this repo ever becomes
public, remove the runner first.

Hardening:

- Create a dedicated standard (non-admin) macOS user, e.g. `gh-runner`. Install and run the
  runner only as that user.
- That user has no prod SSH keys, no `~/Secrets`, no cloud or `gh` credentials, no access to
  your main user's home, and no keychain items. Do not add it to the admin group.
- Prefer ephemeral/JIT runners: register with `./config.sh --ephemeral` (or the JIT config
  API) so each runner takes exactly one job and is removed afterwards. Start a fresh one
  per job rather than leaving a long-lived service running.
- Restrict at repo level: Settings > Actions > Runners > runner group limited to this repo;
  require approval for workflows from outside collaborators; keep default `GITHUB_TOKEN`
  permissions read-only.
- Use `runs-on: [self-hosted, macOS]` only in a dedicated workflow that runs
  `scripts/dev/local_ci.sh`; do not expose deploy secrets to it.
- Keep the runner software updated and shut it down when not in use.
