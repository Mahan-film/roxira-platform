# Linux CI box (owner's HP laptop)

Owner decision 2026-11-17: the HP laptop leaves Windows and becomes a headless Linux server for CI/CD. No production data, no production secrets. Once the repo goes private (`docs/strategy/PRIVATE_REPO_PLAN_2026-11-17.md`), this box runs **all** CI, because GitHub-hosted minutes on private repos are capped.


> **2026-11-18:** the laptop is an **HP Laptop 15-da0xxx** (consumer column in Part B, BIOS F.36, SSD shown as about 233 GB). The owner decided the phone line also runs on this box. That changes Part E: the runner uses rootless Docker, and the phone stack runs under a separate `voice` user. See `LAPTOP_HANDOFF_2026-11-18.md`.

## Live state (2026-11-18, hub)
- **Host:** `roxira-ci`, Ubuntu **26.04.1** LTS (installed instead of 24.04), HP Laptop 15-da0xxx, LAN only (Wi-Fi now, Ethernet later). SSH from the Mac works with the Mac's key for `mahan` (admin), `runner` and `mahanfilms` (owner's own login, sudo). The phone stack runs as user **`phone`** (`voice` is a system group on Ubuntu), data in `/srv/data/phone`; bringing it up follows `docs/ops/LAPTOP_HANDOFF_2026-11-18.md` with `phone` in place of `voice`.
- **Network:** GitHub, npm, PyPI, nodejs.org, ghcr.io, quay.io and public.ecr.aws work. Docker Hub (`registry-1.docker.io`), `download.docker.com` and `mirror.gcr.io` are blocked from this network (HTTP 403). Docker therefore comes from Ubuntu's own packages (`docker.io` 29.1, `docker-compose-v2` 2.40), and CI images move to `public.ecr.aws/docker/library/*` (#956).
- **Proxy:** Xray is installed with the owner's config (tested 2026-11-18: Docker Hub reachable through it) and is **off** by default. Install a new config with `python3 scripts/ops/ci_box/v2ray2xray.py <link-file> | ssh mahan@roxira-ci 'sudo box-proxy install'` (the link file stays on the Mac, mode 600, never in git); `sudo box-proxy on|off|status|test` starts it and routes system-Docker pulls through `http://127.0.0.1:10809` (SOCKS on 10808). Turn it on only when a job needs a blocked host.
- **Data disk:** the 1 TB HDD was wiped (owner approved) and is mounted at `/srv/data` (ext4, label `data`, 907 GB): `backups/`, `restore-drill/`, `qdrant-snapshots/`, `shared/`, `ci-artifacts/` and `ci-cache/` (runner), `voice/`.
- **CI runner:** GitHub runner 2.338 as user `runner`, **rootless Docker** (`DOCKER_HOST=unix:///run/user/1001/docker.sock`, not in the system `docker` group), persistent user service `actions-runner.service` (linger on), work dir `/srv/data/ci-cache/_work`, labels `self-hosted, Linux, X64, hp, linux-box`. No workflow uses it yet; #949 moves jobs over with the fork guard. Ephemeral mode was dropped: it would need a long-lived registration credential on the box.
- **Firewall:** ufw on, SSH only from 192.168.0.0/16. Automatic security updates on.
- **Hub access:** Claude on the Mac cannot open LAN connections itself (macOS Local Network permission), so the hub runs SSH through the app's Terminal tab and reads results from files.

Setup scripts (no secrets): `scripts/ops/ci_box/` — root parts 01–03 (run with `sudo setsid bash … </dev/null >log 2>&1`; a piped `sudo … | tee` under `ssh -t` stops apt on Ubuntu 26.04), runner parts 10–11 as user `runner`.

## Hardware and roles
| Part | Value | Use |
|---|---|---|
| CPU | Intel Core i7-8550U, 4 cores / 8 threads | one heavy CI job at a time, or two light ones |
| RAM | 24 GB DDR4 | Postgres + Redis + NestJS + Next.js build + Chromium together; TEI bge-m3 on CPU for offline Smart Judge evals |
| Internal SSD | 256 GB | Ubuntu, Docker images and volumes, runner work directories (fast I/O) |
| Internal HDD | 1 TB | `/srv/data`: backup copies, restore-drill dumps, Qdrant snapshot copies, CI artifacts and Playwright traces, caches |
| External SSD | 1 TB | installer (Ventoy) and spare storage; not needed once installed |
| GPU | Intel UHD 620 + NVIDIA MX130 (2 GB) | display only. The MX130 is too small and too old for AI work; no NVIDIA driver, to save heat and power |
| Cooling | owner-built | sustained load OK; `thermald` keeps the CPU below 90 °C |

Why Linux: Windows uses 3–4 GB RAM and forces reboots for updates, and Docker on Windows runs inside a VM. On Linux, Docker is native, the GitHub runner is a plain service, and the box behaves like the production server.

Note: production is ARM (arm64) and this box is x86 (amd64). CI catches logic errors; the production image is still built on the server itself.

## Jobs it takes over
1. **Pre-push local CI off the Mac:** `LOCAL_CI_REMOTE=roxira-ci git push` runs `scripts/dev/local_ci.sh` on the box (#947).
2. **Self-hosted GitHub Actions runner** (labels `self-hosted, linux, x64, hp`): `ci.yml`, the review desk, the nightly full M1 suite, the T168 Playwright shards (#900), and the scheduled jobs (`uptime.yml` etc.).
3. **Weekly restore drill** (T198) and the WAL-G point-in-time restore test (T204), with dumps on the HDD.
4. **Smart Judge offline evals** (T211 #925, T212 #926) against a local TEI + Qdrant copy.

## Part A — before you erase Windows (owner, ~20 min)
1. **Copy anything you still need** from both internal disks (SSD and HDD). Both will be erased.
2. **Model name:** Windows Settings → System → About, or the sticker under the laptop (for example "HP ProBook 450 G5" or "HP Pavilion 15"). Tell the hub.
3. **Update the BIOS while Windows is still there:** run HP Support Assistant → Updates, or download the newest BIOS for your exact model from support.hp.com → Software and Drivers. HP's BIOS updaters are Windows programs; afterwards updating is harder.
4. **Copy the data on the external SSD elsewhere** (for example to the Mac). Installing Ventoy erases it once. Afterwards the SSD is normal storage again, with the Ubuntu ISO sitting as one file on it.
5. **Make the installer on the external SSD** (from Windows on this laptop):
   - Download Ventoy for Windows from its official GitHub releases page (github.com/ventoy/Ventoy/releases, file `ventoy-x.y.z-windows.zip`), unzip it, run `Ventoy2Disk.exe`.
   - Options → **Show All Devices** (an external SSD counts as a hard disk, not a USB stick). Select the external SSD (check its size, 1 TB, so you do not pick an internal disk). Partition style **GPT**. Click Install.
   - Download **Ubuntu Server 24.04 LTS** (amd64 ISO) from ubuntu.com/download/server and copy the `.iso` file onto the Ventoy drive like any file.

## Part B — BIOS settings (owner, ~10 min)
Turn the laptop off. Press the power button and tap **Esc** repeatedly until the Startup Menu appears. F1 = system information, **F9 = boot device menu**, **F10 = BIOS Setup**. Press F10.

Names differ by model family; set whichever of these your BIOS shows:

| Setting | Business models (EliteBook/ProBook: tabs Main, Security, Advanced) | Consumer models (Pavilion/Envy: tabs Main, Security, Configuration, Boot Options) | Value |
|---|---|---|---|
| Secure Boot | Advanced → Secure Boot Configuration → "Legacy Support Disable and Secure Boot Disable" | Configuration or Boot Options → Secure Boot | **Off** for the install (Ventoy needs it); turn it back on afterwards |
| USB/external boot | Advanced → Boot Options → USB Storage Boot | Boot Options → USB Boot | **Enabled** |
| Fast Boot | Advanced → Boot Options → Fast Boot | Boot Options → Fast Boot | **Off** |
| Virtualization | Advanced → System Options → Virtualization Technology (VTx) | Configuration → Virtualization Technology | **Enabled** |
| Fan | Advanced → Built-in Device Options → "Fan Always on while on AC Power" | Configuration → Fan Always On | **Enabled** |
| Battery | Advanced → Power Management → Battery Health Manager ("Maximize my battery health") if present | Configuration → Battery Care Function (80%) if present | cap at 80% if the option exists |
| Power on after outage | Advanced → Power-On Options → "After Power Loss" | often missing | **Power On** if present |
| Wake on LAN | Advanced → Built-in Device Options → Wake on LAN | often missing | Enabled (optional) |

Save with **F10** (or Main → Save Changes and Exit).

If your model has no battery-limit option: Linux cannot cap the charge on most HP laptops. Keep the laptop on AC, and every few months check that the case does not bulge (a swelling battery lifts the touchpad or the bottom cover).

## Part C — install Ubuntu (owner, ~20 min)
1. Plug in the external SSD and the charger. Power on and tap **Esc**, then **F9**, then choose the external SSD (the UEFI entry). The Ventoy menu appears; choose the Ubuntu ISO, then "Boot in normal mode", then "Try or Install Ubuntu Server".
2. Language and keyboard: English. Installation type: **Ubuntu Server** (not "minimized").
3. Network: choose the Wi-Fi adapter (`wl…`), pick your network and enter its password. Ethernet works later without reinstalling.
4. Proxy: empty. Mirror: default.
5. **Storage (important):** choose "Use an entire disk" and select the **256 GB SSD** (shown as about 238 GB; the 1 TB HDD is about 931 GB, leave it untouched; the hub formats it later). **Uncheck "Set up this disk as an LVM group"**: with LVM the installer gives Ubuntu only 100 GB of the disk by default. Confirm the summary shows the SSD only, then continue.
6. Profile: your name, server name **`roxira-ci`**, a username and a strong password. Keep the password yourself; never send it in chat.
7. Ubuntu Pro: Skip. SSH: **check "Install OpenSSH server"**. Featured snaps: select **none** (Docker comes later from Docker's own repository, not the snap).
8. When "Reboot now" appears: reboot, unplug the external SSD when asked, and log in.
9. Type `ip -4 addr` and give the hub the address of the Wi-Fi interface (for example `192.168.1.23`).
10. Optional: back in the BIOS, turn Secure Boot on again (Ubuntu boots with it).

## Part D — first connection from the Mac (owner, 1 min)
In the Mac's Terminal (not in chat): `ssh-copy-id <username>@<that IP>`, then type the laptop password when asked. From then on the hub connects with the Mac's key and does the rest.

## Part E — setup (the hub, over SSH)
- Packages: `git curl jq unzip build-essential thermald lm-sensors unattended-upgrades ufw`; lid switch ignored; firewall allows SSH from the home network only; automatic security updates; no NVIDIA driver.
- HDD: one GPT partition, ext4, mounted at `/srv/data` via `/etc/fstab` by UUID.
- Docker from Ubuntu's `docker.io` package (Docker's own repository is blocked from this network); a weekly `docker system prune` for images older than 7 days.
- User `runner` (no sudo, rootless Docker, not in the `docker` group); Node 22; GitHub runner as a persistent user service (labels `hp`). The hub registered it with a short-lived token piped from `gh` straight into `config.sh`, never displayed.
- Ethernet: once the cable is in, netplan prefers it over Wi-Fi (route metric); nothing else changes.

## Security rules
- Until the repo is private: the runner serves only `push` to main, `merge_group`, `schedule` and `workflow_dispatch`; jobs carry a guard so a fork pull request never reaches it. After going private only collaborators can open PRs, but the guard stays.
- No production keys, no `~/Secrets`, no SSH key to `roxira-prod` on the box. The `docker` group is root-equivalent, which is accepted only because the box holds nothing of value.
- Tailscale is not needed: the runner only makes outbound connections to GitHub. Add it later only if SSH from outside the home network is wanted.

## Done when (workflow part: #947 T227, lane L1)
- `ssh roxira-ci` works from the Mac; `docker run hello-world` works as `runner`; `/srv/data` is mounted.
- `LOCAL_CI_REMOTE=roxira-ci git push` runs local CI on the box.
- The runner shows "Idle" in GitHub; CI, nightly M1 and T168 shards use `runs-on: [self-hosted, hp]`, with a fallback input to hosted runners when the box is offline.
- `sensors` stays below 90 °C during a full CI run.
