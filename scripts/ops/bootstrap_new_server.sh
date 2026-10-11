#!/usr/bin/env bash
# Fresh Ubuntu 24.04 -> hardened Roxira host, then restore from backup.
# Run as root on the NEW server:
#   bootstrap_new_server.sh [--dry-run] [--skip-restore] [--repo sftp|s3]
#
# Prerequisites you provide (never stored in git): copy /etc/roxira/backup.env and /etc/roxira/restic.pass
# from the owner's password manager / ~/Secrets/roxira to the new host (chmod 600), and the Storage Box
# private key at the path BACKUP_SB_KEY points to (it is also inside the backup, but you need it to reach it), plus
# BOOTSTRAP_SSH_PUBKEY_FILE (default /root/.ssh/authorized_keys must already hold your key).
# Env: BOOTSTRAP_REPO_URL, BOOTSTRAP_ADMIN_USER (default roxira), BOOTSTRAP_EXTRA_TCP_PORTS (default "8443").
set -euo pipefail

DRY_RUN=0
SKIP_RESTORE=0
REPO_CHOICE="sftp"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --skip-restore) SKIP_RESTORE=1; shift ;;
    --repo) REPO_CHOICE="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_URL="${BOOTSTRAP_REPO_URL:-git@github.com:Mahan-film/roxira-platform.git}"
ADMIN_USER="${BOOTSTRAP_ADMIN_USER:-roxira}"
EXTRA_PORTS="${BOOTSTRAP_EXTRA_TCP_PORTS:-8443}"
APP_DIR=/opt/roxira_platform

step() { printf '\n=== %s ===\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ "$DRY_RUN" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root"
if [ "$DRY_RUN" != 1 ]; then
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || die "Ubuntu expected, got ${ID:-?}"
  [ -r /etc/roxira/backup.env ] || [ "$SKIP_RESTORE" = 1 ] || die "/etc/roxira/backup.env missing"
  [ -r /etc/roxira/restic.pass ] || [ "$SKIP_RESTORE" = 1 ] || die "/etc/roxira/restic.pass missing"
fi

step "1/10 packages and updates"
run apt-get update -y
run env DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
run env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades \
  restic age rsync jq python3 certbot

step "2/10 admin user and ssh keys"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] create user $ADMIN_USER (sudo), copy root authorized_keys, refuse to continue if no key is present"
else
  [ -s /root/.ssh/authorized_keys ] || die "no authorized_keys for root; add your public key first or you will lock yourself out"
  id "$ADMIN_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$ADMIN_USER"
  usermod -aG sudo "$ADMIN_USER"
  install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
  install -m 600 -o "$ADMIN_USER" -g "$ADMIN_USER" /root/.ssh/authorized_keys "/home/$ADMIN_USER/.ssh/authorized_keys"
  echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/90-roxira-admin && chmod 440 /etc/sudoers.d/90-roxira-admin
fi

step "3/10 sshd hardening (keys only)"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] write /etc/ssh/sshd_config.d/10-roxira-hardening.conf (PasswordAuthentication no, PermitRootLogin prohibit-password); sshd -t; reload ssh"
else
  cat >/etc/ssh/sshd_config.d/10-roxira-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
EOF
  sshd -t && systemctl reload ssh
fi

step "4/10 firewall (ufw)"
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow 22/tcp
run ufw allow 80/tcp
run ufw allow 443/tcp
for p in $EXTRA_PORTS; do run ufw allow "${p}/tcp"; done
run ufw --force enable

step "5/10 fail2ban + unattended-upgrades"
run systemctl enable --now fail2ban
run dpkg-reconfigure -f noninteractive unattended-upgrades

step "6/10 docker engine + compose plugin (official apt repo)"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] add download.docker.com apt repo, install docker-ce docker-compose-plugin, enable docker"
else
  if ! command -v docker >/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" >/etc/apt/sources.list.d/docker.list
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
  systemctl enable --now docker
fi

step "7/10 restore ssh keys first (needed to clone the repo), then clone"
if [ "$SKIP_RESTORE" = 1 ]; then
  echo "skipped (--skip-restore); ensure a deploy key exists for $REPO_URL"
else
  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] restic restore latest --include /root/.ssh --target /var/tmp/roxira-keys; rsync into /root/.ssh"
  else
    set -a; . /etc/roxira/backup.env; set +a
    mkdir -p /var/tmp/roxira-keys
    # bootstrap restic call: plain env, mirrors scripts/ops/backup/lib.sh restic_on for sftp
    export RESTIC_PASSWORD_FILE=/etc/roxira/restic.pass
    RESTIC_REPOSITORY="sftp:${BACKUP_SB_USER}@${BACKUP_SB_HOST}:${BACKUP_SB_PATH:-roxira-restic}" \
      restic -o "sftp.command=ssh -p ${BACKUP_SB_PORT:-23} -i ${BACKUP_SB_KEY:-/root/.ssh/storagebox_backup} -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${BACKUP_SB_USER}@${BACKUP_SB_HOST} -s sftp" \
      restore latest --host roxira-prod --include /root/.ssh --target /var/tmp/roxira-keys
    # Merge, do not clobber: the fresh host's own authorized_keys stays valid (no lock-out) and the backup's
    # lines are appended if missing; every other restored file (deploy key, storagebox key, config) is copied
    # only when absent so a key already installed on this host is never overwritten.
    mkdir -p /root/.ssh
    if [ -f /var/tmp/roxira-keys/root/.ssh/authorized_keys ]; then
      touch /root/.ssh/authorized_keys
      while IFS= read -r line; do
        [ -n "$line" ] && ! grep -qxF -- "$line" /root/.ssh/authorized_keys && printf '%s\n' "$line" >>/root/.ssh/authorized_keys
      done </var/tmp/roxira-keys/root/.ssh/authorized_keys
    fi
    rsync -a --ignore-existing --exclude authorized_keys /var/tmp/roxira-keys/root/.ssh/ /root/.ssh/
    chmod 600 /root/.ssh/authorized_keys
    chmod 700 /root/.ssh; chmod 600 /root/.ssh/id_* 2>/dev/null || true
    rm -rf /var/tmp/roxira-keys
  fi
fi
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] git clone $REPO_URL $APP_DIR (only if $APP_DIR/.git absent)"
elif [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

step "8/10 restore data from backup (scripts/ops/backup/restore.sh --full)"
if [ "$SKIP_RESTORE" = 1 ]; then
  echo "skipped (--skip-restore)"
elif [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] $APP_DIR/scripts/ops/backup/restore.sh --full --yes --repo $REPO_CHOICE"
else
  "$APP_DIR/scripts/ops/backup/restore.sh" --full --yes --repo "$REPO_CHOICE"
fi

step "9/10 TLS certificates and backup timers"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] certbot renew --dry-run (certs come back from /etc/letsencrypt in the backup); install roxira-backup-dr-*.timer"
else
  certbot renew --dry-run || echo "WARN: cert renewal test failed; DNS must point here first (see DNS checklist)"
  cp "$APP_DIR"/deploy/systemd/roxira-backup-dr-*.service "$APP_DIR"/deploy/systemd/roxira-backup-dr-*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now roxira-backup-dr-run.timer roxira-backup-dr-report.timer roxira-backup-dr-check.timer
fi

step "10/10 DNS and handover checklist (manual)"
cat <<'EOF'
 [ ] Cloudflare: lower TTL of A/AAAA records (60s) BEFORE cutover; then point them at the NEW server IP.
 [ ] Cloudflare SSL mode stays Full (strict); confirm origin cert / Let's Encrypt valid on the new host.
 [ ] Re-point GitHub deploy key / webhook secrets if they reference the old IP.
 [ ] Update the Storage Box and Mac pull config if the server IP is baked in (ROXIRA_HOST).
 [ ] Run: server_backup.sh run  and confirm a new snapshot appears; check the daily email.
 [ ] Old server: stop containers (avoid split-brain writes), keep it 7 days, then delete.
EOF
