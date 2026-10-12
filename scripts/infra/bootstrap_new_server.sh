#!/usr/bin/env bash
# Roxira host bootstrap for a FRESH Ubuntu 24.04 / Debian 12+ server (aarch64 or x86_64).
# The single bootstrap script (replaces scripts/ops/bootstrap_new_server.sh, which is now a stub).
# Idempotent: safe to re-run. By default it prepares the HOST only; restore is opt-in (--restore).
#
#   sudo bootstrap_new_server.sh [--dry-run] [options]
#
# Steps (each is skipped when already in place). Risky ones run LAST so a failure never leaves a half-locked host:
#   1  base packages, NTP
#   2  admin user (sudo, key-only) -- refuses to continue if no SSH public key is available
#   3  ufw: default deny in / allow out, allow 22/tcp (+ 80,443/tcp). Rules for 8443, 2053, 2096 and
#      60000:61000/udp are never added, changed or removed (opt in with --extra-tcp-ports; the restored
#      /etc/ufw brings the old host's rules back)
#   4  fail2ban (sshd jail, validated with fail2ban-client -t; a failure here is a WARNING, not fatal)
#      + unattended-upgrades (security only, no auto-reboot)
#   5  Docker Engine + compose plugin from the official apt repo (key fingerprint checked), log rotation
#   6  swap file when RAM <= 9 GiB and there is no swap
#   7  /etc/roxira (0700) and state dirs; tightens modes of existing files in /etc/roxira to 0600
#   8  repo clone (with --clone-repo/--restore) and the systemd units from deploy/systemd
#   9  optional restore (--restore): scripts/ops/backup/restore.sh --full, cron held for review, certbot dry run
#  10  sshd hardening (keys only) -- LAST, and only with --i-have-key-access (see below)
#
# Options:
#   --dry-run              print every action, change nothing (works without root)
#   --i-have-key-access    REQUIRED to change sshd. Means: "I logged in with an SSH key, I have a second terminal
#                          open and I tested key login for root and the admin user". Without it step 10 is skipped.
#   --admin-user NAME      admin account to create (default: roxira; env BOOTSTRAP_ADMIN_USER)
#   --admin-key-file FILE  public key(s) for the admin user (default: copy root's authorized_keys)
#   --repo-dir DIR         repo checkout holding deploy/systemd (default: /opt/roxira_platform, else this repo)
#   --clone-repo           git clone $BOOTSTRAP_REPO_URL to /opt/roxira_platform when absent (needs a deploy key)
#   --restore              clone + restore.sh --full --yes + cron held + certbot dry run (needs /etc/roxira/backup.env + restic.pass)
#   --skip-restore         explicit no-op (kept for the old script's callers)
#   --restore-repo NAME    restic repo for --restore: sftp|s3|local (default sftp; old flag name --repo also works)
#   --restore-ssh-keys     before the clone, merge /root/.ssh from the latest backup (never overwrites existing files)
#   --extra-tcp-ports "A B"  ufw allow for these ports (opt-in; env BOOTSTRAP_EXTRA_TCP_PORTS)
#   --swap-gb N | --no-swap  swap size in GiB (default 4 when RAM <= 9 GiB, otherwise none) / never create swap
#   --no-http              do not open 80/443 in ufw
#   --enable-timers        enable the backup/monitor/selfimprove/docker-prune timers (NOT cf-refresh)
#   --skip-docker          skip step 5
#
# Secrets: this script never reads, prints or writes a secret value. Key material is only counted.
# Not run by CI. Review with:  bash -n bootstrap_new_server.sh && shellcheck bootstrap_new_server.sh
set -euo pipefail

DRY_RUN=0
KEY_ACCESS=0
ADMIN_USER="${BOOTSTRAP_ADMIN_USER:-roxira}"
ADMIN_KEY_FILE=""
REPO_DIR=""
REPO_URL="${BOOTSTRAP_REPO_URL:-git@github.com:Mahan-film/roxira-platform.git}"
CLONE_REPO=0
RESTORE=0
RESTORE_REPO="sftp"
RESTORE_SSH_KEYS=0
EXTRA_PORTS="${BOOTSTRAP_EXTRA_TCP_PORTS:-}"
SWAP_GB=""
NO_SWAP=0
OPEN_HTTP=1
ENABLE_TIMERS=0
SKIP_DOCKER=0
APP_DIR=/opt/roxira_platform

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --i-have-key-access) KEY_ACCESS=1; shift ;;
    --admin-user) ADMIN_USER="${2:?--admin-user needs a name}"; shift 2 ;;
    --admin-key-file) ADMIN_KEY_FILE="${2:?--admin-key-file needs a path}"; shift 2 ;;
    --repo-dir) REPO_DIR="${2:?--repo-dir needs a path}"; shift 2 ;;
    --clone-repo) CLONE_REPO=1; shift ;;
    --restore) RESTORE=1; CLONE_REPO=1; shift ;;
    --skip-restore) RESTORE=0; shift ;;
    --restore-repo | --repo) RESTORE_REPO="${2:?--restore-repo needs sftp|s3|local}"; shift 2 ;;
    --restore-ssh-keys) RESTORE_SSH_KEYS=1; shift ;;
    --extra-tcp-ports) EXTRA_PORTS="${2:?--extra-tcp-ports needs a quoted list}"; shift 2 ;;
    --swap-gb) SWAP_GB="${2:?--swap-gb needs a number}"; shift 2 ;;
    --no-swap) NO_SWAP=1; shift ;;
    --no-http) OPEN_HTTP=0; shift ;;
    --enable-timers) ENABLE_TIMERS=1; shift ;;
    --skip-docker) SKIP_DOCKER=1; shift ;;
    -h | --help) sed -n '2,43p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "invalid --admin-user" >&2; exit 2; }
[[ "$RESTORE_REPO" =~ ^(sftp|s3|local)$ ]] || { echo "--restore-repo must be sftp, s3 or local" >&2; exit 2; }
if [ -n "$SWAP_GB" ] && ! [[ "$SWAP_GB" =~ ^[0-9]+$ ]]; then echo "--swap-gb must be an integer" >&2; exit 2; fi
for p in $EXTRA_PORTS; do [[ "$p" =~ ^[0-9]{1,5}$ ]] || { echo "bad port in --extra-tcp-ports: $p" >&2; exit 2; }; done

# cf-refresh is excluded on purpose: enable it only after a manual `cloudflare_only.sh --apply` was verified
# (docs/infra/CLOUDFLARE_ORIGIN_LOCKDOWN.md).
TIMERS=(
  roxira-backup-dr-run.timer roxira-backup-dr-report.timer roxira-backup-dr-check.timer
  roxira-docker-prune.timer roxira-monitor-daily.timer roxira-monitor-logs.timer
  roxira-monitor-synthetic.timer roxira-selfimprove-daily.timer roxira-selfimprove-hourly.timer
)

TMPFILES=()
cleanup() { [ "${#TMPFILES[@]}" -gt 0 ] && rm -f "${TMPFILES[@]}"; return 0; }
trap cleanup EXIT

log() { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap] WARNING: %s\n' "$*" >&2; }
step() { printf '\n=== %s ===\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# run <cmd...>: execute, or only print under --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# try <cmd...>: like run, but a failure is a warning, never fatal.
try() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] (non-fatal) %s\n' "$*"
  elif ! "$@"; then
    warn "command failed (continuing): $*"
    return 1
  fi
}

# write_file <path> <mode> [validator cmd...]: content from stdin, staged in a temp file.
# The validator (if any) runs on the temp file BEFORE install; the target is replaced only if it passes and differs.
# Content is never printed.
write_file() {
  local path="$1" mode="$2" tmp
  shift 2
  tmp="$(mktemp "${TMPDIR:-/tmp}/roxira-bootstrap.XXXXXX")"
  TMPFILES+=("$tmp")
  cat >"$tmp"
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    log "unchanged: $path"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] would write $path (mode $mode)${*:+, validated by: $*}"
    return 0
  fi
  if [ "$#" -gt 0 ] && ! "$@" "$tmp" >/dev/null; then
    die "validation failed for new $path; not installed"
  fi
  install -D -m "$mode" "$tmp" "$path"
  log "wrote: $path"
}

have_keys() { [ -s "$1" ] && grep -qE '^(ssh-|ecdsa-|sk-)' "$1"; }

if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" != 0 ]; then die "run as root (or use --dry-run)"; fi

OS_ID="unknown"
OS_CODENAME=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  OS_ID="$(. /etc/os-release && echo "${ID:-unknown}")"
  # shellcheck disable=SC1091
  OS_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
fi
case "$OS_ID" in
  ubuntu | debian) : ;;
  *) if [ "$DRY_RUN" = 1 ]; then log "note: OS is '$OS_ID' (real run needs ubuntu or debian)"; else die "ubuntu or debian expected, got '$OS_ID'"; fi ;;
esac
ARCH_DPKG="$(dpkg --print-architecture 2>/dev/null || echo unknown)"
log "os=$OS_ID codename=${OS_CODENAME:-?} arch=$ARCH_DPKG dry_run=$DRY_RUN key_access_flag=$KEY_ACCESS restore=$RESTORE"

if [ -z "$REPO_DIR" ]; then
  if [ -d "$APP_DIR/deploy/systemd" ]; then
    REPO_DIR="$APP_DIR"
  elif [ "$CLONE_REPO" = 1 ]; then
    REPO_DIR="$APP_DIR"
  else
    REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  fi
fi

if [ "$RESTORE" = 1 ] && [ "$DRY_RUN" != 1 ]; then
  [ -r /etc/roxira/backup.env ] || die "/etc/roxira/backup.env missing (copy it by hand, chmod 600) - needed for --restore"
  [ -r /etc/roxira/restic.pass ] || [ "$RESTORE_REPO" = local ] || die "/etc/roxira/restic.pass missing - needed for --restore"
fi

# ---------------------------------------------------------------- 1 packages
step "1/10 base packages, NTP"
run env DEBIAN_FRONTEND=noninteractive apt-get update -y
run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git ufw fail2ban python3-systemd unattended-upgrades apt-listchanges \
  restic age rsync jq python3 cron needrestart sudo openssh-server certbot
try timedatectl set-ntp true

# ---------------------------------------------------------------- 2 admin user
step "2/10 admin user '$ADMIN_USER' (key-only)"
KEY_SRC="${ADMIN_KEY_FILE:-/root/.ssh/authorized_keys}"
if [ "$DRY_RUN" = 1 ]; then
  log "[dry-run] create user $ADMIN_USER, add to group sudo, install keys from $KEY_SRC (count only), sudoers drop-in validated with visudo -cf"
else
  have_keys "$KEY_SRC" || die "no valid public key in $KEY_SRC. Add your key first, or you will lock yourself out."
  log "public keys found in $KEY_SRC: $(grep -cE '^(ssh-|ecdsa-|sk-)' "$KEY_SRC" || true) (values not printed)"
  if ! id "$ADMIN_USER" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$ADMIN_USER"
  fi
  usermod -aG sudo "$ADMIN_USER"
  install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
  # Append only the lines that are missing (never overwrite keys added later by hand).
  touch "/home/$ADMIN_USER/.ssh/authorized_keys"
  while IFS= read -r line; do
    [[ "$line" =~ ^(ssh-|ecdsa-|sk-) ]] || continue
    grep -qxF -- "$line" "/home/$ADMIN_USER/.ssh/authorized_keys" || printf '%s\n' "$line" >>"/home/$ADMIN_USER/.ssh/authorized_keys"
  done <"$KEY_SRC"
  chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"
  chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
fi
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$ADMIN_USER" | write_file /etc/sudoers.d/90-roxira-admin 0440 visudo -cf

# ---------------------------------------------------------------- 3 ufw
step "3/10 ufw (22 always; 8443/2053/2096 are not touched)"
UFW_ACTIVE=0
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then UFW_ACTIVE=1; fi
if [ "$UFW_ACTIVE" = 0 ]; then
  run ufw default deny incoming
  run ufw default allow outgoing
else
  log "ufw already active: default policies left as they are"
fi
run ufw allow 22/tcp comment 'ssh'
if [ "$OPEN_HTTP" = 1 ]; then
  run ufw allow 80/tcp comment 'http (narrow with scripts/ops/firewall/cloudflare_only.sh)'
  run ufw allow 443/tcp comment 'https (narrow with scripts/ops/firewall/cloudflare_only.sh)'
fi
for p in $EXTRA_PORTS; do run ufw allow "${p}/tcp" comment 'extra (opt-in)'; done
if [ "$UFW_ACTIVE" = 0 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] check that a 22/tcp allow rule exists, then: ufw --force enable"
  else
    ufw show added | grep -q '22/tcp' || die "no 22/tcp rule present; refusing to enable ufw"
    ufw --force enable
  fi
fi

# ---------------------------------------------------------------- 4 fail2ban + unattended-upgrades
step "4/10 fail2ban + unattended-upgrades (failures here are warnings)"
write_file /etc/fail2ban/jail.d/roxira.local 0644 <<'EOF'
[DEFAULT]
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
if [ "$DRY_RUN" = 1 ]; then
  log "[dry-run] fail2ban-client -t (validate); then systemctl enable --now fail2ban (reload if it was already running)"
elif fail2ban-client -t >/dev/null 2>&1; then
  if systemctl is-active --quiet fail2ban; then
    try fail2ban-client reload
  else
    try systemctl enable --now fail2ban
  fi
else
  warn "fail2ban config test failed (fail2ban-client -t); not (re)starting it. Fix /etc/fail2ban/jail.d/roxira.local and re-run."
fi

write_file /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# Security pocket only (distribution default). Docker's own repo is not in it, so docker-ce stays under manual control.
write_file /etc/apt/apt.conf.d/52roxira-unattended 0644 <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
try systemctl enable --now unattended-upgrades

# ---------------------------------------------------------------- 5 docker
step "5/10 Docker Engine + compose plugin"
DOCKER_FPR="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
if [ "$SKIP_DOCKER" = 1 ]; then
  log "skipped (--skip-docker)"
elif [ "$DRY_RUN" = 1 ]; then
  log "[dry-run] add download.docker.com/linux/$OS_ID apt repo (key fingerprint must equal $DOCKER_FPR), install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
  log "[dry-run] write /etc/docker/daemon.json (json-file log rotation 20m x 3) only if absent"
else
  if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
    got="$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | awk -F: '$1=="fpr"{print $10; exit}')"
    [ "$got" = "$DOCKER_FPR" ] || { rm -f /etc/apt/keyrings/docker.asc; die "Docker apt key fingerprint mismatch; aborting"; }
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$ARCH_DPKG" "$OS_ID" "$OS_CODENAME" >/etc/apt/sources.list.d/docker.list
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    log "docker already installed: $(docker --version)"
  fi
  if [ ! -f /etc/docker/daemon.json ]; then
    write_file /etc/docker/daemon.json 0644 <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" }
}
EOF
    systemctl restart docker
  else
    log "/etc/docker/daemon.json exists: left untouched"
  fi
  systemctl enable --now docker
fi

# ---------------------------------------------------------------- 6 swap
step "6/10 swap"
mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
mem_gib=$(((mem_kb + 1048575) / 1048576))
want_swap=0
if [ "$NO_SWAP" = 1 ]; then
  want_swap=0
elif [ -n "$SWAP_GB" ]; then
  want_swap="$SWAP_GB"
elif [ "$mem_gib" -le 9 ]; then
  want_swap=4
fi
log "RAM about ${mem_gib} GiB, swap target ${want_swap} GiB"
if [ "$want_swap" -gt 0 ]; then
  if [ "$(swapon --show --noheadings 2>/dev/null | wc -l)" -gt 0 ]; then
    log "swap already active: nothing to do"
  elif [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] fallocate -l ${want_swap}G /swapfile; chmod 600; mkswap; swapon; fstab entry; vm.swappiness=10"
  else
    fallocate -l "${want_swap}G" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=$((want_swap * 1024)) status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
  fi
  printf 'vm.swappiness=10\n' | write_file /etc/sysctl.d/90-roxira-swap.conf 0644
  try sysctl --system
fi

# ---------------------------------------------------------------- 7 /etc/roxira
step "7/10 /etc/roxira and state directories"
run install -d -m 700 -o root -g root /etc/roxira
run install -d -m 700 -o root -g root /var/lib/roxira /var/lib/roxira-backup /opt/roxira_backups
if [ "$DRY_RUN" = 1 ]; then
  log "[dry-run] chmod 600 on existing files in /etc/roxira (names only, contents never read)"
elif [ -d /etc/roxira ]; then
  find /etc/roxira -maxdepth 1 -type f -exec chmod 600 {} +
  find /etc/roxira -maxdepth 1 -type f -printf 'mode %m  %f\n' 2>/dev/null || true
fi
log "secrets to place by hand (never from git): /etc/roxira/backup.env, /etc/roxira/restic.pass, /etc/roxira/monitor.env, $APP_DIR/.env"

# ---------------------------------------------------------------- 8 repo + systemd units
step "8/10 repo checkout and systemd units from $REPO_DIR/deploy/systemd"
if [ "$RESTORE_SSH_KEYS" = 1 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] restic restore latest --include /root/.ssh into a temp dir, then MERGE: append missing authorized_keys lines, copy other files only if absent"
  else
    set -a
    # shellcheck disable=SC1091
    . /etc/roxira/backup.env
    set +a
    export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/etc/roxira/restic.pass}"
    kd="$(mktemp -d "${TMPDIR:-/var/tmp}/roxira-keys.XXXXXX")"
    case "$RESTORE_REPO" in
      sftp) RESTIC_REPOSITORY="sftp:${BACKUP_SB_USER:?}@${BACKUP_SB_HOST:?}:${BACKUP_SB_PATH:-roxira-restic}" \
        restic -o "sftp.command=ssh -p ${BACKUP_SB_PORT:-23} -i ${BACKUP_SB_KEY:-/root/.ssh/storagebox_backup} -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${BACKUP_SB_USER}@${BACKUP_SB_HOST} -s sftp" \
        restore latest --host roxira-prod --include /root/.ssh --target "$kd" ;;
      local) RESTIC_REPOSITORY="${BACKUP_LOCAL_REPO:?BACKUP_LOCAL_REPO not set}" restic restore latest --host roxira-prod --include /root/.ssh --target "$kd" ;;
      *) rm -rf "$kd"; die "--restore-ssh-keys supports sftp and local repos only" ;;
    esac
    mkdir -p /root/.ssh
    touch /root/.ssh/authorized_keys
    if [ -f "$kd/root/.ssh/authorized_keys" ]; then
      while IFS= read -r line; do
        [ -n "$line" ] && ! grep -qxF -- "$line" /root/.ssh/authorized_keys && printf '%s\n' "$line" >>/root/.ssh/authorized_keys
      done <"$kd/root/.ssh/authorized_keys"
    fi
    rsync -a --ignore-existing --exclude authorized_keys "$kd/root/.ssh/" /root/.ssh/
    chmod 700 /root/.ssh
    chmod 600 /root/.ssh/authorized_keys
    rm -rf "$kd"
    log "ssh keys merged from backup (existing files kept)"
  fi
fi
if [ "$CLONE_REPO" = 1 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] git clone \$BOOTSTRAP_REPO_URL $APP_DIR (only if $APP_DIR/.git is absent)"
  elif [ -d "$APP_DIR/.git" ]; then
    log "repo already present at $APP_DIR"
  else
    git clone "$REPO_URL" "$APP_DIR" || die "git clone failed (deploy key in place? set BOOTSTRAP_REPO_URL)"
  fi
fi
UNIT_SRC="$REPO_DIR/deploy/systemd"
if [ ! -d "$UNIT_SRC" ]; then
  warn "$UNIT_SRC missing (clone the repo to $APP_DIR first, then re-run this script). Skipping units."
else
  # The legacy roxira-backup.{service,timer} is superseded by roxira-backup-dr-* (deploy/systemd/README.md): skip it.
  for f in "$UNIT_SRC"/roxira-*.service "$UNIT_SRC"/roxira-*.timer; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in roxira-backup.service | roxira-backup.timer) continue ;; esac
    if [ -f "/etc/systemd/system/$base" ] && cmp -s "$f" "/etc/systemd/system/$base"; then
      continue
    fi
    run install -m 0644 "$f" "/etc/systemd/system/$base"
  done
  run systemctl daemon-reload
  if [ "$ENABLE_TIMERS" = 1 ] && [ "$RESTORE" = 0 ]; then
    for t in "${TIMERS[@]}"; do
      if [ "$DRY_RUN" = 1 ] || [ -f "/etc/systemd/system/$t" ]; then
        try systemctl enable --now "$t"
      else
        warn "$t not installed, skipped"
      fi
    done
  else
    log "timers installed but NOT enabled. After the restore and one manual backup run: re-run with --enable-timers"
  fi
fi

# ---------------------------------------------------------------- 9 restore (opt-in)
step "9/10 restore from backup (opt-in: --restore)"
if [ "$RESTORE" != 1 ]; then
  log "skipped. Restore by hand: $APP_DIR/scripts/ops/backup/restore.sh --dry-run, then --full (see docs/infra/NEW_SERVER_PLAN_2026-10-12.md)"
elif [ "$DRY_RUN" = 1 ]; then
  log "[dry-run] $APP_DIR/scripts/ops/backup/restore.sh --full --yes --repo $RESTORE_REPO   (cron is HELD, not applied; see its --cron option)"
  log "[dry-run] certbot renew --dry-run (warning only: certs come back from /etc/letsencrypt in the backup)"
else
  rc=0
  "$APP_DIR/scripts/ops/backup/restore.sh" --full --yes --repo "$RESTORE_REPO" || rc=$?
  if [ "$rc" -eq 3 ]; then
    warn "restore.sh finished PARTIALLY (exit 3): some Postgres databases were skipped. NOT continuing; sshd was not changed."
    warn "Read its output above, fix, resume with its printed --from-step command, then re-run this script."
    exit 3
  elif [ "$rc" -ne 0 ]; then
    warn "restore.sh FAILED (exit $rc). NOT continuing; sshd was not changed. Use its printed resume hint if any."
    exit "$rc"
  fi
  try certbot renew --dry-run
  run systemctl daemon-reload
  if [ "$ENABLE_TIMERS" = 1 ]; then
    for t in "${TIMERS[@]}"; do [ -f "/etc/systemd/system/$t" ] && try systemctl enable --now "$t"; done
  fi
fi

# ---------------------------------------------------------------- 10 sshd hardening (LAST)
step "10/10 sshd hardening (keys only; Port untouched)"
# 00- prefix: sshd uses the FIRST value it reads, so this wins over 50-cloud-init.conf (PasswordAuthentication yes).
# PermitRootLogin stays prohibit-password because scripts/ops/deploy_local.sh and the backup pull log in as root with a key.
if [ "$KEY_ACCESS" != 1 ]; then
  warn "sshd hardening SKIPPED. Password login stays as the image has it."
  warn "To lock the host to keys: log in once with your key from a SECOND terminal, then re-run with --i-have-key-access."
else
  cat <<'EOF'
!!! LOCKOUT WARNING !!!
This step disables SSH password login. If no working key is installed you will lose access to this server.
Keep this session open until a NEW terminal logs in with your key as root AND as the admin user.
EOF
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] require non-empty valid keys in /root/.ssh/authorized_keys AND /home/$ADMIN_USER/.ssh/authorized_keys; write drop-in; sshd -t; reload; verify with sshd -T"
  elif ! have_keys /root/.ssh/authorized_keys || ! have_keys "/home/$ADMIN_USER/.ssh/authorized_keys"; then
    warn "missing authorized_keys for root and/or $ADMIN_USER: sshd hardening SKIPPED to avoid a lockout."
  else
    write_file /etc/ssh/sshd_config.d/00-roxira-hardening.conf 0644 <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
    if sshd -t; then
      systemctl reload ssh 2>/dev/null || systemctl reload sshd
      if sshd -T 2>/dev/null | grep -q '^passwordauthentication no'; then
        log "sshd now refuses passwords"
      else
        warn "sshd -T does not show passwordauthentication no; check other drop-ins"
      fi
    else
      rm -f /etc/ssh/sshd_config.d/00-roxira-hardening.conf
      warn "sshd -t failed; the new drop-in was removed and sshd was NOT reloaded"
    fi
  fi
fi

step "done"
cat <<EOF
Next (see docs/infra/NEW_SERVER_PLAN_2026-10-12.md):
  1. From a SECOND terminal confirm you can still log in:  ssh ${ADMIN_USER}@<new-ip>   (keep this session open until then)
  2. Place the secrets by hand in /etc/roxira, clone the repo to $APP_DIR, run scripts/ops/backup/restore.sh
  3. Review held cron jobs before activating them:  restore.sh --apply-cron --dry-run
  4. Smoke test with a hosts override BEFORE the Cloudflare DNS switch
  5. After DNS is switched and verified: scripts/ops/firewall/cloudflare_only.sh --apply
EOF
