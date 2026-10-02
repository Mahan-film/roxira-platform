"""Static safety checker for GitHub Actions workflows.

Rules: pwn-request, missing-permissions, script-injection, gh-without-repo.
Findings look like "<file name>:<job>: <rule>: <message>" and can be listed
one per line in a baseline file (lines starting with '#' are comments).
"""
import argparse
import re
import sys
from pathlib import Path
from typing import Any, List, Optional, Set

import yaml

UNTRUSTED_FIELDS = [
    "github.event.pull_request.title",
    "github.event.pull_request.body",
    "github.event.pull_request.head.ref",
    "github.event.pull_request.head.label",
    "github.event.issue.title",
    "github.event.issue.body",
    "github.event.comment.body",
    "github.event.review.body",
    "github.head_ref",
    "github.event.workflow_run.head_branch",
    "github.event.workflow_run.head_commit.message",
]

GH_CALL = re.compile(r"\bgh\s+(pr|issue|run|api|release|repo|workflow)\b")
GH_REPO_CONTEXT = re.compile(
    r"GH_REPO|--repo\b|(?<!\S)-R\s|GITHUB_REPOSITORY|github\.repository"
)


def _is_checkout(step: Any) -> bool:
    return isinstance(step, dict) and str(step.get("uses", "")).startswith("actions/checkout@")


def _triggers(workflow: dict) -> Set[str]:
    # PyYAML (YAML 1.1) parses the bare key `on` as boolean True.
    raw = workflow.get("on", workflow.get(True))
    if isinstance(raw, str):
        return {raw}
    if isinstance(raw, list):
        return {str(x) for x in raw}
    if isinstance(raw, dict):
        return {str(x) for x in raw}
    return set()


class WorkflowSafetyChecker:
    def __init__(self, baseline_file: Optional[str] = None):
        self.baseline_findings: Set[str] = set()
        if baseline_file:
            with open(baseline_file, "r", encoding="utf-8") as f:
                self.baseline_findings = {
                    line.strip()
                    for line in f
                    if line.strip() and not line.lstrip().startswith("#")
                }

    def check_workflow(self, workflow_path: Path) -> List[str]:
        workflow_path = Path(workflow_path)
        with open(workflow_path, "r", encoding="utf-8") as f:
            workflow = yaml.safe_load(f)
        if not isinstance(workflow, dict):
            return []

        name = workflow_path.name
        jobs = workflow.get("jobs") or {}
        found: List[str] = []

        def add(job_name: str, rule: str, message: str) -> None:
            finding = f"{name}:{job_name}: {rule}: {message}"
            if finding not in self.baseline_findings and finding not in found:
                found.append(finding)

        is_prt = "pull_request_target" in _triggers(workflow)

        for job_name, job in jobs.items():
            if not isinstance(job, dict):
                continue
            steps = [s for s in (job.get("steps") or []) if isinstance(s, dict)]
            has_checkout = any(_is_checkout(s) for s in steps)

            # pwn-request: pull_request_target checking out PR-controlled code
            if is_prt:
                for step in steps:
                    if _is_checkout(step):
                        ref = str((step.get("with") or {}).get("ref") or "")
                        if "github.event.pull_request.head" in ref or "github.head_ref" in ref:
                            add(job_name, "pwn-request",
                                "pull_request_target with untrusted checkout ref")

            # missing permissions
            if "permissions" not in workflow and "permissions" not in job:
                add(job_name, "missing-permissions",
                    "workflow and job have no permissions")

            for step in steps:
                run_cmd = step.get("run")
                if not isinstance(run_cmd, str):
                    continue
                # script injection
                if "${{" in run_cmd and any(f in run_cmd for f in UNTRUSTED_FIELDS):
                    add(job_name, "script-injection",
                        "untrusted field in run command")
                # gh without repo context (no checkout => no git remote)
                if (not has_checkout and GH_CALL.search(run_cmd)
                        and not GH_REPO_CONTEXT.search(run_cmd)
                        and not GH_REPO_CONTEXT.search(
                            str((step.get("env") or {})) + str(job.get("env") or {})
                            + str(workflow.get("env") or {}))):
                    add(job_name, "gh-without-repo",
                        "gh command without repo context")

        return found

    def check_directory(self, directory: Path) -> List[str]:
        findings: List[str] = []
        files = sorted(list(directory.glob("*.yml")) + list(directory.glob("*.yaml")))
        for workflow_file in files:
            findings.extend(self.check_workflow(workflow_file))
        return findings


def main() -> None:
    parser = argparse.ArgumentParser(description="Check GitHub workflows for safety issues.")
    parser.add_argument("--report-only", action="store_true",
                        help="Only report findings, do not exit with error")
    parser.add_argument("--baseline", type=str, help="Path to baseline file of known findings")
    parser.add_argument("directory", nargs="?", default=".github/workflows",
                        help="Directory containing workflow files")
    args = parser.parse_args()

    checker = WorkflowSafetyChecker(args.baseline)
    findings = checker.check_directory(Path(args.directory))
    for finding in findings:
        print(finding)
    if not args.report_only and findings:
        sys.exit(1)


if __name__ == "__main__":
    main()
