#!/bin/bash
# roxira-ci user setup, part 7 (R20-3, #1019): nightly bare mirror and weekly GitHub JSON export.
# Run as user mahanfilms, NO sudo:   bash scripts/ops/ci_box/07_user_mirror_export.sh [--dry-run]
# Installs (all under the user's home, idempotent, safe to re-run):
#   ~/.local/lib/roxira-box/{box-mirror.sh,box-github-export.sh}   the jobs
#   ~/.local/bin/box-backup-status                                 read-only report (no secrets)
#   ~/.config/systemd/user/roxira-mirror.{service,timer}           nightly 02:30
#   ~/.config/systemd/user/roxira-gh-export.{service,timer}        weekly Sunday 03:30
# Data: /srv/data/mirror/roxira-platform.git, /srv/data/github-export/<date>/ (last 8 kept).
# All traffic goes through the local HTTP proxy. GitHub auth is the existing gh login (no token in files).
# Revert: systemctl --user disable --now roxira-mirror.timer roxira-gh-export.timer; rm the files above.
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

PROXY="${ROXIRA_PROXY:-http://127.0.0.1:10809}"
LIB="$HOME/.local/lib/roxira-box"
BIN="$HOME/.local/bin"
UNITS="$HOME/.config/systemd/user"

say() { echo "== $*"; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

# put FILE MODE  (content on stdin): write only when different.
put() {
  local f="$1" mode="$2" tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/roxira.XXXXXX")
  cat > "$tmp"
  if [ -f "$f" ] && cmp -s "$tmp" "$f"; then
    echo "unchanged: $f"
  elif [ "$DRY" = 1 ]; then
    echo "[dry-run] would write $f (mode $mode)"
  else
    mkdir -p "$(dirname "$f")"
    install -m "$mode" "$tmp" "$f"
    echo "wrote: $f"
  fi
  rm -f "$tmp"
}

if [ "$DRY" = 0 ] && [ "$(id -u)" -eq 0 ]; then
  echo "run as mahanfilms, not root"; exit 1
fi

say "data directories under /srv/data"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] would create /srv/data/mirror and /srv/data/github-export (mode 750, owner $(id -un))"
elif [ -w /srv/data/mirror ] && [ -w /srv/data/github-export ] 2>/dev/null; then
  echo "present"
elif [ -w /srv/data ]; then
  mkdir -p /srv/data/mirror /srv/data/github-export; chmod 750 /srv/data/mirror /srv/data/github-export
else
  echo "/srv/data is not writable for $(id -un). Owner step (once, with sudo):"
  echo "  sudo install -d -m 750 -o $(id -un) -g $(id -gn) /srv/data/mirror /srv/data/github-export"
  echo "then re-run this script."; exit 1
fi

say "job: box-mirror.sh"
put "$LIB/box-mirror.sh" 755 <<'JOB'
#!/bin/bash
# Nightly: git clone --mirror on first run, git remote update --prune afterwards.
set -euo pipefail
DEST="${MIRROR_DIR:-/srv/data/mirror/roxira-platform.git}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/roxira-box"
mkdir -p "$STATE" "$(dirname "$DEST")"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
fail() { echo "$(stamp) FAIL $1" | tee -a "$STATE/mirror.log" >&2; echo "FAIL $(stamp)" > "$STATE/mirror.last"; exit 1; }
export GIT_TERMINAL_PROMPT=0
GIT=(git -c credential.helper= -c 'credential.helper=!gh auth git-credential')
if [ ! -d "$DEST" ]; then
  tmp="$DEST.partial"; rm -rf "$tmp"
  "${GIT[@]}" clone --mirror -q "https://github.com/$REPO.git" "$tmp" || fail "clone"
  mv "$tmp" "$DEST"
  echo "$(stamp) cloned" >> "$STATE/mirror.log"
else
  "${GIT[@]}" -C "$DEST" remote update --prune -q || fail "remote update"
fi
git -C "$DEST" for-each-ref --count=1 >/dev/null || fail "empty mirror"
head=$(git -C "$DEST" log -1 --format=%cI --all 2>/dev/null || echo unknown)
size=$(du -sh "$DEST" | cut -f1)
echo "$(stamp) OK newest-commit=$head size=$size" | tee -a "$STATE/mirror.log"
echo "OK $(stamp)" > "$STATE/mirror.last"
JOB

say "job: box-github-export.sh"
put "$LIB/box-github-export.sh" 755 <<'JOB'
#!/bin/bash
# Weekly: issues (incl. PR stubs), pulls, comments, review comments, labels, milestones as JSON.
# Pages are flattened into one JSON array per file. Keeps the newest 8 dated directories.
set -euo pipefail
ROOT="${EXPORT_DIR:-/srv/data/github-export}"
KEEP=8
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/roxira-box"
mkdir -p "$STATE" "$ROOT"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
day=$(date -u +%Y-%m-%d)
tmp="$ROOT/.partial-$day"; rm -rf "$tmp"; mkdir -p "$tmp"
fail() { echo "$(stamp) FAIL $1" | tee -a "$STATE/export.log" >&2; echo "FAIL $(stamp)" > "$STATE/export.last"; rm -rf "$tmp"; exit 1; }

export_one() { # name endpoint
  gh api --paginate --slurp "repos/$REPO/$2" > "$tmp/$1.pages" || fail "gh api $1"
  python3 -I - "$tmp/$1.pages" "$tmp/$1.json" <<'PY' || fail "flatten $1"
import json, sys
pages = json.load(open(sys.argv[1]))
flat = [x for p in pages for x in (p if isinstance(p, list) else [p])]
json.dump(flat, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
print(len(flat))
PY
  rm -f "$tmp/$1.pages"
}
: > "$tmp/counts.txt"
for pair in "issues:issues?state=all&per_page=100" \
            "pulls:pulls?state=all&per_page=100" \
            "issue-comments:issues/comments?per_page=100" \
            "pull-review-comments:pulls/comments?per_page=100" \
            "labels:labels?per_page=100" \
            "milestones:milestones?state=all&per_page=100"; do
  name=${pair%%:*}; ep=${pair#*:}
  n=$(export_one "$name" "$ep")
  echo "$name $n" >> "$tmp/counts.txt"
done
{ echo "repo=$REPO"; echo "exported_at=$(stamp)"; cat "$tmp/counts.txt"; } > "$tmp/MANIFEST.txt"
rm -f "$tmp/counts.txt"
rm -rf "${ROOT:?}/$day"; mv "$tmp" "$ROOT/$day"
# keep the newest $KEEP dated directories
find "$ROOT" -maxdepth 1 -mindepth 1 -type d -name '20??-??-??' | sort | head -n -"$KEEP" | while read -r d; do rm -rf "${d:?}"; done
size=$(du -sh "$ROOT/$day" | cut -f1)
echo "$(stamp) OK dir=$ROOT/$day size=$size" | tee -a "$STATE/export.log"
echo "OK $(stamp)" > "$STATE/export.last"
JOB

say "report: box-backup-status (read-only, no secrets)"
put "$BIN/box-backup-status" 755 <<'JOB'
#!/bin/bash
# box-backup-status: mirror and export health for roxira-ci. Read-only. Run as mahanfilms.
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/roxira-box"
MIRROR=/srv/data/mirror/roxira-platform.git
EXPORT=/srv/data/github-export
echo "== mirror"
printf 'last run:     %s\n' "$(cat "$STATE/mirror.last" 2>/dev/null || echo never)"
[ -d "$MIRROR" ] && printf 'newest commit: %s\nrefs:          %s\nsize:          %s\n' \
  "$(git -C "$MIRROR" log -1 --format=%cI --all 2>/dev/null)" \
  "$(git -C "$MIRROR" for-each-ref | wc -l)" "$(du -sh "$MIRROR" | cut -f1)"
echo "== github export"
printf 'last run:     %s\n' "$(cat "$STATE/export.last" 2>/dev/null || echo never)"
latest=$(find "$EXPORT" -maxdepth 1 -mindepth 1 -type d -name '20??-??-??' 2>/dev/null | sort | tail -1)
if [ -n "$latest" ]; then
  echo "latest:       $latest"; sed -n '3,$p' "$latest/MANIFEST.txt" | sed 's/^/  /'
  printf 'kept dirs:    %s\n' "$(find "$EXPORT" -maxdepth 1 -mindepth 1 -type d -name '20??-??-??' | wc -l)"
fi
echo "== disk"
du -sh "$MIRROR" "$EXPORT" 2>/dev/null
df -h /srv/data 2>/dev/null | tail -1
echo "== timers"
systemctl --user list-timers 'roxira-*' --no-pager 2>/dev/null | head -5 || true
if [ -x /usr/local/bin/box-reliability-status ]; then
  echo; /usr/local/bin/box-reliability-status
fi
JOB

say "systemd --user units"
put "$UNITS/roxira-mirror.service" 644 <<UNIT
[Unit]
Description=Nightly git mirror of the GitHub repo (R20-3)
After=network-online.target
[Service]
Type=oneshot
Environment=HTTPS_PROXY=$PROXY
Environment=HTTP_PROXY=$PROXY
Environment=NO_PROXY=localhost,127.0.0.1
ExecStart=$LIB/box-mirror.sh
TimeoutStartSec=3h
UNIT
put "$UNITS/roxira-mirror.timer" 644 <<'UNIT'
[Unit]
Description=Nightly git mirror
[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=10min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
put "$UNITS/roxira-gh-export.service" 644 <<UNIT
[Unit]
Description=Weekly GitHub issues/PR JSON export (R20-3)
After=network-online.target
[Service]
Type=oneshot
Environment=HTTPS_PROXY=$PROXY
Environment=HTTP_PROXY=$PROXY
Environment=NO_PROXY=localhost,127.0.0.1
ExecStart=$LIB/box-github-export.sh
TimeoutStartSec=3h
UNIT
put "$UNITS/roxira-gh-export.timer" 644 <<'UNIT'
[Unit]
Description=Weekly GitHub export
[Timer]
OnCalendar=Sun *-*-* 03:30:00
RandomizedDelaySec=10min
Persistent=true
[Install]
WantedBy=timers.target
UNIT

say "enable timers"
run systemctl --user daemon-reload
run systemctl --user enable --now roxira-mirror.timer roxira-gh-export.timer

say "linger check"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] would check: loginctl show-user $(id -un) -p Linger"
elif [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = "yes" ]; then
  echo "linger already enabled"
else
  echo "OWNER STEP (once, with sudo), so the timers run without a login session:"
  echo "  sudo loginctl enable-linger $(id -un)"
fi
echo
echo "First run now (optional): systemctl --user start roxira-mirror.service && box-backup-status"
echo "SETUP7 DONE"
