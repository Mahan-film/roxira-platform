---
name: project-ci-box-and-phone-stack
description: "HP laptop roxira-ci (Ubuntu 26.04, <ip>) = CI box + box hub (L5-L7) + phone host; users, proxy, sudo rules, SSH-from-Mac trick"
metadata:
  node_type: memory
  type: project
  originSessionId: cf07ce5b-aa34-4385-9e89-7531103e2c5b
  modified: 2026-11-20T12:43:09.184Z
---

HP Laptop 15-da0xxx (colleague mahansudo's machine) = `roxira-ci`, Ubuntu **26.04.1**. State 2026-11-19:

- Users: `mahan` (admin, NOPASSWD only for box-proxy), `runner` (rootless Docker, GitHub runner service), `mahanfilms` (owner/box-hub login, sudo with password, in `docker` group, nftables egress lock = only lo + LAN), `phone` (phone stack; `voice` is a system group).
- 1 TB HDD wiped, `/srv/data`. xray is **always ON** (owner rule: all agent traffic via proxy, split routing domestic direct). Docs still say "off by default" — box hub to fix.
- Box hub = Claude Code as `mahanfilms` in `~/roxira-platform`, gh logged in as **mahansudo**; first BOX: report on #592 on 2026-11-19. Gemini CLI 0.69 is installed only for `mahanfilms` (`~/.npm-global/bin`), not for `mahan`; Google sign-in failed once ("no longer supported for individuals") but then succeeded on 2026-11-19 — it works, via the proxy.
- 2026-11-19: Antigravity opens on the box but cannot sign in; L5-L7 move to **Gemini CLI lanes in tmux** (#965), box hub builds the runner. Gemini once gave "fetch failed" — Node fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1.
- Phone line: Asterisk `lk-sabanet-bridge` + LiveKit SIP; kit #959, root installer + `phone-stack` wrapper pattern.
- 2026-11-20: owner copied laptop_handoff (incl. 1_SECRETS tar with prod key) to mahan's Desktop on the box; hub told him to copy only 3/4/5+README to ~mahanfilms/handoff and shred the two secret archives. Owner paused commands pending R20 (two-machine strategy research; goal: owner never relays messages, hubs on timers). Hub verdict: core design right (GitHub queue, review desk, pull deploy, no prod keys on box) but owner is the relay bottleneck.
- Sudo policy: no blanket NOPASSWD for the agent user (would bypass the egress lock); give narrow root-owned wrapper scripts (box-status, later phone-stack) with a NOPASSWD line each.
- Hardening TODO: `mahanfilms` in `docker` group lets containers egress directly, bypassing the proxy/egress lock.
- Network: Docker Hub / download.docker.com / mirror.gcr.io blocked direct (403); GitHub, npm, PyPI, ghcr, quay, public.ecr.aws OK.
- Claude on the Mac gets "No route to host" to the LAN; run SSH via the app's Terminal tab, output to files in `.box/`.

Related: [[feedback-never-name-the-country]], [[project-two-github-accounts]].
