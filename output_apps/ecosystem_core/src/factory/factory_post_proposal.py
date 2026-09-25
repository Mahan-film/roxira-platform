#!/usr/bin/env python3
"""Project Factory stage 2 (end): post the Persian stack proposal on the brief
issue and label it `proposal-ready`.

Run only from `.github/workflows/factory-research.yml`, right after
`python3 -m src.automation.tech_radar --project-brief ... --json` writes its
result JSON (the same payload shape `src.automation.project_brief.
run_project_brief()` returns: idea/slug/status/total_cost_usd/layers/final).
The formatting itself (2-3 options per layer, scores, cost, risks,
recommendation) is pure logic in `src/factory_pipeline/proposal.py`, unit
tested there with canned payloads; this script is the thin GitHub-posting
wrapper, reusing the GitHub REST helpers already written and tested for W10's
agent_runner.py instead of duplicating them (sibling import -- this file
lives in the same directory).

CLI:
    python3 factory_post_proposal.py --issue 42 --brief-json out/idea.result.json

Env:
    GITHUB_TOKEN   Required. The workflow's own token is enough (issues: write).
    GITHUB_REPO    Default: Mahan-film/roxira-platform (agent_runner.DEFAULT_REPO).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import agent_runner  # sibling module, see path insert above

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.factory_pipeline.proposal import format_proposal_comment  # noqa: E402

PROPOSAL_READY_LABEL = "proposal-ready"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Post the Persian Project Factory proposal comment")
    ap.add_argument("--issue", type=int, required=True)
    ap.add_argument("--brief-json", type=pathlib.Path, required=True)
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPO", agent_runner.DEFAULT_REPO))
    args = ap.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("GITHUB_TOKEN is not set; cannot post the proposal comment.")
        return 1

    try:
        brief_result = json.loads(args.brief_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        agent_runner.comment_on_issue(
            token,
            args.repo,
            args.issue,
            "تحقیق فناوری اجرا شد اما خروجی آن قابل خواندن نبود؛ لطفاً لاگ اجرای "
            f"Actions را بررسی کنید. جزئیات فنی: `{exc}`",
        )
        return 1

    comment = format_proposal_comment(brief_result)
    agent_runner.comment_on_issue(token, args.repo, args.issue, comment)
    agent_runner.add_labels(token, args.repo, args.issue, [PROPOSAL_READY_LABEL])

    result = {
        "status": "posted",
        "issue": args.issue,
        "brief_status": brief_result.get("status"),
        "cost_usd": brief_result.get("total_cost_usd"),
    }
    print(json.dumps(result))
    # A DEGRADED/FAILED research run still gets a (partial) proposal posted --
    # the owner should see whatever evidence exists rather than silence -- but
    # the job itself should surface as non-green so it doesn't read as a clean
    # success.
    return 0 if brief_result.get("status") == "SUCCESS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
