# Linux CI box (owner's HP laptop)

Owner decision 2026-11-17: the HP laptop leaves Windows and becomes a headless Linux server for CI/CD. No production data, no production secrets. Once the repo goes private (`docs/strategy/PRIVATE_REPO_PLAN_2026-11-17.md`), this box runs **all** CI, because GitHub-hosted minutes on private repos are capped.


> **2026-11-18:** the laptop is an **HP Laptop 15-da0xxx** (consumer column in Part B, BIOS F.36, SSD shown as about 233 GB). The owner decided the phone line also runs on this box. That changes Part E: the runner uses rootless Docker, and the phone stack runs under a separate `phone` user (`voice` is a system group on Ubuntu). See `LAPTOP_HANDOFF_2026-11-18.md`.

## Live state (2026-11-18, hub)
- **Host:** `roxira-ci`, Ubuntu **26.04.1** LTS (installed instead of 24.04), HP Laptop 15-da0xxx, LAN only (Wi-Fi now, Ethernet later). SSH from the Mac works with the Mac's key for `mahan` (admin), `runner` and `mahanfilms` (owner's own login, sudo). The phone stack runs as user **`phone`** (`voice` is a system group on Ubuntu), data in `/srv/data/phone`; bringing it up follows `docs/ops/LAPTOP_HANDOFF_2026-11-18.md` with `phone` in place of `voice`.
- **Network:** GitHub, npm, PyPI, nodejs.org, ghcr.io, quay.io and public.ecr.aws work. Docker Hub (`registry-1.docker.io`), `download.docker.com` and `mirror.gcr.io` are blocked from this network (HTTP 403). Docker therefore comes from Ubuntu's own packages (`docker.io` 29.1, `docker-compose-v2` 2.40), and CI images move to `public.ecr.aws/docker/library/*` (#956).
- **Proxy:** Xray is installed with the owner's config (tested 2026-11-18: Docker Hub reachable through it) and is **always on** (owner decision 2026-11-19): all agent traffic on this box goes through it. Install a new config with `python3 scripts/ops/ci_box/v2ray2xray.py <link-file> | ssh mahan@roxira-ci 'sudo box-proxy install'` (the link file stays on the Mac, mode 600, never in git); `sudo box-proxy on|off|status|test` starts it and routes system-Docker pulls through `http://127.0.0.1:10809` (SOCKS on 10808). Do not turn it off. Git on the box uses HTTPS through the proxy (`gh config set git_protocol https && gh auth setup-git`); SSH egress to GitHub is blocked for `mahanfilms`.
- **Data disk:** the 1 TB HDD was wiped (owner approved) and is mounted at `/srv/data` (ext4, label `data`, 907 GB): `backups/`, `restore-drill/`, `qdrant-snapshots/`, `shared/`, `ci-artifacts/` and `ci-cache/` (runner), `phone/`.
- **CI runner:** GitHub runner 2.338 as user `runner`, **rootless Docker** (`DOCKER_HOST=unix:///run/user/1001/docker.sock`, not in the system `docker` group), persistent user service `actions-runner.service` (linger on), work dir `/srv/data/ci-cache/_work`, labels `self-hosted, Linux, X64, hp, linux-box`. `ci.yml` reaches it through the runner picker below (#949); the JIT pool (#1024) replaces it after two green runs. Ephemeral mode was dropped at first because it needed a long-lived registration credential on the box; JIT configs (#1024) avoid that.
- **Firewall:** ufw on, SSH only from 192.168.0.0/16. Automatic security updates on.
- **Box hub (Claude Code as `mahanfilms`):** no general sudo. `scripts/ops/ci_box/04_root_box_status.sh` (run once as root) installs a root-owned read-only `/usr/local/bin/box-status` (xray, docker, runner user service, disk, temperature, pending updates) and `/etc/sudoers.d/box-hub`, which allows only `sudo box-status`, `sudo box-proxy status` and `sudo box-proxy test`. The phone stack gets the same pattern later (a root-owned `phone-stack up|down|status|logs` wrapper, after #959).
- **Hub access:** Claude on the Mac cannot open LAN connections itself (macOS Local Network permission), so the hub runs SSH through the app's Terminal tab and reads results from files.

Setup scripts (no secrets): `scripts/ops/ci_box/` — root parts 01–03 (run with `sudo setsid bash … </dev/null >log 2>&1`; a piped `sudo … | tee` under `ssh -t` stops apt on Ubuntu 26.04), runner parts 10–11 as user `runner`.

## Runner selection (#949 T228, #1024 R20-8)
`ci.yml` starts with a `Pick runner` job on GitHub-hosted `ubuntu-slim`. It runs `scripts/ci/pick_runner.sh` (tests: `src/ops/test_pick_runner.py`) and gives every other job one of two slots:

| Slot | Jobs | Box labels (repo variable, default) |
|---|---|---|
| `light` | detect changes, gitleaks, Semgrep, OSV, Trivy, agent guards, ruff, undefined names, inventory, pytest, template check, migration lint, frontend gate | `CI_BOX_LABELS_LIGHT`, `["self-hosted","hp"]` |
| `docker` | compose, frontend build, backend + Postgres, TypeScript 7, template build, M1 gate, smoke + axe | `CI_BOX_LABELS_DOCKER`, `["self-hosted","hp"]` |

Repository variables (set with `gh variable set NAME -b VALUE -R Mahan-film/roxira-platform`):

| Variable | Values | Effect |
|---|---|---|
| `CI_RUNNER_MODE` | `hosted` (unset = hosted), `box`, `auto` | `hosted`: nothing changes. `box`: trusted events use the box labels and queue while it is busy or offline. `auto`: per slot, the box when `CI_BOX_HEARTBEAT` is under 5 min old and the slot has an online runner, else hosted. Age is measured at the event time (push, merge_group, pull_request), because `vars` are read when the run is created and a queued main run can start its picker 30+ min later; after 90 min (`MAX_WAIT`) and for schedule/dispatch the clock is used. |
| `CI_BOX_HEARTBEAT` | `<epoch> <light-online> <docker-online>` | written every ~2 min by the box (`jit_pool.py heartbeat`, #1024). |
| `CI_BOX_LABELS_LIGHT` / `CI_BOX_LABELS_DOCKER` | JSON label array that contains `"self-hosted"` | after #1024: `["self-hosted","jit","slot-light"]` and `["self-hosted","jit","slot-docker"]`. |
| `CI_HOSTED_RUNNER` | JSON string, default `"ubuntu-latest"` | the hosted fallback. |

Manual fallback: `gh workflow run ci.yml -R Mahan-film/roxira-platform --ref <branch> -f runner=hosted` (or `-f runner=box`).

Rules the picker enforces:
- Only `push`, `schedule`, `workflow_dispatch`, `merge_group` and `pull_request` from a branch of this repo can reach the box. A fork pull request always gets hosted runners. A fork PR runs its own copy of the workflow, so the real barrier is the repo setting "require approval for all external contributors" (on, checked 2026-11-21); after the flip only collaborators can open PRs.
- A busy box runner still counts as online: the job queues. Falling back on "busy" would spend the private-repo allowance on every overlap.
- The picker is `continue-on-error` and every `runs-on` ends in `|| '"ubuntu-latest"'`, so a broken picker never skips a required check (the merge gate treats `skipped` as green).
- Only `ci.yml` uses the picker. The other workflows keep `vars.CI_RUNS_ON || 'ubuntu-latest'`. **Never set `CI_RUNS_ON`**: it would send `deploy-prod.yml` (production key) and the `issues`, `issue_comment` and `pull_request_target` workflows to the box.
- Playwright installs system packages (`--with-deps`) only on hosted runners; the box gets them from the root script in #1024. Trivy installs into `$RUNNER_TEMP`, so no job needs root.
- `ci.yml` also runs nightly at 21:40 UTC with every change filter on; after the flip this replaces the merge queue's pre-merge run. `merge_group` stays until the flip; it never fires on a private Free repo.
- Semgrep CE is now a blocking check named `Semgrep CE (new findings)`: custom rules fail a PR only on findings it adds (`--baseline-commit`); `p/default` stays report-only.

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

## Remote local CI (#947 T227)
`LOCAL_CI_REMOTE=<ssh host> git push` (or `LOCAL_CI_REMOTE=<host> scripts/dev/local_ci.sh`) runs the pre-push checks on the box instead of the Mac: `scripts/dev/local_ci.sh` hands off to `scripts/dev/local_ci_remote.sh`, which

1. pushes the committed `HEAD` and the base commit over ssh into a bare repo on the box (`~/local-ci/roxira/repo.git`, set `LOCAL_CI_REMOTE_DIR` to change it);
2. makes a fresh detached worktree there and applies `git diff HEAD` (uncommitted edits to tracked files);
3. runs `local_ci.sh --base <that base>` there, streams the output and exits with the same code.

Untracked and ignored files (`.env`, keys, `node_modules`) never leave the Mac, which is why this is a git transfer and not an rsync of the worktree. Only `LOCAL_CI_SKIP_PYTEST`, `LOCAL_CI_NO_BOOTSTRAP` and `FRESH_DB_PORT` are passed through, after validation. Use the `runner` login (it has rootless Docker for the fresh-DB step): `LOCAL_CI_REMOTE=runner@roxira-ci FRESH_DB_PORT=<free port> git push`. Unset, nothing changes. Tests: `src/ops/test_local_ci_remote.py` (a fake `ssh` runs the remote side locally).

The nightly full run and the Playwright gates (M1, smoke + axe; the T168 #900 shards when they land) run on the box `docker` slot through the runner picker in `ci.yml` (#949, PR #1044), with the fork guard and the `workflow_dispatch` input `runner=hosted` as the offline fallback.

## Builders on the box
- **Antigravity (lanes L5–L7)** runs as `mahanfilms` in the owner's desktop session (`mahan`, launcher `/home/mahan/bin/rx-antigravity`, which runs `xhost +SI:localuser:mahanfilms` and then `sudo -u mahanfilms antigravity`). It needs `NODE_USE_ENV_PROXY=1`, `HTTP(S)_PROXY=http://127.0.0.1:10809` and `--proxy-server=http://127.0.0.1:10809`.
- **Gemini CLI = fallback builder:** `scripts/ops/ci_box/gemini_lanes.sh start|stop|status|attach|prompts` (tmux session `lanes`, windows L5–L7, auto-approve, 10 min restart wait, at most 6 restarts per lane per day). Start it only when the Antigravity quota is used up. Lanes refuse to run without `HTTPS_PROXY`. Prompts come from `docs/antigravity/prompts/L5..L7.txt` with `--agent gemini` and a box preamble. On the free API tier the CLI's default Flash model allows about 20 requests a day (checked 2026-11-19); `GEMINI_LANES_MODEL=<id>` chooses another Flash-class model, never Pro.

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
- Final hardening list (open, do not change yet): `mahanfilms` is in the system `docker` group, so its containers reach the internet directly and bypass the proxy.
- Final hardening list: user `phone` is also in the system `docker` group (root-equivalent); the phone stack should move to a production server or rootless Docker later.
- Until the repo is private: the runner serves only `push` to main, `merge_group`, `schedule` and `workflow_dispatch`; jobs carry a guard so a fork pull request never reaches it. After going private only collaborators can open PRs, but the guard stays.
- No production keys, no `~/Secrets`, no SSH key to `roxira-prod` on the box. The `docker` group is root-equivalent, which is accepted only because the box holds nothing of value.
- Tailscale is not needed: the runner only makes outbound connections to GitHub. Add it later only if SSH from outside the home network is wanted.

## Done when (workflow part: #947 T227, lane L1)
- `ssh roxira-ci` works from the Mac; `docker run hello-world` works as `runner`; `/srv/data` is mounted.
- `LOCAL_CI_REMOTE=roxira-ci git push` runs local CI on the box.
- The runner shows "Idle" in GitHub; CI, nightly M1 and T168 shards use `runs-on: [self-hosted, hp]`, with a fallback input to hosted runners when the box is offline.
- `sensors` stays below 90 °C during a full CI run.
