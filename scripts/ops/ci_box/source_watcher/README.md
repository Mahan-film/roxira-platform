# Source watcher (R22 pilot)

Polite, public-only watcher for Iranian legal sources and Setad listings. Design: `docs/research/R22_SOURCE_WATCHER.md`.
Code: `scripts/legal/source_watcher.py`; sources: `config/source_watcher.json`; tests: `scripts/legal/tests/test_source_watcher.py`.

- Dry-run first: the timer runs `run` with no flags, so it only fetches, classifies, diffs and writes a report under
  `~/.local/state/roxira-source-watcher/reports/`. `--commit` (set in the env file) also updates the SQLite state and
  appends staged rows to `staged/watcher_<date>.jsonl` (status `proposed`, `needs_review`). Nothing is published to git here.
- Hard rules: honest UA, robots.txt honoured, >= 3 s per host, request budget per run, no logins, no CAPTCHA/challenge
  solving, TLS verification never disabled (a host may pin a CA via `ca_file`), proxy environment never bypassed.
- A challenge, WAF block, parked domain, login redirect or TLS error marks the host non-ok and nothing is parsed from it.
- Install (as the box user): `bash scripts/ops/ci_box/source_watcher/install_user.sh`. Kill switch: `touch ~/.config/roxira-source-watcher/STOP`.
- Outside the night window (00:30-04:30); `Nice`, `CPUWeight` and `MemoryMax` keep it behind the phone stack and CI.
