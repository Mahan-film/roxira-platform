# Linux CI box (owner's HP laptop)

Owner decision 2026-11-17: the HP laptop leaves Windows and becomes a headless Linux machine for CI/CD. No production data, no production secrets.

## Hardware and what it is good for
| Part | Value | Use |
|---|---|---|
| CPU | Intel Core i7-8550U, 4 cores / 8 threads, 15 W | one heavy CI job at a time (backend specs + Postgres/Redis containers + Playwright), or two light jobs |
| RAM | 24 GB DDR4 | Postgres + Redis + NestJS + Next.js build + Chromium fit together; TEI bge-m3 on CPU (~2–3 GB) for offline Smart Judge evals |
| GPU | Intel UHD 620 + NVIDIA MX130 (2 GB, Maxwell) | none for AI: too little memory and too old for current CUDA LLM stacks. Leave the NVIDIA card unused (no proprietary driver) to save heat and power |
| Cooling | owner-built | sustained load is fine; still cap the CPU at 90 °C with `thermald` |

Not a fit: running LLMs locally, production traffic, anything holding customer data.

## Jobs it takes over (in this order)
1. **Pre-push local CI off the Mac**: run `scripts/dev/local_ci.sh` on the box over SSH so the Mac stays free (the 20–30 min run moves; the Mac only waits for the result).
2. **Self-hosted GitHub Actions runner** (labels `self-hosted, linux, x64, hp`) for heavy jobs that today cannot run on free minutes: the nightly full M1 suite and the 4 Playwright shards of T168 (#900) in the merge queue.
3. **Weekly restore drill** (T198, now on the Mac) and the WAL-G point-in-time restore test (T204).
4. **Smart Judge offline evals** (T211 #925 replay benchmark, T212 #926 golden set) against a local TEI + Qdrant copy, so evals do not load production.

## Security rules (the repo is public)
- GitHub warns against self-hosted runners on public repos: a fork's pull request could run code on the machine. So: the runner only serves jobs triggered by `push` to main, `merge_group`, `schedule` and `workflow_dispatch`, never `pull_request` from forks (jobs add `if: github.event.pull_request == null || github.event.pull_request.head.repo.full_name == github.repository`). Keep "Require approval for all outside collaborators" on in repo Settings → Actions.
- Ephemeral runner: `./config.sh --ephemeral` inside a systemd loop, so every job starts from a clean runner state.
- The runner runs as user `runner` without sudo. It needs Docker for the test databases; Docker group equals root on this box, which is accepted only because the box holds nothing of value. No production keys, no `~/Secrets`, no SSH key to `roxira-prod` on the box.
- The runner registration token is created by the owner (repo admin) and pasted only into the box's terminal, never into chat.

## What the owner provides (no purchases needed)
1. A USB stick of at least 8 GB (it will be erased) and the laptop on AC power permanently.
2. Battery: on 24/7 AC power a battery can swell. In the BIOS, turn on the HP battery charge limit or care mode if the model has one; otherwise remove the battery if it is removable.
3. A stable connection to github.com, the same one the Mac uses (Ethernet preferred over Wi-Fi).
4. SSD size: at least 256 GB free (512 GB is better; Docker images + Playwright browsers + caches take ~60–80 GB).
5. Optional: a free Tailscale account for SSH from outside the home network; otherwise LAN-only SSH.

## Install steps (owner, about 30 minutes; the hub guides live)
1. Download **Ubuntu Server 24.04 LTS** (amd64) from ubuntu.com and write it to the USB with balenaEtcher or Rufus.
2. BIOS (F10 at power-on): Secure Boot may stay on; set "After power loss" → On; battery care on; boot from USB.
3. Installer: whole disk with LVM, hostname `roxira-ci`, user of the owner's choice, **install OpenSSH server**, no snaps.
4. After the first boot, read the IP with `ip -4 addr` and give it to the hub. From there the hub (from the Mac) or the owner pastes the setup commands below.

## Setup after install (the hub runs these over SSH once the owner has added the Mac's public key)
```bash
sudo apt update && sudo apt -y full-upgrade && sudo apt -y install git curl jq unzip build-essential thermald lm-sensors unattended-upgrades ufw
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/; s/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf && sudo systemctl restart systemd-logind
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp && sudo ufw enable
curl -fsSL https://get.docker.com | sudo sh   # Docker CE from Docker's own repository
sudo useradd -m -s /bin/bash runner && sudo usermod -aG docker runner
```
Then, as `runner`: Node 22 (nvm), Python 3.12, `npx playwright install --with-deps chromium`, clone the repo, and the GitHub runner per GitHub's "Add a self-hosted runner" page (Settings → Actions → Runners → New, Linux x64), with `--ephemeral --labels hp` and a systemd unit that re-registers after each job.

## Done when (workflow part: #947 T227, lane L1)
- `ssh roxira-ci` works from the Mac; `docker run hello-world` works as `runner`.
- `LOCAL_CI_REMOTE=roxira-ci git push` runs local CI on the box (new switch in `scripts/dev/local_ci.sh`, lane L1).
- The runner shows "Idle" in GitHub; the nightly M1 workflow and the T168 shards use `runs-on: [self-hosted, hp]`; a fork PR never reaches it.
- `sensors` stays below 90 °C during a full CI run.
