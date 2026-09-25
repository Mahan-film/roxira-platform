#!/usr/bin/env python3
"""Thin scheduled entrypoint for roxira-radar.timer (W9 live-run readiness).

Replaces output_apps/ecosystem_core/src/factory/tech_radar_sentinel.py, which
finishes in under a second with a hardcoded/canned finding list and writes
inside the git repo (TECH_RADAR_PROPOSALS.md,
output_apps/enterprise_hub/frontend/public/tech_radar_report.json) — the
autonomous daemon then `git add -A`s those files, the same daemon-commits-
to-main pattern W10 phase 1 already had to stop for other jobs.

This script instead:
  * runs the REAL src/automation/tech_radar.py pipeline (multilingual
    search -> crawl -> rerank -> tiered-LLM synthesis) against a fixed list
    of topics that match Roxira's actual architecture (docs/STRATEGY.md §2),
    not a hardcoded finding string;
  * writes every artifact OUTSIDE the git repo, under
    ROXIRA_RADAR_OUTPUT_DIR (default /opt/roxira_platform_reports/tech_radar/)
    — the same "reports live outside the repo" fix W10 phase 1 applied to the
    autonomous-dashboard report;
  * arms a --max-usd-equivalent budget guard so one scheduled run can't run
    away on spend;
  * exits non-zero when any topic's run is DEGRADED or FAILED, so
    `systemctl status roxira-radar.service` / `journalctl -u roxira-radar`
    actually reflect a bad run instead of the old sentinel's unconditional
    "success".

Run manually to test:
    python3 scripts/ops/roxira_radar_scheduled.py
    ROXIRA_RADAR_OUTPUT_DIR=/tmp/radar-test python3 scripts/ops/roxira_radar_scheduled.py

Must run where the pipeline's dependencies (httpx, the llm_router module
under output_apps/generated_modules/smartjudge/) are importable. Verified
2026-09-24: the production host's bare /usr/bin/python3 does NOT have httpx
installed, but the roxira_app_prod container's python3 does — see
docs/ops/roxira-radar.service, which execs into that container instead of
running on the host directly, and docs/research/LIVE_RUN.md.
"""

from __future__ import annotations

import asyncio
import logging
import os
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.automation.budget_guard import (  # noqa: E402
    BudgetGuard,
    BudgetGuardError,
    fetch_openrouter_usage,
)
from src.automation.llm_router_bridge import flush as flush_llm_usage  # noqa: E402
from src.automation.tech_radar import TechRadarAgent  # noqa: E402

logger = logging.getLogger("roxira.radar_scheduled")

# Outside the repo on purpose (see module docstring). Override for local
# testing so a manual run never writes into /opt/roxira_platform_reports.
OUTPUT_DIR = pathlib.Path(
    os.environ.get("ROXIRA_RADAR_OUTPUT_DIR", "/opt/roxira_platform_reports/tech_radar")
)

# Fixed topics matching the CURRENT architecture (docs/STRATEGY.md §2) —
# legal RAG core, enterprise API/UI stack, voice pipeline — replacing the old
# sentinel's hardcoded, never-updated finding list. Keep this short: each
# topic is one full search -> crawl -> rerank -> cheap-tier-synthesis pass.
TOPICS = [
    "Persian legal RAG stack: Qdrant, LightRAG, PostgreSQL graph CTE "
    "production best practices 2026",
    "FastAPI + NestJS + Next.js enterprise SaaS architecture updates 2026",
    "Persian real-time voice assistant STT TTS latency optimization 2026",
]

# Owner cost discipline (docs/STRATEGY.md §3b): background research should
# spend cents, not dollars, per run. The Phase A baseline (docs/research/
# bakeoff.md §1) measured ~$0.02/topic on the cheap tier; 3 topics x a few
# runs/day leaves wide headroom under this cap while still aborting a run
# that goes wrong (e.g. a pricing regression on the configured model).
MAX_USD_PER_RUN = float(os.environ.get("ROXIRA_RADAR_MAX_USD", "0.50"))


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    budget_guard = BudgetGuard(max_usd=MAX_USD_PER_RUN, snapshot_fn=fetch_openrouter_usage)
    try:
        budget_guard.start()
    except BudgetGuardError as exc:
        logger.error("cannot arm budget guard; aborting scheduled run: %s", exc)
        return 1

    agent = TechRadarAgent(
        report_md=OUTPUT_DIR / "TECH_RADAR_REPORT.md",
        report_json=OUTPUT_DIR / "TECH_RADAR_REPORT.json",
        history_dir=OUTPUT_DIR / "history",
        report_lang="fa",
        budget_guard=budget_guard,
    )

    reports = []
    worst_status = "SUCCESS"
    for topic in TOPICS:
        report = agent.run(topic, deep=False, persist=True)
        reports.append(report)
        status = report.get("status", "FAILED")
        logger.info("topic=%r status=%s cost_usd=%.4f", topic, status, report.get("cost_usd", 0.0))
        if status == "FAILED":
            worst_status = "FAILED"
        elif status == "DEGRADED" and worst_status != "FAILED":
            worst_status = "DEGRADED"

    artifacts = agent.save_digest(reports, "ROXIRA Scheduled Tech Radar")
    logger.info("digest written: %s", artifacts["markdown"])
    logger.info("digest json:    %s", artifacts["json"])

    try:
        asyncio.run(flush_llm_usage())
    except Exception as exc:  # never let usage-log flushing fail the run
        logger.debug("usage log flush skipped: %s", exc)

    spent = budget_guard.spent_so_far()
    if spent is not None:
        logger.info("OpenRouter spend this run: $%.4f (cap $%.2f)", spent, MAX_USD_PER_RUN)

    logger.info("scheduled radar run finished: status=%s", worst_status)
    # Hard rule (owner brief, docs/research/bakeoff.md §1 finding 5): a
    # degraded/failed run must exit non-zero so systemd/journalctl show it as
    # a real failure, unlike the old sentinel's unconditional "success".
    return 0 if worst_status == "SUCCESS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
