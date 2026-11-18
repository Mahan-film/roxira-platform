#!/bin/bash
# roxira-ci root setup, part 2: data disk (owner approved wiping the 1 TB HDD on 2026-11-18),
# xray proxy client (installed, OFF by default), box-proxy toggle. No secrets in this file.
set -u
log(){ echo; echo "== $*"; }

log "data disk: wipe the Toshiba 1 TB HDD and mount it at /srv/data"
DISK=/dev/sda
ROOTDEV=$(findmnt -no SOURCE /)
MODEL=$(lsblk -dno MODEL $DISK | xargs)
SIZE=$(lsblk -dbno SIZE $DISK)
if [[ "$ROOTDEV" == /dev/sda* ]] || [[ "$MODEL" != TOSHIBA* ]] || (( SIZE < 900000000000 )) || findmnt -rno SOURCE | grep -q "^$DISK"; then
  echo "SAFETY STOP: $DISK is not the unmounted 1 TB Toshiba HDD (root=$ROOTDEV model=$MODEL size=$SIZE). Nothing changed."
else
  wipefs -a ${DISK}[0-9]* >/dev/null 2>&1; wipefs -a $DISK
  parted -s $DISK mklabel gpt mkpart data ext4 1MiB 100%
  sleep 2; partprobe $DISK; sleep 1
  mkfs.ext4 -q -F -L data -m 1 ${DISK}1
  mkdir -p /srv/data
  UUID=$(blkid -s UUID -o value ${DISK}1)
  sed -i '\#/srv/data#d' /etc/fstab
  echo "UUID=$UUID /srv/data ext4 defaults,noatime,nofail 0 2" >> /etc/fstab
  systemctl daemon-reload; mount /srv/data
  install -d -m 755 /srv/data/backups /srv/data/restore-drill /srv/data/qdrant-snapshots /srv/data/shared
  install -d -m 750 -o runner -g runner /srv/data/ci-artifacts /srv/data/ci-cache
  install -d -m 750 -o voice -g voice /srv/data/voice
  df -h /srv/data | tail -1
  update-grub >/dev/null 2>&1 && echo "grub updated (old Windows entry gone)"
fi

log "xray proxy client (OFF until the owner's config is installed and 'box-proxy on' is run)"
ARCH=64
VER=$(curl -fsSL -m 20 https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+')
if [ -n "$VER" ]; then
  TMP=$(mktemp -d)
  curl -fsSL -m 120 -o $TMP/xray.zip "https://github.com/XTLS/Xray-core/releases/download/$VER/Xray-linux-$ARCH.zip" \
   && curl -fsSL -m 30 -o $TMP/xray.zip.dgst "https://github.com/XTLS/Xray-core/releases/download/$VER/Xray-linux-$ARCH.zip.dgst" \
   && WANT=$(grep -i 'SHA2-256' $TMP/xray.zip.dgst | awk '{print $NF}') \
   && GOT=$(sha256sum $TMP/xray.zip | awk '{print $1}') \
   && [ "$WANT" = "$GOT" ] && unzip -qo $TMP/xray.zip -d $TMP/x \
   && install -m 755 $TMP/x/xray /usr/local/bin/xray \
   && install -d -m 755 /usr/local/share/xray && install -m 644 $TMP/x/*.dat /usr/local/share/xray/ \
   && echo "xray $VER installed (sha256 verified)" || echo "WARN: xray download or checksum failed"
  rm -rf $TMP
else
  echo "WARN: could not read the latest xray release"
fi
useradd -r -s /usr/sbin/nologin xray 2>/dev/null || true
install -d -m 750 -o root -g xray /etc/xray
cat > /etc/systemd/system/xray.service <<'UNIT'
[Unit]
Description=Xray proxy client (local SOCKS 127.0.0.1:10808, HTTP 127.0.0.1:10809)
After=network-online.target
[Service]
User=xray
ExecStart=/usr/local/bin/xray run -config /etc/xray/config.json
Environment=XRAY_LOCATION_ASSET=/usr/local/share/xray
Restart=on-failure
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl disable xray >/dev/null 2>&1 || true

cat > /usr/local/bin/box-proxy <<'TOGGLE'
#!/bin/bash
# box-proxy on|off|status — start/stop xray and point system Docker pulls through it.
set -e
DROP=/etc/systemd/system/docker.service.d/proxy.conf
case "${1:-status}" in
  on)  [ -s /etc/xray/config.json ] || { echo "no /etc/xray/config.json"; exit 1; }
       systemctl start xray
       mkdir -p "$(dirname $DROP)"
       printf '[Service]\nEnvironment=HTTP_PROXY=http://127.0.0.1:10809\nEnvironment=HTTPS_PROXY=http://127.0.0.1:10809\nEnvironment=NO_PROXY=localhost,127.0.0.1,192.168.0.0/16,ghcr.io,quay.io,public.ecr.aws\n' > $DROP
       systemctl daemon-reload; systemctl restart docker; echo "proxy ON";;
  off) rm -f $DROP; systemctl daemon-reload; systemctl restart docker; systemctl stop xray || true; echo "proxy OFF";;
  status) systemctl is-active xray || true; [ -f $DROP ] && echo "docker via proxy" || echo "docker direct";;
esac
TOGGLE
chmod 755 /usr/local/bin/box-proxy
echo "box-proxy installed: sudo box-proxy on|off|status"

log "allow the 'mahan' admin to run only box-proxy without a password"
echo "mahan ALL=(root) NOPASSWD: /usr/local/bin/box-proxy" > /etc/sudoers.d/box-proxy
chmod 440 /etc/sudoers.d/box-proxy; visudo -cf /etc/sudoers.d/box-proxy

log "rootless Docker prerequisites for runner"
ls /usr/share/docker.io/contrib/ 2>/dev/null | grep -i rootless || echo "no rootless contrib scripts in docker.io"
command -v dockerd-rootless-setuptool.sh || true
echo; echo "SETUP2 DONE"
