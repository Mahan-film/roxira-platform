# Weekly mutation testing (legal data scripts)

Mutation testing answers a question line coverage cannot: **if a bug is injected into this
code, does its test file actually fail?** A mutant that the tests do not catch ("survivor")
marks either a gap in the tests or code the tests never exercise. This job is report-only —
it never changes product code and never blocks CI.

It runs [mutmut](https://mutmut.readthedocs.io/) 3 on three legal data scripts, each against
its own test file only:

| module | tests |
| --- | --- |
| `scripts/legal/iran_relay.py` | `scripts/legal/tests/test_iran_relay.py` |
| `scripts/legal/split_rc_law_articles.py` | `scripts/legal/tests/test_split_rc_law_articles.py` |
| `scripts/legal/ingest_regulations.py` | `scripts/legal/tests/test_regulations_relay.py` |

Everything runs in a throwaway `git worktree` of `origin/main` under
`/var/lib/roxira-mutation/wt` (never in the live checkout); the worktree and mutmut's cache
are removed on exit. mutmut itself lives in a private venv at
`/var/lib/roxira-mutation/venv` (`mutmut>=3,<4`), installed on the first run.

## Where the result goes

The run appends one block per module to `/root/deploy-state/mutation-last.txt`:

```
=== mutation weekly 2026-10-19T02:00:11Z ===
platform=/opt/roxira_platform base=origin/main

=== scripts/legal/iran_relay.py ===
tests: scripts/legal/tests/test_iran_relay.py
killed=57 survived=4 timeout=0
surviving mutants (first 10):
  scripts/legal/iran_relay.py:212
  scripts/legal/iran_relay.py:341
  ...
```

* **killed** — a mutant that made at least one test fail. Good: the tests caught it.
* **survived** — no test failed. Investigate: either a missing assertion or dead/untested code.
* **timeout** — the mutated code hung (e.g. a loop bound flipped); also a catch, but check it
  is not a flaky slow test.

If `scripts/ops/notify/notify.py` exists, the same run sends a 3-line summary (one line per
module) through it.

## How to read survivors

1. Open the module at the reported `file:line` and look at the mutated expression. mutmut only
   mutates covered lines, so a survivor means the line ran but no test asserted on the result.
2. Ask: is this a real gap? Typical fixes are a stronger assertion in the matching test file,
   or deleting genuinely dead code. Do **not** add a test that only pins the mutated constant
   just to raise the score.
3. Re-run the job by hand (below) and confirm the survivor is gone.

Survivors are a backlog, not a gate: a rising count is a signal to review the tests, not a
reason to block a merge.

## Run it once by hand

```bash
# On the production server (needs network for the first-run pip install):
bash /opt/roxira_platform/scripts/dev/mutation_weekly.sh
# read the result
cat /root/deploy-state/mutation-last.txt
```

On a workstation, point it at a checkout and a writable state dir:

```bash
ROXIRA_PLATFORM=/path/to/roxira_platform \
ROXIRA_MUTATION_DIR=/tmp/roxira-mutation \
ROXIRA_MUTATION_STATE=/tmp/roxira-mutation \
bash scripts/dev/mutation_weekly.sh
```

The whole run is wrapped in `timeout 45m`, so a hung run still leaves the summary of the
modules that finished. To run a single module manually without the wrapper, use mutmut
directly in a scratch worktree:

```bash
git -C /opt/roxira_platform worktree add --detach /tmp/mut-wt origin/main
cd /tmp/mut-wt
cat > setup.cfg <<'CFG'
[mutmut]
paths_to_mutate=scripts/legal/iran_relay.py
tests_dir=scripts/legal/tests/test_iran_relay.py
also_copy=
    scripts/legal
CFG
/var/lib/roxira-mutation/venv/bin/mutmut run
/var/lib/roxira-mutation/venv/bin/mutmut results
/var/lib/roxira-mutation/venv/bin/mutmut results survived
git -C /opt/roxira_platform worktree remove --force /tmp/mut-wt
```

`also_copy=scripts/legal` matters: the tests load their module and fixtures by absolute path
from the repo root, so the whole `scripts/legal` tree must be copied into mutmut's
`mutants/` directory.

## Install the weekly timer

`scripts/dev/mutation_install.sh` writes `roxira-mutation-weekly.service` and
`roxira-mutation-weekly.timer` (Sunday 02:00 UTC, `Nice=10`, `CPUQuota=150%`). It is a dry
run unless you pass `--apply`:

```bash
bash scripts/dev/mutation_install.sh            # print the plan and the unit files
sudo bash scripts/dev/mutation_install.sh --apply
systemctl list-timers 'roxira-mutation*'
journalctl -u roxira-mutation-weekly.service
```
