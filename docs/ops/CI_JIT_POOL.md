# CI JIT runner pool on roxira-ci (R20-8, #1024)

Two ephemeral **just-in-time (JIT)** runner slots on the box, plus the offline fallback in `ci.yml`
(runner picker, #949). Each JIT runner takes exactly one job and is then removed by GitHub.

| Slot | Runs | Isolation | Limits (brief section 7) | Labels |
|---|---|---|---|---|
| `light` | lint, unit tests, scanners | fresh container `roxira-ci-light` per job: no Docker socket, `--cap-drop ALL`, `no-new-privileges`, no host loopback (rootless slirp4netns), own tool-cache volume | `--cpus 1 --memory 2g`, 1 job | `self-hosted, linux-box, jit, slot-light` |
| `docker` | service containers (Postgres, Redis), compose, builds, Playwright | fresh copy of the runner template in its own work dir per job, deleted afterwards; rootless Docker of user `runner`; tool cache `/opt/hostedtoolcache` (the only path where setup-python's builds work) | unit `CPUQuota=400% MemoryMax=6G`, 1 job | `self-hosted, linux-box, jit, slot-docker` |

Everything user `runner` runs, including rootless Docker containers, is also capped as a whole:
`user@<runner-uid>.service` `CPUQuota=500% MemoryHigh=7G MemoryMax=8G TasksMax=8192`. Service
containers of the `docker` slot run under rootless `dockerd`, outside the slot unit, so the
user-wide cap is what bounds them. The phone stack is not limited (priority 1; its containers run
under the system Docker daemon). Builder lanes are limited later by `roxira-orch` (#1021).

## How it fits together

```
mahanfilms (gh login, repo admin)                 runner (executes job code, holds no token)
  roxira-jit-pool.timer, every 30 s                 roxira-jit@light.service   roxira-jit@docker.service
  jit_pool.py:                                      jit_launcher.sh <slot>:
    list runners, delete stale jit-*                  touch spool/<slot>/.alive
    per live slot with no registered runner:          claim oldest spool/<slot>/jit-*.jit (rename)
      POST generate-jitconfig  ----- spool file --->  light: docker create/start (env file, 600)
    write repo variable CI_BOX_HEARTBEAT              docker: fresh runner dir, run.sh, delete dir
                                                      GitHub de-registers the runner after 1 job
ci.yml "Pick runner" (hosted ubuntu-slim) reads CI_RUNNER_MODE + CI_BOX_HEARTBEAT -> box or hosted
```

- The admin credential never reaches user `runner`; it only gets single-use JIT configs through
  `/srv/data/ci-jit/spool/<slot>/` (owner `runner`, ACL for `mahanfilms`). The configs travel in an
  env file or the process environment (`ACTIONS_RUNNER_INPUT_JITCONFIG`), never on a command line,
  and are never logged.
- Launcher code lives root-owned in `/usr/local/lib/roxira-jit`, so a job cannot change it.
- A busy slot stays "ok" in the heartbeat, so jobs queue on the box instead of spending hosted
  minutes; a dead launcher or `HOLD` flips the slot to hosted within one tick (auto mode).
- `hp` is never a JIT label: the old persistent runner keeps `hp` until it is retired.

## Install (once)

1. Owner, one line (dry run first, then the real run):
   `sudo bash scripts/ops/ci_box/08_root_ci_pool.sh --dry-run` then
   `sudo bash scripts/ops/ci_box/08_root_ci_pool.sh`
   (dirs + ACLs, launcher code, the user-wide cap, one font package, and as `runner`: runner
   template with SHA-256 check, light image, both launchers enabled). Prints names and statuses only.
2. Box hub (mahanfilms, no root): `bash scripts/ops/ci_box/jit_pool/install_user.sh`
   (timer + `~/.config/roxira-jit/jit_pool.toml`, `dry_run = true`).
3. Box hub: `bash scripts/ops/ci_box/jit_pool/seed_playwright.sh` (Chromium for the Playwright jobs;
   the browser CDN is blocked from this network for `runner`, so `mahanfilms` fetches it through its
   proxy into `/srv/data/ci-jit/ms-playwright`; re-run after each Playwright upgrade).
4. `python3 ~/roxira-jit/jit_pool.py --status` shows both launchers `alive`; set `dry_run = false`.
5. Point the picker at the slots (box mode only; nothing changes for `hosted`):
   `gh variable set CI_BOX_LABELS_LIGHT -b '["self-hosted","jit","slot-light"]' -R Mahan-film/roxira-platform`
   `gh variable set CI_BOX_LABELS_DOCKER -b '["self-hosted","jit","slot-docker"]' -R Mahan-film/roxira-platform`
6. Two real runs: `gh workflow run ci.yml -R Mahan-film/roxira-platform --ref <branch> -f runner=box`
   on two PR branches; both green, with job runner names `jit-light-*` / `jit-docker-*` and
   different container ids in the launcher log (`journalctl --user -u roxira-jit@light` as runner,
   or `sudo box-status`).
7. Fallback test: `touch ~/.config/roxira-jit/HOLD` (or stop a launcher); with
   `CI_RUNNER_MODE=auto`, the next CI run shows "Runner: hosted (auto ...)" in its summary and
   finishes on GitHub-hosted runners. `rm ~/.config/roxira-jit/HOLD` to resume.
8. Retire the old runner after the two green runs: `touch /srv/data/ci-jit/control/retire-old-runner`
   (the runner's own launcher disables `actions-runner.service`), then delete its registration:
   `gh api -X DELETE repos/Mahan-film/roxira-platform/actions/runners/<id of roxira-ci>`.

## Operate

| Want | Do (as mahanfilms) |
|---|---|
| status | `python3 ~/roxira-jit/jit_pool.py --status` |
| hold new CI jobs (load shedding) | `touch ~/.config/roxira-jit/HOLD` (remove to resume) |
| stop the controller | `touch ~/.config/roxira-jit/STOP` |
| all CI back to hosted at once | `gh variable set CI_RUNNER_MODE -b hosted -R Mahan-film/roxira-platform` |
| logs | `journalctl --user -u roxira-jit-pool -n 50` |

The runner template follows the old runner's version (`runner_setup.sh`); re-run it as `runner`
after a runner upgrade. GitHub only accepts runners within a few releases of the latest, so refresh
it at least monthly (Sunday maintenance).

## Revert

1. `gh variable set CI_RUNNER_MODE -b hosted -R Mahan-film/roxira-platform` (CI is hosted again at once).
2. mahanfilms: `systemctl --user disable --now roxira-jit-pool.timer`.
3. Owner: `sudo runuser -u runner -- env XDG_RUNTIME_DIR=/run/user/$(id -u runner) systemctl --user disable --now roxira-jit@light roxira-jit@docker`,
   `sudo systemctl revert user@$(id -u runner).service` (removes the cap),
   `sudo rm -rf /usr/local/lib/roxira-jit /srv/data/ci-jit`.
4. If the old runner was retired: as `runner`, `systemctl --user enable --now actions-runner` and
   re-register it with `11_runner_register.sh`.

## Not covered yet

- A job in the `docker` slot can reach the rootless Docker socket and everything user `runner`
  owns; that is accepted because only collaborators' branches reach the box (fork PRs stay hosted,
  external contributors need approval). A throwaway VM per job (R20 review) is the next step if
  outside contributors ever push.
- The controller holds jobs on `HOLD`; the automatic load-shedding trigger belongs to `roxira-orch`
  (#1021).
