#!/usr/bin/env bash
# Prints the owner commands to install the tech radar timers on the production server.
# It changes NOTHING and runs nothing: copy the printed block into an SSH session
# (AGENTS.md: ask the owner before changing files on 5.75.200.67).
set -euo pipefail
cat <<'CMDS'
# 1. On the Mac: make sure the PR with the radar is merged, then on the server:
ssh 5.75.200.67
cd /opt/roxira_platform && git pull --ff-only

# 2. Optional env file (only needed for a GitHub token or to turn issue creation off):
#    install -m 600 /dev/null /etc/roxira/radar.env
#    echo 'GITHUB_TOKEN=...'      >> /etc/roxira/radar.env   # read-only public access is enough
#    echo 'RADAR_GH_ISSUES=0'     >> /etc/roxira/radar.env   # default is 1: opens issues if `gh` is authenticated

# 3. Dry run (prints the ranking, writes and e-mails nothing, no LLM, costs 0):
python3 scripts/ops/radar/radar.py --mode weekly --dry-run --no-llm

# 4. Install and start the timers:
cp deploy/systemd/roxira-radar.service deploy/systemd/roxira-radar.timer \
   deploy/systemd/roxira-radar-daily.service deploy/systemd/roxira-radar-daily.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roxira-radar.timer roxira-radar-daily.timer
systemctl list-timers 'roxira-radar*'

# 5. First real run now (weekly; uses at most 0.05 USD of OpenRouter), then read the result:
systemctl start roxira-radar.service
journalctl -u roxira-radar.service -n 20 --no-pager
ls -t /var/lib/roxira-radar/reports/REPORT_*.md | head -1

# 6. The old canned sentinel unit/timer had the same names (roxira-radar.*), so step 4 replaced them.

# Remove everything:
systemctl disable --now roxira-radar.timer roxira-radar-daily.timer
rm /etc/systemd/system/roxira-radar{,-daily}.{service,timer} && systemctl daemon-reload
CMDS
