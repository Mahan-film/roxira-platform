#!/usr/bin/env bash
# One line a day on the tracking issue: item counts, text backlog, sizes. Counts only, nothing else.
set -euo pipefail
issue="${SOURCE_WATCHER_REPORT_ISSUE:-592}"
line="$(/usr/bin/python3 "$HOME/.local/share/roxira-source-watcher/source_watcher.py" status --line)"
gh issue comment "$issue" --repo Mahan-film/roxira-platform --body "R22 watcher: $line"
