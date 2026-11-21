#!/bin/bash
# roxira-ci one-time root setup (run with sudo). No secrets in this file.
set -u
OWNER_USER="${OWNER_USER:-mahanfilms}"
KEYS=/home/mahan/.ssh/authorized_keys
log(){ echo; echo "== $*"; }

log "apt: drop download.docker.com (returns 403 here), use Ubuntu's own packages"
rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.gpg
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q \
  docker.io docker-compose-v2 docker-buildx nodejs npm gh git-lfs \
  uidmap rootlesskit slirp4netns dbus-user-session fuse-overlayfs \
  python3-venv python3-pip zstd || echo "WARN: some packages failed"
systemctl set-default multi-user.target
systemctl enable --now docker

log "users: runner (CI, rootless Docker later), voice (phone stack), $OWNER_USER (owner)"
for u in runner voice "$OWNER_USER"; do
  id "$u" >/dev/null 2>&1 || useradd -m -s /bin/bash "$u"
  install -d -m 700 -o "$u" -g "$u" "/home/$u/.ssh"
  install -m 600 -o "$u" -g "$u" "$KEYS" "/home/$u/.ssh/authorized_keys"
  chmod 750 "/home/$u"
done
usermod -aG docker voice
usermod -aG sudo,docker "$OWNER_USER"
gpasswd -d runner docker >/dev/null 2>&1 || true
loginctl enable-linger runner
loginctl enable-linger voice
grep -E "^(runner|voice):" /etc/subuid || echo "WARN: no subuid range for runner/voice"

log "firewall: SSH from the home network only"
ufw allow from 192.168.0.0/16 to any port 22 proto tcp
ufw --force enable
ufw status | head -5

log "automatic security updates"
systemctl enable --now unattended-upgrades

log "old HDD: read-only look (nothing is changed or deleted)"
for p in sda2 sda3; do
  mkdir -p /mnt/old-$p
  if mount -o ro -t ntfs3 /dev/$p /mnt/old-$p 2>/dev/null; then
    echo "-- /dev/$p"; df -h /mnt/old-$p | tail -1
    ls -A /mnt/old-$p | head -40
    du -sh /mnt/old-$p/* 2>/dev/null | sort -rh | head -15
    umount /mnt/old-$p
  else
    echo "-- /dev/$p could not be mounted read-only"
  fi
done

log "versions"
docker --version; docker compose version; node -v; npm -v; gh --version | head -1
echo; echo "SETUP DONE"
