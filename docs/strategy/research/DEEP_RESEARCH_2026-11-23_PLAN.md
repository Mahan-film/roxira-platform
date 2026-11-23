# Deep research plan, box hub (2026-11-23)

Sources: owner deep research, Stage 1 (19 pages) and Stage 2 (2 pages, overrides Stage 1). Compared against `origin/main` (2e2e0fa7) and the open PR list on 2026-11-23. Version numbers, dates, CVE ids and acquisition claims in the research were NOT independently verified here; "verified?" below means "checked against our repo or primary knowledge", otherwise "no (research claim)". Earlier review of the previous report: `NEXT_GEN_INFRA_REVIEW.md`.

Deadline for "this week" is Thursday 2026-11-26. Owner column: Box = box hub, Mac = Mac hub, Owner = human owner.

## (1) Table

| # | Recommendation (Stage 2 wins) | Verified? | Status in repo / box | Owner | Priority |
|---|---|---|---|---|---|
| 1 | Ephemeral/JIT runners in rootless Docker, SHA-pinned actions, locked Runner Group, hosted minutes only for gate and outages | Repo part yes (87 SHA-pinned `uses:`, CI check); runner version no | Done: JIT pool live, `CI_RUNNER_MODE=auto`, old runner retired. Gap: container images pinned by digest not confirmed for the runner image; watchdog for stuck jobs not confirmed | Box | This week: image digest + watchdog check; private flip 2026-11-25 |
| 2 | Plan B: Woodpecker + Forgejo | No | Not started (docs mention only) | Box | 90 (exit plan, not needed now) |
| 3 | OpenHands + git worktrees, non-confidential work only | No | Not adopted by decision (`R20_DIGEST` D4: OpenHands not adopted; roxira-orch + worktrees exist) | Box | Reject for now, revisit if orch hits a limit |
| 4 | Sandbox: bubblewrap >= 0.11.2 from source, or gVisor, with egress allowlist; do not use the distro bubblewrap (CVE id unverified) | No | Builder egress allowlist exists (`BUILDER_EGRESS`); bubblewrap is used in places; version of the box bubblewrap not checked; gVisor not started | Box | This week: check version and decide |
| 5 | Remove production keys from laptop and CI | Principle yes | Partly done: PR #1305 (lane credential audit) open; lanes have no prod keys by design | Box | This week: land #1305 |
| 6 | Remove LiteLLM from production, use small in-house router | Compromise claim unverified; licence point (enterprise/ dir) is plausible | We run LiteLLM via `config/key_pool.yaml` + `render_litellm.py` on the box gateway; prod compose points `SMARTJUDGE_LLM_GATEWAY` at it; Smart Judge already has its own `llm_router.py` | Box (gateway), Mac (Smart Judge router is B1, hub-only) | This week: pin by digest and verify the version; 30: decision on removal |
| 7 | EU open-model fallback for CLOUD Act / sanctions | Reasoning yes | `LLM_FALLBACK.md`, `FALLBACK_CHAINS.md` exist; no EU open-model route | Box + Owner (EU server payment) | 30/60 |
| 8 | Qdrant 1.20, hybrid dense + bm25 via Prefetch, `tenant_id` filter in both branches | Design yes; version no | Prod pinned at v1.19.0; hybrid exists in Smart Judge retrieval (`test_retrieval_hybrid.py`); strict mode not set | Mac (retrieval code, B1), Box (image bump, strict mode) | 30 |
| 9 | Deterministic valid-from/valid-to law filter in Python | Reasoning yes | R25 bitemporal design exists; not confirmed in retrieval | Mac | 30 |
| 10 | Voice: livekit agents-js (Node), turn detection vad/stt, ElevenLabs v4 Turbo with `enable_logging=False` | Partly | Phone line live on LiveKit Agents (Node). TTS today is edge-tts sidecar via proxy, NOT OpenAI TTS, so the 2027-01-06 shutdown does not hit us. Turn-detection setting not checked | Box | 30: decide TTS vendor (cost $40/M chars) |
| 11 | Legal source crawling: changedetection.io + Crawlee + Shekar, licence review, rate limits | No | Own source watcher is merged (#1279 is MERGED, dry-run timer, not open as the task text said) | Box | 60 |
| 12 | OTel Collector first, defer Langfuse/ClickHouse/SigNoz | Agree | Not started; `OBSERVABILITY.md` exists | Box | 60 |
| 13 | restic (VPS) + Borg append-only to off-box target; offline keys; restore test | Tool facts plausible | restic local done; off-box copy not yet (code supports B2 and S3-compatible); Storage Box and Neon/Codeberg copies exist for prod DB (`OFFSITE_BACKUP.md`) | Box + Owner (payment, key custody) | This week: needs owner answer; then 30 |
| 14 | Full tenant export (DB + Qdrant + files), restore tested before 2027-01-12 | Deadline claim is blog-sourced | PR #1266 open, CLEAN | Mac (B1-adjacent data work) | This week: review and merge #1266 |
| 15 | Node 26 LTS | Yes (CI uses 26) | Done in CI; #1309 open for the rest | Box | This week: land #1309 |
| 16 | Python 3.14 | Plausible | CI and requires-python are 3.13; prod image still 3.11 | Box | 30: fix the 3.11 prod image first |
| 17 | PostgreSQL 17 or 18, "14 EOL is urgent" | Prod compose already `postgres:17` | Done for compose; check any remaining 14 hosts (old server decommission doc) | Box | This week: one grep/check, then close |
| 18 | Ubuntu 26.04 LTS | No | Box OS not checked in this pass | Box | 90 |
| 19 | German e-invoice (XRechnung/ZUGFeRD 2.0.1+), 8-year archive, before 2027-01-01 if turnover over 800k EUR | Law details blog-sourced | DE pack planned in `MAIN_HUB_MASTER_BRIEF`; tax rules are B1 hub-only | Mac + Owner (turnover answer) | 30, becomes urgent if owner says yes |
| 20 | Pin Actions/images by SHA/digest; supply-chain scanners in CI | Yes | Done (#1302, #1303 open for scanner tuning) | Box | This week: land #1302, #1303 |
| 21 | Valkey instead of Redis | Licence reasoning yes | PR #1158 (audit and pin) | Box | 30 |
| 22 | No sudo for automation, systemd units with NoNewPrivileges | Yes | Root runner fixed verbs installed; `ROOT_RUNNER.md` | Box | Done; confirm hardening flags in units, 30 |

## (2) Top 8 box-hub actions for this week (by Thursday 2026-11-26)

1. **Private flip readiness (S, 2h).** After the gate dry-run ends 12:55 UTC 2026-11-23, run the PRIVATE_FLIP_CHECKLIST items on the box and report. Acceptance: checklist every box item ticked, and the gate shows at least one real green pass on a PR from the JIT pool.
2. **Runner image and watchdog (S, 3h).** Confirm the runner container image is referenced by sha256 digest and add or verify a watchdog that kills a job stuck over the job timeout. Acceptance: `grep` shows a digest, and a synthetic sleeping job is killed within the limit.
3. **Sandbox version check (S, 1h).** Record the bubblewrap version used by lanes; if below 0.11.2 build from source or switch that lane to the gVisor runtime for a trial. Acceptance: `bwrap --version` output in the PR is 0.11.2 or higher, or a written decision to use runsc.
4. **Land the cheap hardening PRs (S, 2h of review time): #1305 (credential audit), #1302, #1303, #1309.** Acceptance: all four merged through the gate, and a grep for production keys in the lane homes returns nothing.
5. **LiteLLM pin and verify (S, 2h).** Pin the gateway image by digest, check the version is not v1.107.0, and write a one-page decision note on whether to keep it behind the key pool or replace it later. Acceptance: compose and render script reference a digest; note merged.
6. **Off-box restic copy (M, 4h, needs the owner answer 1).** Point the existing offbox support at the chosen destination, run one backup and one restore of a test directory. Acceptance: `restic check` clean and a restored file matches the original by sha256.
7. **Postgres 14 sweep (XS, 30 min).** Confirm no host or compose file still runs Postgres 14 or older (old server doc, test compose). Acceptance: grep for `postgres:14` and `postgres:1[0-3]` empty, and prod reports 17.
8. **Qdrant 1.20 and strict-mode prep (M, 4h).** In a branch, bump the pin from v1.19.0 to the verified release, enable strict mode on a test collection, run the tenancy tests. Acceptance: tenancy and hybrid tests green on the new image; no change to prod compose until the Mac hub OKs (collection layout audit #1300).

## (3) Items for the Mac hub

- Review and merge #1266 (full tenant export, verified restore) before 2027-01-12.
- Smart Judge retrieval (B1, hub only): confirm `tenant_id` filter sits inside both prefetch branches, add or confirm the deterministic valid_from/valid_to law filter in Python, and make a Persian and German golden set (50 to 100 questions, needs owner input).
- Smart Judge `llm_router.py`: decide if the in-house router in the research is already what we have; the box gateway question is separate.
- German e-invoice (XRechnung/ZUGFeRD 2.0.1+, mandatory fields in the XML, 8-year archive): tax and billing rules are hub-only; start now if the owner says turnover is over 800k EUR.
- Any Python 3.14 compatibility matrix job (heavy wheels such as torch and onnxruntime).

## (4) Owner questions (Persian)

1. آیا می‌توانید برای بکاپ بیرونی (Backblaze یا Hetzner Storage Box) و سرور اروپایی هزینه بدهید؟ یعنی کارت یا شرکتی خارج از ایران دارید که پرداخت از آن انجام شود؟ این یک تصمیم است و بدون آن بکاپ خارج از لپ‌تاپ را نمی‌توانم تمام کنم.
2. گردش مالی سال ۲۰۲۶ شرکت آلمانی بیشتر از ۸۰۰ هزار یورو بود؟ اگر بله، فاکتور الکترونیک آلمانی باید تا ۱ ژانویه ۲۰۲۷ آماده باشد؛ اگر نه، تا ۱ ژانویه ۲۰۲۸ وقت داریم.
3. کلید رمزگذاری بکاپ (restic و Borg) باید جایی بیرون از لپ‌تاپ و سرور نگه داشته شود، مثلاً روی کاغذ یا در گاوصندوق دو نفر. چه کسی نگه می‌دارد؟
4. خط تلفن (SIP) داخل ایران تحویل داده می‌شود یا می‌توانیم آن را مستقیم به سرور خارج از کشور وصل کنیم؟ این تعیین می‌کند Asterisk روی لپ‌تاپ بماند یا نه.
5. آیا مشتریان حقوقی شما اجازه می‌دهند داده‌هایشان روی سرویس‌هایی با شرکت مادر آمریکایی پردازش شود، یا فقط باید روی سرور اروپایی بماند؟ و برای ۵۰ تا ۱۰۰ سوال حقوقی واقعی و ۲۰ تماس ضبط‌شده برای تست، چه موقع می‌توانید بفرستید؟

## (5) What looks wrong or risky in the research

- **Stale or already-done items.** "Upgrade PostgreSQL 14 urgently": prod compose already runs 17. "Drop OpenAI TTS before 2027-01-06": our phone agent uses an edge-tts sidecar, not OpenAI TTS. Treat these as checks, not projects.
- **Stage 1 and Stage 2 disagree on LiteLLM, and neither claim is verified.** The v1.107.0 compromise and the licence-mix claim need a primary-source check. Our gateway already is LiteLLM; swapping it for a new in-house router adds code we must secure and test. Safer first step: pin by digest, keep it off any key that can reach production.
- **Unverifiable specifics.** CVE ids (CVE-2026-103916, CVE-2026-11940, CVE-2026-87766), "76 hijacked tags", acquisition dates (Langfuse, Promptfoo, Portkey), BMF circular date, and several version numbers (OpenHands v1.43.0 vs v1.20.0 differ between stages, Woodpecker 3.18.1 vs 3.20.1) are single-source or blog-level. No build should start on those numbers without a primary source.
- **Legal and sanctions exposure is the largest real risk.** Research states major US providers do not list the sanctioned region as supported and a proxy only changes the exit IP. That affects account suspension for all our LLM routes, and the voice and backup payment paths. This is an owner and lawyer decision; engineering can only prepare the EU open-model fallback.
- **Stage 2 limits OpenHands to non-confidential work, and the repo decided not to adopt it.** Do not build it for this reason alone.
- **ElevenLabs at about $40 per million characters** with an unconfirmed Persian quality edge (vendor claim only): run a Persian listening test and a cost estimate before replacing edge-tts, and note edge-tts is an unofficial service with its own availability risk.
- **Crawling terms.** The research notes robots.txt is not legal permission and Terms of Service bans matter. Our watcher uses public sources; a ToS review per source should precede enabling non-dry-run mode.
- **Single point of failure.** CI, crawling and the phone bridge all sit on one laptop; the 200 to 300 reserved hosted minutes advice is sensible and cheap, and should be written into the gate runbook.
- **Langfuse on the laptop** needs ClickHouse, Postgres, Valkey and S3; too heavy beside CI. Agree with Stage 2 to defer.
