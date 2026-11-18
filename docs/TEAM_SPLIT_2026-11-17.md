# Team split from 2026-11-17

Two machines work in parallel on `Mahan-film/roxira-platform`. Both follow AGENTS.md, `docs/antigravity/LANE_PROMPT_FA.md` (v6) and the latest `## WAVE` comment on issue #592.

**Update 2026-11-18 (owner):** two machines, both driven by the owner. The Mac runs lanes L1–L4 and the main hub. The Linux box `roxira-ci` (`docs/ops/LINUX_CI_BOX.md`) runs lanes L5–L7, a second Claude Code session (the **box hub**, the owner's own Anthropic account under Linux user `mahanfilms`), the CI runner and the phone agent.

| Machine | Antigravity lanes | Claude Code | Owns |
|---|---|---|---|
| Mac | L1 ops/CI/infra · L2 frontend + currency · L3 security/data · L4 Smart Judge | **main hub**: strategy, research digests, WAVE posts, review routing, merges of L1–L4 and hub PRs, all production steps | product strategy and production |
| Linux box `roxira-ci` | L5 core ledger · L6 Germany pack, then Gulf · **L7 box + phone kit** (#956 → #949 → #947 → #951 → #959) | **box hub**: merges L5–L7 PRs after "no blocker"; brings the phone stack up under user `phone` and keeps it running; box upkeep (proxy, disk, runner, updates); never touches production | phone agent on the box, CI box |

The two hubs coordinate only through GitHub: issues, PRs and the latest `## WAVE` comment on #592. The main hub posts WAVEs for all seven lanes; the box hub posts box reports as comments on #592 with the prefix `BOX:`.

## Rules for both
- Each lane's queue is the GitHub issues labelled `lane:L<k>` (order in the latest `## WAVE` comment on #592). Claim on the issue with `bash scripts/dev/claim.sh <issue> --agent antigravity` (draft PR = lock); never take an issue labelled `in-progress`. Research rows carry `research-row` and a "Done when" spec; backlog issues are checked on origin/main first and closed with evidence if already done.
- WIP limit 3 open PRs per lane; at most 2 CI fix rounds, then post the hand-off block.
- Migration ids: above the newest on `origin/main` **and** every open PR (CI check `check_migration_ids.py --open-prs` enforces it); renumber on rebase.
- Shared files (permission matrix, `app.module.ts`, nav menu): append-only, alphabetical.
- Every PR gets a cross-family review (review desk: `gh workflow run review-desk.yml`, one dispatch without `-f pr` reviews all open PRs at their heads; per-PR dispatches cancel each other). No merge without "no blocker" on the current head.
- Merge only through the queue: `gh pr merge N --auto --squash`.
- The box hub reviews and merges only L5–L7 PRs; the main hub handles everything else and all production steps.
- Production: read-only for agents; never print environment variables or secrets (an agent did on 2026-11-17).

## Linux box setup (once)
1. **Claude Code (box hub):** on the laptop's own screen or `ssh mahanfilms@roxira-ci`, run `claude` and log in with the owner's Anthropic account (it prints a link: open it in any browser, paste the code back). Claude Code 2.1 is already installed for `mahanfilms`; `api.anthropic.com` works without the proxy.
2. **GitHub:** as `mahanfilms`, `gh auth login` with the owner's GitHub account, then `git clone https://github.com/Mahan-film/roxira-platform ~/roxira-platform`.
3. **Antigravity (lanes L5–L7):** needs a desktop session and the proxy (its sign-in and the Gemini API are blocked from this network without it). The box hub installs a light desktop (XFCE), sets `xray` to start at boot, and starts Antigravity with `--proxy-server=http://127.0.0.1:10809`. Then open three chats and paste `docs/antigravity/prompts/L5.txt`, `L6.txt`, `L7.txt`.
4. **First message to the box hub** (paste as is):

```
You are the BOX HUB for Mahan-film/roxira-platform on the Linux box roxira-ci (user mahanfilms).
Read first: docs/TEAM_SPLIT_2026-11-17.md, docs/ops/LINUX_CI_BOX.md, docs/ops/LAPTOP_HANDOFF_2026-11-18.md, AGENTS.md.
Your scope: (1) review routing and merges for lanes L5-L7 only (merge only with review-desk "no blocker" on the current head, gh pr merge N --auto --squash);
(2) bring the Smart Judge phone agent up under user phone: unpack ~phone/voice-ai-bundle.tar.gz and ~phone/voice-ai-agent.env (both mode 600, never print them),
use the deploy kit from #959 when it lands, user "phone" replaces "voice" in the handoff doc; (3) box upkeep: xray/box-proxy, /srv/data, the runner, updates.
Never touch production (ssh roxira-prod is the Mac hub's job). Never print env values or secrets. Reply to the owner in Persian; code and docs in English.
Post a short "BOX:" report on issue #592 after each step. The main hub on the Mac owns strategy, WAVEs and lanes L1-L4.
```

## Colleague setup (once)
1. `gh auth login` with an account that has write access to the repo; `git clone https://github.com/Mahan-film/roxira-platform && cd roxira-platform`.
2. Read `docs/AI_HANDOFF.md`, `docs/HANDOFF_2026-11-17.md`, this file, and `docs/strategy/INFRA_TARGET_2026-11-17.md`.
3. Antigravity: open two chats and paste `docs/antigravity/prompts/L5.txt` and `L6.txt` (one per chat).
4. Claude Code: start in the repo and say: "You are the hub for lanes L5/L6 per docs/TEAM_SPLIT_2026-11-17.md; review and merge only their PRs."
