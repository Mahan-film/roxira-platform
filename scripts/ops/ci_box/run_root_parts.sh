#!/bin/bash
# Wrapper: clear the stopped apt from the first attempt, then run parts 1 and 2 without a terminal.
pkill -9 -f "apt-get install -y -q docker.io" 2>/dev/null
pkill -9 -f "bash /home/mahan/01_root_base.sh" 2>/dev/null
sleep 2
DEBIAN_FRONTEND=noninteractive dpkg --configure -a
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
bash /home/mahan/01_root_base.sh
bash /home/mahan/02_root_disk_proxy.sh
echo ALL DONE
