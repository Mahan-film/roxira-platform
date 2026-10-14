# Server-side auto-deploy (`scripts/ops/autodeploy/`)

Owner decision 2026-10-14: deployments must be fully automatic on the server, with
no commands to type. A systemd timer runs on the production host (repo
`/opt/roxira_platform`, as root) and deploys every new `origin/main` commit using
the SAME safety as the owner-run flow in `scripts/ops/deploy_local.sh`.

## What it does

Every 5 minutes `roxira-autodeploy.timer` runs `autodeploy.sh`, which:

1. takes a lock (`/run/roxira-autodeploy.lock`) so runs never overlap;
2. exits quietly if `/etc/roxira/autodeploy.enabled` is missing (not opted in) or
   `/opt/roxira_platform/.deploy-freeze` exists (paused);
3. `git fetch`es `origin/main`; if it equals the deployed `HEAD`, exits 0;
4. skips a SHA listed in `/root/deploy-state/autodeploy-failed-shas` (a failed SHA
   is never retried; a newer commit starts a fresh attempt);
5. copies `scripts/ops/deploy_local.sh` **from the target commit** into a temp file
   (exactly like the owner flow), then runs it with `DEPLOY_SSH_HOST=local`;
6. if the diff touches `output_apps/enterprise_hub/migrations/`, runs
   `migrate --yes` first (that takes a `pg_dump` backup before touching the DB); a
   failed migration is recorded and the deploy does NOT run;
7. runs `deploy --yes`, which smoke-tests and rolls back automatically on failure.

Because it runs `deploy_local.sh` with `DEPLOY_SSH_HOST=local`, `rsh()` runs commands
on the server with `bash -c` instead of `ssh`, and the confirmation is answered from
`DEPLOY_AUTO_CONFIRM` — but only as root on the server with the opt-in marker present.
Nothing about the owner's typed flow changes.

## Install / enable (once, on the server, as root)

```bash
scripts/ops/autodeploy/install.sh          # dry-run: prints the plan
scripts/ops/autodeploy/install.sh --yes     # install units, create the marker, enable the timer
```

That copies `roxira-autodeploy.{service,timer}` to `/etc/systemd/system`, creates
`/etc/roxira/autodeploy.enabled`, `mkdir -p /var/log/roxira-autodeploy`,
`systemctl daemon-reload` and `systemctl enable --now roxira-autodeploy.timer`.

## Pause / disable

- Pause (keeps it installed): `touch /opt/roxira_platform/.deploy-freeze`; remove it
  to resume. The same file is honoured by every other deploy path.
- Disable: `scripts/ops/autodeploy/install.sh --disable` — removes the opt-in marker
  and disables the timer. Re-enable with `--yes`.

## Status and logs

- `/root/deploy-state/autodeploy-last.json` — every run writes
  `{"time","target","deployed_before","migrated","result":"ok|failed|skipped","log"}`.
- `/var/log/roxira-autodeploy/<time>.log` — full output of each run; the newest 50 are
  kept. Also visible with `journalctl -u roxira-autodeploy.service`.
- `/root/deploy-state/autodeploy-failed-shas` — SHAs that failed, never auto-retried.

Useful checks on the server:

```bash
systemctl list-timers 'roxira-autodeploy*'
cat /root/deploy-state/autodeploy-last.json
journalctl -u roxira-autodeploy.service -n 50 --no-pager
```

## Safety gates (all inherited from `deploy_local.sh`)

- Freeze file (local/server) blocks deploy and rollback.
- Clean server working tree required; deploy refuses otherwise.
- Required env NAME check (values never printed).
- Migration files in the diff are applied by `migrate` (with a `pg_dump` backup) and
  verified; a failed or unverified migration records the SHA and aborts.
- Smoke tests run from the server; any failure triggers automatic rollback.
- A failed SHA is written to `autodeploy-failed-shas` so the timer does not retry it.

## Manual fallback

The owner-run path still exists and is unchanged:
`scripts/ops/deploy_local.sh deploy --yes` and `migrate --yes` (see
`docs/ops/DEPLOY_LOCAL.md`). Install the units by hand if the installer cannot run.
