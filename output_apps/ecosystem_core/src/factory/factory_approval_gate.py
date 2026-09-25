#!/usr/bin/env python3
"""Project Factory stage 3 (approval): decide whether a comment/label event on
a brief issue means "start planning", and which stack option was chosen.

Run only from `.github/workflows/factory-plan.yml`, as the first step of the
job -- *after* that workflow's own `if:` has already checked
`vars.FACTORY_ENABLED == 'true'` and the actor allowlist (mirroring
agent-task.yml's job guard; see `src/factory_pipeline/allowlist.py`). This
script only decides *what the event means* (bare `/approve`, `/approve
<option>`, the `approved` label, or nothing) using the pure parser in
`src/factory_pipeline/commands.py`, and writes the result to
`$GITHUB_OUTPUT` so the rest of the job can branch on it. No GitHub call, no
side effect beyond that file write.

CLI:
    python3 factory_approval_gate.py --event-name issue_comment --comment-body "/approve Option B"
    python3 factory_approval_gate.py --event-name issues --label-name approved

Env:
    GITHUB_OUTPUT   Path GitHub Actions provides for step outputs. If unset
                    (e.g. run by hand), outputs are printed instead.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.factory_pipeline.commands import parse_approval_comment  # noqa: E402


def _write_outputs(values: dict[str, str]) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{key}={value}" for key, value in values.items()]
    if output_path:
        with open(output_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    else:
        for line in lines:
            print(line)


def decide(event_name: str, comment_body: str, label_name: str) -> dict[str, str]:
    """Pure decision logic, split out from `main()` for easy unit testing."""
    if event_name == "issue_comment":
        command = parse_approval_comment(comment_body)
        if command is None:
            return {"proceed": "false"}
        return {"proceed": "true", "option": command.option or ""}
    if event_name == "issues" and label_name.strip().lower() == "approved":
        return {"proceed": "true", "option": ""}
    return {"proceed": "false"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Project Factory stage 3 approval gate")
    ap.add_argument("--event-name", required=True, choices=["issue_comment", "issues"])
    ap.add_argument("--comment-body", default="")
    ap.add_argument("--label-name", default="")
    args = ap.parse_args(argv)

    outputs = decide(args.event_name, args.comment_body, args.label_name)
    _write_outputs(outputs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
