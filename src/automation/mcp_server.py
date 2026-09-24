"""stdio MCP server for the ROXIRA tech-radar / project-brief pipeline (W9 Phase B, item 4).

Exposes three tools so *any other project* (a fresh repo Claude Code is
opened in) can research its own stack using this pipeline's OpenRouter
cheap/free budget, instead of spending Anthropic tokens on web research:

* ``research_project(idea)``   → runs project-brief mode, returns the markdown
  brief plus the path it was written to (``docs/research/briefs/<slug>.md``
  when run from this repo; the server's own ``ROXIRA_BRIEFS_DIR`` otherwise).
* ``radar_digest(topics)``     → runs one or more daily-radar topics and
  returns a merged digest, without touching the production cron's history
  directory unless explicitly asked to persist.
* ``compare_technologies(names, context)`` → a lightweight side-by-side
  comparison of 2+ named technologies for a given use case, reusing the same
  multilingual search → crawl → rerank → synthesize pipeline.

Run standalone:  ``python -m src.automation.mcp_server``
Add to Claude Code from any project:

    claude mcp add roxira-tech-radar -- \\
        python3 -m src.automation.mcp_server \\
        --directory /opt/roxira_platform

(``--directory`` is only needed if the current working directory is not the
roxira_platform checkout; the server does ``sys.path`` surgery itself, same
as tech_radar.py, so it can be launched from anywhere once pointed at the
repo root via ``ROXIRA_PROJECT_ROOT`` or ``--directory``.)

Requires the optional ``mcp`` dependency:  ``pip install mcp`` (or
``uv pip install -e ".[research-mcp]"`` from the repo root).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_mcp():
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit(
            "The 'mcp' package is not installed. Run `pip install mcp` (or "
            "`uv pip install -e \".[research-mcp]\"` from the repo root) before "
            "starting this server."
        ) from exc
    return FastMCP


def build_server():
    FastMCP = _load_mcp()
    mcp = FastMCP(
        "roxira-tech-radar",
        instructions=(
            "Research a new project's technology stack, get a daily tech-radar "
            "digest, or compare named technologies — all synthesized through "
            "ROXIRA's own OpenRouter cheap/free-tier budget, never Anthropic tokens."
        ),
    )

    @mcp.tool()
    def research_project(idea: str, multilingual: bool = True) -> str:
        """Run project-brief mode for one new-project idea and return the
        generated Persian/English markdown brief (per-layer stack
        recommendations: UI/UX, frontend, backend, infra/server,
        database/SQL, AI models, observability, security, cost)."""
        from src.automation.project_brief import run_project_brief

        result = run_project_brief(idea, multilingual=multilingual)
        summary = (
            f"status={result['status']} cost_usd={result['total_cost_usd']} "
            f"elapsed_seconds={result['elapsed_seconds']} written_to={result['markdown_path']}\n\n"
        )
        return summary + pathlib.Path(result["markdown_path"]).read_text(encoding="utf-8")

    @mcp.tool()
    def radar_digest(topics: list[str], deep: bool = False, title: str = "Ad-hoc Technology Digest") -> str:
        """Run one or more daily-radar-style topics and return a merged
        Persian-language markdown digest. Does not touch the production
        cron's history directory; runs with --no-save semantics."""
        from src.automation.tech_radar import TechRadarAgent

        agent = TechRadarAgent()
        reports = [agent.research(topic, deep=deep) for topic in topics]
        digest = agent.build_digest(reports, title)
        statuses = {r.get("status") for r in reports}
        note = "" if statuses == {"SUCCESS"} else f"\n\n> هشدار: وضعیت‌های این اجرا: {sorted(statuses)}"
        return digest["markdown"] + note

    @mcp.tool()
    def compare_technologies(names: list[str], context: str = "") -> str:
        """Compare 2+ named technologies for an optional use-case context,
        using the same multilingual sourcing/synthesis pipeline as
        daily-radar. Returns a Persian-language markdown comparison."""
        from src.automation.tech_radar import TechRadarAgent

        if len(names) < 2:
            return "حداقل دو فناوری برای مقایسه لازم است."
        topic = f"compare {' vs '.join(names)}" + (f" for {context}" if context else "")
        agent = TechRadarAgent()
        report = agent.research(topic, deep=True)
        return report.get("markdown", json.dumps(report, ensure_ascii=False))

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="roxira-tech-radar-mcp")
    parser.add_argument(
        "--directory",
        help="Repo root to chdir into before serving (defaults to this file's own repo root).",
    )
    args = parser.parse_args(argv)
    if args.directory:
        os.chdir(args.directory)

    server = build_server()
    server.run()


if __name__ == "__main__":
    main()
