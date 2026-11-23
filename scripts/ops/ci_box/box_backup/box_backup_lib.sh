#!/bin/bash
# Shared helpers for box_backup.sh and restore_drill.sh (sourced, never executed). User level, no root.
# Config is PARSED (never sourced): only the keys below are accepted, one KEY=VALUE per line.

CFG_FILE="${BOX_BACKUP_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/roxira-box-backup/backup.conf}"
CFG_DIR="$(dirname "$CFG_FILE")"
STATE="${BOX_BACKUP_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/roxira-box}"
WORK="${BOX_BACKUP_WORK_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/roxira-box-backup}"

PHONE_DIR="${BOX_BACKUP_PHONE_DIR:-/usr/local/lib/phone-stack}"   # root-owned, world-readable phone stack config
EXPORT_DIR="${BOX_BACKUP_EXPORT_DIR:-/srv/data/github-export}"

# Defaults (owner overrides in backup.conf).
REPOSITORY=/srv/data/backups/box-user         # restic repo on the data disk (local path)
PASSWORD_FILE="$CFG_DIR/restic.pass"          # mode 600, supplied by the owner, never in git
OFFBOX_REPOSITORY=""                          # empty = no off-box copy. Path or s3:/b2:/sftp:/rest: URL
OFFBOX_PASSWORD_FILE=""                       # empty = same as PASSWORD_FILE
OFFBOX_ENV_FILE="$CFG_DIR/offbox.env"         # mode 600: AWS_*/B2_* credentials for the off-box repo
PROXY=""                                      # HTTP proxy for off-box traffic (empty = inherit env)
EXTRA_PATHS=""                                # extra files/dirs, space separated (secret filter still applies)
INCLUDE_EXPORT_MANIFEST=1                     # latest github-export MANIFEST.txt (status page data)

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

load_conf() {
  [ -f "$CFG_FILE" ] || return 0
  local line k v
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    k=${line%%=*}; v=${line#*=}
    k=${k//[[:space:]]/}
    v=${v#"${v%%[![:space:]]*}"}; v=${v%"${v##*[![:space:]]}"}
    case "$v" in \"*\") v=${v#\"}; v=${v%\"} ;; \'*\') v=${v#\'}; v=${v%\'} ;; esac
    case "$k" in
      REPOSITORY|PASSWORD_FILE|OFFBOX_REPOSITORY|OFFBOX_PASSWORD_FILE|OFFBOX_ENV_FILE|PROXY|EXTRA_PATHS|INCLUDE_EXPORT_MANIFEST)
        v=${v//\~/$HOME}; printf -v "$k" '%s' "$v" ;;
      *) echo "WARN: unknown key '$k' in $CFG_FILE ignored" >&2 ;;
    esac
  done < "$CFG_FILE"
  [ -n "$OFFBOX_PASSWORD_FILE" ] || OFFBOX_PASSWORD_FILE="$PASSWORD_FILE"
  return 0
}

# is_remote URL: true for s3:/b2:/sftp:/rest:/rclone:/azure:/gs:/swift: style URLs, false for local paths.
is_remote() { case "$1" in s3:*|b2:*|sftp:*|rest:*|rclone:*|azure:*|gs:*|swift:*) return 0 ;; *) return 1 ;; esac; }

# file_mode FILE -> octal permission bits (e.g. 600).
file_mode() { stat -c '%a' "$1"; }

# secret_file_ok FILE: exists, non-empty, no group/other access.
secret_file_ok() {
  [ -f "$1" ] && [ -s "$1" ] || return 1
  case "$(file_mode "$1")" in 600|400) return 0 ;; *) return 1 ;; esac
}

# Fixed source allowlist. Everything is $HOME-relative or a root-owned world-readable config dir.
# Paths that do not exist are skipped silently. Secrets are excluded by design (see find filters in
# list_files and the content scan in secret_scan.py).
src_files() {
  cat <<EOF
$HOME/.config/roxira-lane/lane-run.conf
$HOME/.config/roxira-merge-gate/merge_gate.toml
$HOME/.config/roxira-bridge/bridge.toml
$HOME/.config/roxira-jit/jit_pool.toml
$HOME/.local/state/roxira-merge-gate/state.json
$HOME/.local/state/roxira-merge-gate/last_main_sha
$HOME/.local/share/roxira-bridge/bridge.py
$HOME/.local/bin/box-backup-status
$PHONE_DIR/phone-stack.conf
$PHONE_DIR/healthcheck.sh
$PHONE_DIR/models.yaml
EOF
}
src_dirs() {
  cat <<EOF
$HOME/.config/systemd/user
$HOME/.local/state/roxira-lane/logs
$HOME/.local/state/roxira-box
$HOME/.local/state/roxira-bridge
$HOME/.local/state/roxira-jit
$HOME/.local/state/roxira-status
$HOME/.local/share/roxira-status/www
EOF
}

# list_files: NUL-separated list of regular files to back up on stdout. Name-based secret and noise
# filters apply to directory walks AND explicit files.
list_files() {
  local d f
  local -a prune=( -name node_modules -o -name __pycache__ -o -name .cache -o -name .git -o -name '*.git' -o -name worktrees )
  local -a deny=( -iname '*.env' -o -iname 'env' -o -iname '.env*' -o -iname '*.pass' -o -iname '*.key' -o -iname '*.pem'
    -o -iname '*.p12' -o -iname 'id_*' -o -iname '*token*' -o -iname '*secret*' -o -iname '*credential*'
    -o -iname 'auth.json' -o -iname 'hosts.yml' -o -iname '.npmrc' -o -iname '*.kdbx' )
  while IFS= read -r d; do
    [ -d "$d" ] && [ -r "$d" ] || continue
    find "$d" \( "${prune[@]}" \) -prune -o -type f -size -20M ! \( "${deny[@]}" \) -print0 2>/dev/null
  done < <(src_dirs; for f in $EXTRA_PATHS; do [ -d "$f" ] && echo "$f"; done)
  while IFS= read -r f; do
    [ -f "$f" ] && [ -r "$f" ] || continue
    case "$(basename "$f" | tr 'A-Z' 'a-z')" in
      *.env|env|.env*|*.pass|*.key|*.pem|*.p12|id_*|*token*|*secret*|*credential*|auth.json|hosts.yml|.npmrc|*.kdbx) continue ;;
    esac
    printf '%s\0' "$f"
  done < <(src_files; for f in $EXTRA_PATHS; do [ -f "$f" ] && echo "$f"; done
           if [ "${INCLUDE_EXPORT_MANIFEST:-1}" = 1 ]; then
             local l; l=$(find "$EXPORT_DIR" -maxdepth 1 -mindepth 1 -type d -name '20??-??-??' 2>/dev/null | sort | tail -1)
             [ -n "$l" ] && echo "$l/MANIFEST.txt"
           fi)
}

# Marker for the status page: "<OK|FAIL|SKIP> <ISO time> [note]" in $STATE/backup.last (same format as mirror.last).
write_marker() { # status note
  mkdir -p "$STATE"
  printf '%s %s%s\n' "$1" "$(stamp)" "${2:+ $2}" > "$STATE/backup.last"
}

# load_offbox_env: export the allowlisted credential variables from OFFBOX_ENV_FILE (parsed, never sourced) and the
# proxy. Returns 1 with a message on stderr when the file is missing or readable by others.
load_offbox_env() {
  [ -z "$PROXY" ] || export HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY"
  [ -f "$OFFBOX_ENV_FILE" ] || { echo "no credentials file $OFFBOX_ENV_FILE for the remote repository" >&2; return 1; }
  secret_file_ok "$OFFBOX_ENV_FILE" || { echo "$OFFBOX_ENV_FILE must be non-empty and mode 600" >&2; return 1; }
  local line k v
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    k=${line%%=*}; v=${line#*=}; v=${v#\"}; v=${v%\"}
    case "$k" in AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_DEFAULT_REGION|B2_ACCOUNT_ID|B2_ACCOUNT_KEY|RCLONE_*|ST_*|OS_*)
      export "$k=$v" ;; esac
  done < "$OFFBOX_ENV_FILE"
}
