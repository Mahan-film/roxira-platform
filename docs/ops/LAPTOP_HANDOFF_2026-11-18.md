# Laptop handoff before the Linux CI box (2026-11-18)

The HP laptop that becomes the Linux CI box (`LINUX_CI_BOX.md`) has been the Windows/WSL machine (`mahansudo`, agent `claude-win`) until now. This file records what ran there and how it comes back on Linux. No secrets, IP addresses or phone numbers belong here; the repo is public.

## Hardware, checked from Windows on 2026-11-18
| Part | Value |
|---|---|
| Model | **HP Laptop 15-da0xxx** (consumer family). In Part B use the **Consumer** column (Configuration / Boot Options tabs). |
| BIOS | F.36, dated 2021-02-03. Check support.hp.com for a newer BIOS for 15-da0xxx before erasing Windows. |
| CPU / RAM | i7-8550U, 24 GB |
| SSD | Samsung 980, 250 GB. The installer shows it as about **233 GB**, not 238. |
| HDD | Toshiba MQ04ABF100, 1 TB (about 932 GB). |
| Installer stick | A 15 GB Dahua USB stick is enough for Ventoy and the Ubuntu Server ISO. The external 1 TB SSD is optional. |

Why WSL kept closing: `%UserProfile%\.wslconfig` capped WSL at `memory=3800MB` with 12 GB swap, while the phone stack, Postgres and Node builds ran inside it. WSL hung on memory pressure (`Wsl/Service/WSAETIMEDOUT`). This goes away with native Linux.

## What ran on the laptop
- **Phone agent stack** (`~/voice-ai`), docker compose:
  - `lk-redis` (redis:7-alpine), `lk-server` (livekit-server), `lk-sip` (livekit/sip);
  - `lk-sabanet-bridge` (Asterisk, `asterisk/pjsip.conf`, `extensions.conf`) bridges the carrier line to LiveKit SIP.
  - Config files: `livekit.yaml`, `sip.yaml`, `inbound-trunk.json`, `dispatch-rule.json`. Three of them hold credentials and travel with the secrets, never through git.
- **Agent:** systemd units `voice-ai-agent` (Node, built from `services/voice_phone_agent`) and `voice-ai-tts` (edge-tts sidecar on 127.0.0.1:5055, Python venv). The repo copy of the agent is **newer** than the laptop's (T161 model registry), so rebuild from the repo, not from the laptop folder.
- **Proxy:** foreign AI APIs went through a proxy client on Windows at 127.0.0.1:10808. On Linux that client must be installed on the box itself. LiveKit/SIP and Smart Judge stay direct.
- Test Postgres `rx-pgspec` (port 55433) is disposable.
- Leftover worktrees under `~/Developer/roxira-wt`: every one belongs to a PR that is already merged. They were bundled (`git bundle` + patches) for the owner and are not needed in the repo.

## Moved to the owner's Mac (by hand, not through git)
- `~/Secrets/roxira/*`, `~/.ssh/*` (including the key for `roxira-prod`), `voice-ai/agent/.env`, and the voice config files with credentials.
- The laptop Claude's memory files and the owner's Desktop prompt files.

## Bringing the phone agent up on the box (after Part E)
1. Create a system user `voice` that is **not** in the `docker` group of the runner, with its own `~/voice-ai`. Restore the compose files and credentials there, mode 600.
2. Start the compose stack, then build `services/voice_phone_agent` from a fresh clone (`npm ci && npm run build`) and install the two systemd units under `voice`.
3. Install the proxy client and point `HTTPS_PROXY` only at the agent's foreign API calls, as before.
4. Test: one inbound call reaches the agent, STT and TTS answer, and the call ends cleanly. Check that `docker ps` shows the four containers after a reboot.

## Change to the CI box rules
`LINUX_CI_BOX.md` says the box holds no production secrets. **Owner decision 2026-11-18:** the phone line runs on the box too. Because the `docker` group is root-equivalent, the runner must not share the system Docker with the phone stack:
- the GitHub runner user uses **rootless Docker** (its own daemon, its own socket) and is not in the system `docker` group;
- the phone stack uses the system Docker under the `voice` user;
- runner jobs still accept only `push` to `main`, `merge_group`, `schedule` and `workflow_dispatch`, with the fork guard.

Long term, move the phone stack to a production server so that the box goes back to holding nothing of value.

## Closeout on the box (2026-11-20)
The handoff folder (without the two secret archives) was processed on `roxira-ci`:
- **Git leftovers:** all 18 branches in the bundle match merged PRs (#165, #283, #348, #474, #476, #494, #512, #513, #518, #526, #531, #532, #535, #566, #573, #574, #575, #591), either by exact head commit or by the same change on `main`. The 11 `.patch` files hold no code: nine are the `AGENTS.md` that `next dev` writes into `output_apps/enterprise_hub/frontend/`, one is a local `e2e/node_modules` symlink, one is two AI summary files for #565. Nothing was restored.
- **Claude memory:** still-valid notes were merged into the box hub memory; stale Windows/WSL paths and anything secret were dropped.
- **Desktop prompts:** the deep-research prompts of rounds 1 and 2 are now in `docs/strategy/DEEP_RESEARCH_ROUND1.md` and `DEEP_RESEARCH_ROUND2.md` (R18 was already in `DEEP_RESEARCH_ROUND4.md`). The Antigravity prompt copy (v4) and the strategy summary are superseded by `docs/antigravity/LANE_PROMPT_FA.md` (v6) and `docs/strategy/PRODUCT_RESET_2026-11-15.md`.
