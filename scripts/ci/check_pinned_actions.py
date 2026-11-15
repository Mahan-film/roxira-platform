#!/usr/bin/env python3
"""CI check: verify that all GitHub Actions uses: references are pinned to full commit SHAs.

Requirements enforced:
1. Every third-party action must be pinned to a 40-character hexadecimal commit SHA.
2. Every pinned action must include the version in a comment (e.g. # v7.0.1).
3. The top-level `permissions: contents: read` must be set for every workflow.
4. No workflow with `pull_request_target` may checkout untrusted PR code.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
USES_RE = re.compile(
    r"^(?P<lead>\s*(?:-\s+)?uses:\s+)(?P<action>\S+)(?:\s+(?P<comment>#.*?))?\s*$"
)


def is_third_party_action(action: str) -> bool:
    if action.startswith("./") or action.startswith("docker://"):
        return False
    return "@" in action


def check_workflow(path: Path) -> list[str]:
    errors: list[str] = []
    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()

    # 1. Top-level permissions check
    pre_jobs = content.split("jobs:")[0] if "jobs:" in content else content
    perm_match = re.search(r"^permissions:\s*([^\n]*)", pre_jobs, re.MULTILINE)
    if not perm_match:
        errors.append(f"{path.name}: missing top-level permissions block")
    else:
        # Check permissions block lines until next unindented block or empty line
        perm_text = pre_jobs[perm_match.start() :].split("\n\n")[0]
        perm_lines = [
            l.strip()
            for l in perm_text.splitlines()
            if l.strip() and not l.strip().startswith("#")
        ]
        if perm_lines != ["permissions:", "contents: read"]:
            errors.append(
                f"{path.name}: top-level permissions must strictly be 'contents: read' (found {perm_lines})"
            )

    # 2. Pinned actions check
    for line_num, line in enumerate(lines, 1):
        m = USES_RE.match(line)
        if not m:
            continue
        action = m.group("action")
        comment = m.group("comment") or ""

        if not is_third_party_action(action):
            continue

        owner_repo_path, _, ref = action.rpartition("@")
        if not SHA_RE.match(ref):
            errors.append(
                f"{path.name}:{line_num}: unpinned action '{action}' (must be a 40-character commit SHA)"
            )
        elif not comment.strip().startswith("#"):
            errors.append(
                f"{path.name}:{line_num}: action '{action}' missing version comment (e.g. # v7)"
            )

    # 3. pull_request_target checkout safety
    if "pull_request_target" in content:
        # Check each step: split by steps or find checkout step until next '-' at same or lower indent
        step_blocks = re.split(r"\n\s*-\s+", content)
        for block in step_blocks:
            if "uses: actions/checkout@" in block:
                if any(
                    unsafe in block
                    for unsafe in [
                        "github.event.pull_request.head",
                        "github.head_ref",
                    ]
                ):
                    errors.append(
                        f"{path.name}: pull_request_target workflow checks out untrusted PR head"
                    )

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=Path(".github/workflows"),
        help="Directory containing workflow files (default: .github/workflows)",
    )
    args = parser.parse_args(argv)

    workflows = sorted(args.root.glob("*.yml")) + sorted(args.root.glob("*.yaml"))
    if not workflows:
        print(f"No workflow files found in {args.root}")
        return 1

    all_errors: list[str] = []
    total_actions = 0

    for wf in workflows:
        errors = check_workflow(wf)
        all_errors.extend(errors)
        content = wf.read_text(encoding="utf-8")
        for line in content.splitlines():
            m = USES_RE.match(line)
            if m and is_third_party_action(m.group("action")):
                total_actions += 1

    if all_errors:
        print("FAILED: Found unpinned actions or workflow safety violations:")
        for err in all_errors:
            print(f"  - {err}")
        return 1

    print(
        f"OK: All {len(workflows)} workflows hardened; {total_actions} actions verified pinned to commit SHA."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
