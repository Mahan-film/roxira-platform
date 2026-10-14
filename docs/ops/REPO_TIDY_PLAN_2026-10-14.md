# Repo tidy plan (dry-run) — repo root + `docs/`

Date: 2026-10-14. **Dry-run only: nothing was moved or deleted.** This document is the
proposal and the evidence; execution is a separate, owner-approved PR.

Scope: files **directly in the repo root** (52) and files **directly in `docs/`** (36),
sub-folders excluded.

Method: every `Referenced by?` cell comes from `grep` over `Dockerfile*`,
`docker-compose*.yml` (root + `output_apps/`, `docker/research-stack/`,
`services/research/`, `scripts/infra/key_pool/`, `templates/preview/`),
`deploy/systemd/*`, `scripts/**`, `src/**`, `output_apps/**`, `.github/**`, `pyproject.toml`,
`CLAUDE.md`, `AGENTS.md`, `docs/STATE.md`, `docs/SYSTEM_MAP.md`, and the cron lines in
`docs/ops` (`grep -i cron` → `scripts/auto_backup_daemon.sh`, `scripts/run_periodic_crawler.py`,
`scripts/daily_tech_scout.sh`). No `Makefile` exists in the repo.

Known server cron/systemd consumers were also grepped and are listed as references:
`src/legal_intelligence/agent_mesh_daemon.py`, `src/legal_intelligence/ekhtebar_*.py`
(`ekhtebar_crawler.py`), `src/legal_intelligence/legal_ver*.py` (`legal_verifier_daemon.py`),
`src/legal_intelligence/swarm_qa_worker.py`, `src/legal_intelligence/seo_dispatcher.py`,
`src/marketing_intelligence/run_daily_campaign.sh`, `scripts/run_periodic_crawler.py`,
`scripts/daily_tech_scout.sh`. They consume only `src/`/`scripts/` modules
(`scripts/legal_data_ingestor.py`, `src/automation/tech_radar.py`, `.env`, the sitemap path)
and reference **none** of the scoped root/`docs/` files.

Rules applied: `safe-to-move = yes` only when (a) the file is historical/wave/one-off (not a
canonical doc or live code) **and** (b) nothing references it. Documentation-only mentions in
retained docs (e.g. `docs/owner/TRACK_F_FA.md`, `docs/factory/FACTORY_AUDIT_2026-10-12.md`)
are noted but do not by themselves block a move; a link from a **retained** doc does.
Never proposed for moving: `AGENTS.md`, `CLAUDE.md`, `README*`, `LICENSE`, `pyproject.toml`,
`docker-compose*.yml`, `Dockerfile*`, `.env.example`, `docs/STATE.md`, `docs/SYSTEM_MAP.md`,
`docs/STRATEGY.md`, anything under `data/`.

## Root files

| path | category | referenced by? | proposed destination | safe-to-move |
| --- | --- | --- | --- | --- |
| `.dockerignore` | config (live) | docker build (implicit) | keep | no — build input |
| `.gitignore` | config (live) | git (implicit) | keep | no — VCS config |
| `.gitleaks.toml` | config (live) | `.github/workflows/ci.yml:99-121`; `scripts/dev/local_ci.sh:117` | keep | no — secret-scan config |
| `.mcp.json` | config (live) | `scripts/ci/check_mcp_allowlist.py:21`; `src/ops/test_check_mcp_allowlist.py:24`; `docs/SYSTEM_MAP.md:130` | keep | no — checked by CI |
| `.sops.yaml.example` | config (live) | `docs/ops/SECRETS_SOPS.md:16,85` | keep | no — secrets runbook template |
| `AGENTS.md` | canonical-doc | read by agents; protected | keep | no — protected |
| `CLAUDE.md` | canonical-doc | protected; links STATE/SYSTEM_MAP/PARALLEL_CHATS | keep | no — protected |
| `README.md` | canonical-doc | protected | keep | no — protected |
| `SECURITY.md` | canonical-doc | repo security policy (GitHub convention) | keep | no — repo policy |
| `pyproject.toml` | config (live) | protected; package metadata | keep | no — protected |
| `Dockerfile.prod` | live-code | protected | keep | no — protected |
| `docker-compose.prod.yml` | live-code | protected | keep | no — protected |
| `docker-compose.modern-stack.yml` | live-code | protected; `scripts/ops/backup/restore.sh:74`, `scripts/ops/backup/server_backup.sh:273`, `docs/ops/TWENTY_HARDENING.md` | keep | no — protected |
| `run_unified_server.py` | live-code | `Dockerfile.prod:59,71`; `docker-compose.prod.yml:17`; `src/automation/preflight_audit.py:83`; `docs/SYSTEM_MAP.md:58` | keep | no — app entrypoint |
| `factory_dispatch_api.py` | live-code | `docs/infra/INFRA_MAP_2026-10-09.md:61,133,364` (server `roxira-dispatcher.service`); port 8005 reserved in `AGENTS.md` §7 | keep | no — server dispatcher (port 8005) |
| `factory_engine.py` | live-code | `docs/owner/TRACK_F_FA.md:89` ("do not touch"); legacy factory docs; imports `src/`/`output_apps/` modules | keep | no — flagged do-not-touch, legacy factory dependency |
| `autonomous_master_daemon.py` | historical-code | `docs/AGENTS_WORKFORCE.md:15`; `docs/SECURITY_daemon_worker_review.md:20,124`; `docs/ops/RESILIENCE.md:97` (`roxira-autodaemon.timer`); `CLAUDE.md:8` / `docs/SYSTEM_MAP.md:44` ("a server daemon pushes to main every ~30 min") | keep | no — described as a live server timer; re-check on server first |
| `task_queue.json` | live-state | `output_apps/ecosystem_core/src/factory/task_worker.py:29`; `.../roxira_factory_engine.py:146`; `.../backlog_auto_feeder.py:8` | keep | no — factory queue state |
| `nginx.conf` | canonical-doc | `scripts/gen_system_inventory.py:21`; `scripts/ops/backup/server_backup.sh:276,467,502`; `src/automation/preflight_audit.py`; `src/legal_intelligence/deploy_production_nginx_proxy.py:106`; `docs/SYSTEM_MAP.md:14` | keep | no — referenced by tooling/skills |
| `nginx_split.conf` | canonical-doc | `scripts/gen_system_inventory.py:22`; `scripts/ops/backup/server_backup.sh:276`; `docs/SYSTEM_MAP.md:12,14` | keep | no — referenced by tooling/skills |
| `TECH_RADAR_REPORT.md` | live-code (data) | `docker-compose.prod.yml:273`; `scripts/ops/prep_backend_mounts.sh:29`; `scripts/ops/roxira_radar_scheduled.py:100`; `src/automation/tech_radar.py:39,225`; `.github/workflows/ci.yml:12` | keep | no — bind-mounted + written by radar |
| `TECH_RADAR_REPORT.json` | live-code (data) | `docker-compose.prod.yml:274`; `scripts/ops/prep_backend_mounts.sh:29`; `src/automation/tech_radar.py:40`; `.github/workflows/ci.yml:11` | keep | no — bind-mounted + written by radar |
| `TECH_RADAR_PROPOSALS.md` | historical-doc | `docs/ops/roxira-radar.service:13`; `scripts/ops/roxira_radar_scheduled.py:6` (both describe the retired radar output) | `docs/archive/reports/` | no — named in the `docs/ops` radar unit; keep until the radar swap is confirmed |
| `SYSTEM_STATUS.md` | historical-doc | `src/ops/test_export_public.py:57` (export-test fixture path) | `docs/archive/reports/` | no — appears in an export-test fixture |
| `SYSTEM_STATE_HANDOVER.md` | historical-doc | none found | `archive/handover/` | yes |
| `LATEST_AI_HANDOVER.md` | historical-doc | none found | `archive/handover/` | yes |
| `repomix.config.json` | config (live) | implicit (repomix auto-loads from cwd); `scripts/dev/pack_agent_context.sh` runs repomix | keep | no — implicit config for repomix |
| `last_email_digest.html` | historical-doc | none found | `docs/archive/reports/` | yes |
| `get-pip.py` | one-off-script | none found (2 MB bootstrap copy) | `archive/root_scripts/` | yes |
| `launch_agents.sh` | one-off-script | `docs/AGENTS_WORKFORCE.md:18` (interactive menu only) | `archive/root_scripts/` | yes |
| `watchdog_nightly.sh` | one-off-script | none found | `archive/root_scripts/` | yes |
| `context_guard.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `apply_2026_modern_pipeline.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `audit_system_state.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `auto_migrate_db.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `auto_system_journalist.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `autonomous_agent_factory.py` | one-off-script | none found (only descriptive audit docs) | `archive/root_scripts/` | yes |
| `autonomous_agent_watcher.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `batch_build_all_modules.py` | one-off-script | none found (`roxira_factory_core` import target not in repo) | `archive/root_scripts/` | yes |
| `bulk_legal_ingestion.py` | one-off-script | only a passing Persian comment in `scripts/legal_data_ingestor.py:19` (not a reference) | `archive/root_scripts/` | yes |
| `chaos_swarm_orchestrator.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `comprehensive_system_audit.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `generate_handover.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `ingest_full_precedents.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `inject_latest_precedents_2026.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `master_autonomous_runner.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `master_swarm_orchestrator.py` | one-off-script | `docs/AGENTS_WORKFORCE.md:17` (manual only, not on a timer) | `archive/root_scripts/` | yes |
| `migrate_with_db_detection.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `openrouter_agent_bridge.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `populate_empty_collections.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `sync_qdrant_fixed.py` | one-off-script | none found | `archive/root_scripts/` | yes |
| `sync_qdrant_rest.py` | one-off-script | none found | `archive/root_scripts/` | yes |

## `docs/` files (direct only)

| path | category | referenced by? | proposed destination | safe-to-move |
| --- | --- | --- | --- | --- |
| `AGENTS_WORKFORCE.md` | canonical-doc | `output_apps/ecosystem_core/src/factory/task_worker.py:6`, `agent_runner.py:4,46,839`, `factory_plan.py:37`, `cost_ledger.py:206`, `factory_dispatch_next.py:14`; `.github/workflows/agent-task.yml:7,130`, `factory-plan.yml:31`, `factory-build.yml:8` | keep | no — cited by factory code + workflows |
| `AUDIT_2026-09-28.md` | historical-doc | none found | `docs/archive/reports/` | yes |
| `DEPS_AUDIT_2026-09.md` | historical-doc | none found | `docs/archive/reports/` | yes |
| `E2E.md` | canonical-doc | documents `.github/workflows/e2e-smoke.yml` (no explicit link) | keep | no — current operational doc |
| `HANDOFF_2026-10-04.md` | historical-doc | `docs/STATE.md:1` | `docs/archive/handover/` (proposed) | no — linked from retained `STATE.md` |
| `HISTORY_REWRITE.md` | historical-doc | `docs/STRATEGY_GAP_2026-10-12.md:92`; `docs/owner/TRACK_C_FA.md` | `docs/archive/reports/` | no — linked from retained `STRATEGY_GAP` |
| `LAWYER_ANSWERS_2026-09-30.md` | canonical-doc (legal) | `docs/STATE.md:9`; `docs/decisions/ADR-2026-10-12-ekhtebar-sole-source.md:10`; `docs/legal/LAWYER_REVIEW_GATE_HUB_NOTES.md:50` | keep | no — cited by STATE/ADR |
| `LAWYER_QUESTIONS_FA.md` | historical-doc | `docs/LAWYER_ANSWERS_2026-09-30.md:4` | `docs/archive/reports/` | no — linked from retained `LAWYER_ANSWERS` |
| `LAWYER_QUESTIONS_ROUND2_FA.md` | historical-doc | `docs/LAWYER_ANSWERS_2026-09-30.md:4` | `docs/archive/reports/` | no — linked from retained `LAWYER_ANSWERS` |
| `LEGAL_COVERAGE_MANIFEST.md` | canonical-doc (generated) | `scripts/legal_coverage_report.py:6,35`; `docs/SYSTEM_MAP.md:166` | keep | no — generated, linked from SYSTEM_MAP |
| `LEGAL_COVERAGE_ROADMAP.md` | canonical-doc | `docs/SYSTEM_MAP.md:165`; `docs/OWNER_GUIDE_FA.md:41`; `docs/W25_phase1_acquisition.md:3` | keep | no — canonical |
| `LEGAL_RESEARCH_2026-09-30.md` | historical-doc | none found (only the wildcard `LEGAL_RESEARCH_*` in `docs/STRATEGY_GAP` scope) | `docs/archive/reports/` | yes |
| `LEGAL_RESEARCH_ROUND2_2026-09-30.md` | historical-doc | none found | `docs/archive/reports/` | yes |
| `OPERATIONS_RUNBOOK.md` | canonical-doc | `.github/workflows/deploy-prod.yml:14`; `src/ops/test_export_public.py:60` | keep | no — cited by deploy workflow |
| `OWNER_GUIDE_FA.md` | canonical-doc | `docs/SYSTEM_MAP.md:16` | keep | no — linked from retained SYSTEM_MAP |
| `OWNER_MASTER_OVERVIEW_FA.md` | canonical-doc | `docs/STRATEGY_GAP_2026-10-12.md:3` (scope) | keep | no — owner overview |
| `PARALLEL_CHATS.md` | canonical-doc | `CLAUDE.md:5`; `docs/STRATEGY.md:130` | keep | no — linked from CLAUDE.md |
| `PROJECT_FACTORY.md` | canonical-doc | `src/factory_pipeline/__init__.py:11`; `output_apps/ecosystem_core/src/factory/factory_plan.py:38`; `.github/workflows/factory-plan.yml:6`, `factory-research.yml:10`, `project-pages.yml:7` | keep | no — cited by code + workflows |
| `SECURITY_daemon_worker_review.md` | canonical-doc | `docs/AGENTS_WORKFORCE.md:26,94` | keep | no — linked from retained AGENTS_WORKFORCE |
| `STATE.md` | canonical-doc | protected | keep | no — protected |
| `STRATEGY.md` | canonical-doc | protected | keep | no — protected |
| `STRATEGY_GAP_2026-10-12.md` | canonical-doc | `docs/STATE.md:1` | keep | no — current backlog, linked from STATE |
| `SYSTEM_INVENTORY.generated.md` | canonical-doc (generated) | `scripts/gen_system_inventory.py:2,17`; `.github/workflows/ci.yml:243`; `docs/SYSTEM_MAP.md:4` | keep | no — generated, CI-checked |
| `SYSTEM_MAP.md` | canonical-doc | protected | keep | no — protected |
| `W15_stt_plan.md` | canonical-doc (wave) | `scripts/stt_bench.py:6`; `docs/ops/STT_BENCH.md:7`; `docs/research/STT_PERSIAN_RESEARCH_2026-10.md:17,134` | keep | no — cited by scripts/docs |
| `W17_payment_audit.md` | canonical-doc (wave) | `output_apps/generated_modules/smartjudge/smartjudge_module.py:11` | keep | no — cited by code |
| `W17_payment_fix.md` | canonical-doc (wave) | `output_apps/ecosystem_core/src/billing/payment_service.py:230` | keep | no — cited by code |
| `W18_design_audit.md` | historical-doc (wave) | none found | `docs/archive/waves/` | yes |
| `W19_site_qa.md` | historical-doc (wave) | none found | `docs/archive/waves/` | yes |
| `W20_realtime_voice.md` | canonical-doc (wave) | `output_apps/ecosystem_core/src/factory/gemini_live_bridge.py:2,13,16,51`, `smartjudge_live_voice.py:69`; `src/factory/test_gemini_live_bridge.py:10`; `docs/SYSTEM_MAP.md:75` | keep | no — cited by code |
| `W25_phase1_acquisition.md` | canonical-doc (wave) | `docs/SYSTEM_MAP.md:167` | keep | no — linked from retained SYSTEM_MAP |
| `W6_citation_guard_v2_check.md` | historical-doc (wave) | none found | `docs/archive/waves/` | yes |
| `W6_legal_corpus_diagnosis.md` | canonical-doc (wave) | `scripts/w6_cheque_law_v2.py:13`; `scripts/w6_ingest_dotic.py:11,16`; `src/legal_intelligence/test_w6_dotic_ingest.py:6`; `docs/STRATEGY.md:119,146`; `docs/LEGAL_COVERAGE_ROADMAP.md:21`; `docs/ops/RESTORE_DRILL.md:220` | keep | no — cited by scripts |
| `W7_voice_latency.md` | canonical-doc (wave) | `scripts/voice_latency_bench.py:2,27,189`; `output_apps/ecosystem_core/src/factory/smartjudge_live_voice.py:59`, `persian_text.py:1,25`; `docs/W20_realtime_voice.md:72` | keep | no — cited by scripts/code |
| `plan.md` | canonical-doc | `docs/decisions/0001-record-architecture-decisions.md:35`; `docs/AUDIT_2026-09-28.md:21`; `docs/progress.md:3` | keep | no — process doc |
| `progress.md` | canonical-doc | `docs/PARALLEL_CHATS.md:36,37`; `docs/STRATEGY.md:89`; `docs/plan.md:12`; `docs/decisions/0001...:35` | keep | no — process log |

## Counts

- Rows total: **88** (root 52, `docs/` 36).
- Safe-to-move **yes**: **34**
  - `archive/root_scripts/`: **24** (21 stray root `.py`, plus `get-pip.py`, `launch_agents.sh`, `watchdog_nightly.sh`)
  - `archive/handover/`: **2**
  - `docs/archive/reports/`: **5**
  - `docs/archive/waves/`: **3**
- Safe-to-move **no**: **54** (all protected files, live code/config, and 7 historical docs still linked from retained docs).

## `git mv` command list (safe items only)

```bash
# 1) create the destination directories (none of the four exist yet)
mkdir -p archive/root_scripts archive/handover docs/archive/waves docs/archive/reports

# 2) root scripts -> archive/root_scripts/  (24)
git mv apply_2026_modern_pipeline.py archive/root_scripts/
git mv audit_system_state.py archive/root_scripts/
git mv auto_migrate_db.py archive/root_scripts/
git mv auto_system_journalist.py archive/root_scripts/
git mv autonomous_agent_factory.py archive/root_scripts/
git mv autonomous_agent_watcher.py archive/root_scripts/
git mv batch_build_all_modules.py archive/root_scripts/
git mv bulk_legal_ingestion.py archive/root_scripts/
git mv chaos_swarm_orchestrator.py archive/root_scripts/
git mv comprehensive_system_audit.py archive/root_scripts/
git mv context_guard.py archive/root_scripts/
git mv generate_handover.py archive/root_scripts/
git mv ingest_full_precedents.py archive/root_scripts/
git mv inject_latest_precedents_2026.py archive/root_scripts/
git mv master_autonomous_runner.py archive/root_scripts/
git mv master_swarm_orchestrator.py archive/root_scripts/
git mv migrate_with_db_detection.py archive/root_scripts/
git mv openrouter_agent_bridge.py archive/root_scripts/
git mv populate_empty_collections.py archive/root_scripts/
git mv sync_qdrant_fixed.py archive/root_scripts/
git mv sync_qdrant_rest.py archive/root_scripts/
git mv get-pip.py archive/root_scripts/
git mv launch_agents.sh archive/root_scripts/
git mv watchdog_nightly.sh archive/root_scripts/

# 3) handovers -> archive/handover/  (2)
git mv LATEST_AI_HANDOVER.md archive/handover/
git mv SYSTEM_STATE_HANDOVER.md archive/handover/

# 4) reports -> docs/archive/reports/  (5)
git mv AUDIT_2026-09-28.md docs/archive/reports/
git mv DEPS_AUDIT_2026-09.md docs/archive/reports/
git mv LEGAL_RESEARCH_2026-09-30.md docs/archive/reports/
git mv LEGAL_RESEARCH_ROUND2_2026-09-30.md docs/archive/reports/
git mv last_email_digest.html docs/archive/reports/

# 5) wave notes -> docs/archive/waves/  (3)
git mv W18_design_audit.md docs/archive/waves/
git mv W19_site_qa.md docs/archive/waves/
git mv W6_citation_guard_v2_check.md docs/archive/waves/
```

## Notes / before executing

- Re-check on the server (read-only) that `autonomous_master_daemon.py` still runs before
  ever considering it; it is excluded here because `docs/AGENTS_WORKFORCE.md`,
  `docs/SECURITY_daemon_worker_review.md` and `docs/ops/RESILIENCE.md` describe it as the
  `roxira-autodaemon.timer` on the prod host.
- `factory_dispatch_api.py` and `factory_engine.py` are deliberately excluded
  (`docs/infra/INFRA_MAP_2026-10-09.md` shows a live `roxira-dispatcher.service`;
  `docs/owner/TRACK_F_FA.md` marks both do-not-touch).
- Moving any doc that is linked from a retained doc (the "no" rows) would create broken
  links; if those links are updated in the same PR, re-run the grep to re-confirm.
