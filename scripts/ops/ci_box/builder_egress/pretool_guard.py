#!/usr/bin/env python3
"""Claude Code PreToolUse hook for builder agents (R20-6, issue #1022). Stdlib only.

Reads the hook JSON on stdin. Exit 2 (stderr is shown to the agent) when the tool call would:
  - run `git push` (a publisher pushes, builders do not), or `git remote add/set-url`
  - post to GitHub with a bare `gh` (pr/issue/release writes, `gh api` writes): use gh_redact.py
  - write or edit a file under .github/workflows/, or run npm/pnpm/yarn install without --ignore-scripts
  - send text that contains a secret shape (redact.findings) in a Bash command, so it never reaches a shell history/log
Otherwise exit 0. Wire it in the builder's Claude settings (docs/ops/BUILDER_EGRESS.md). This is a guard rail
against mistakes, not a sandbox: the network lock (roxira_builder.nft) and the absence of tokens are the real controls.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from redact import findings  # noqa: E402

PUSH = re.compile(r"\bgit\b[^|;&]*\bpush\b")
REMOTE = re.compile(r"\bgit\b[^|;&]*\bremote\s+(add|set-url)\b")
GH_WRITE = re.compile(r"(?:^|[|;&]\s*|\s)gh\s+(?:(?:pr|issue|release)\s+(?:comment|create|edit|review|ready|merge|close)\b"
                      r"|api\b[^|;&]*(?:-X|--method|-f|-F|--field|--input))")
INSTALL = re.compile(r"\b(npm|pnpm|yarn)\s+(install|i|add|ci)\b")
WORKFLOW = re.compile(r"(^|/)\.github/workflows/")


def decide(payload: dict) -> str | None:
    """Return a refusal reason, or None to allow."""
    tool = payload.get("tool_name", "")
    inp = payload.get("tool_input") or {}
    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        path = str(inp.get("file_path") or inp.get("notebook_path") or "")
        if WORKFLOW.search(path):
            return "editing .github/workflows is not allowed for builders; ask the owner"
        return None
    if tool != "Bash":
        return None
    cmd = str(inp.get("command") or "")
    if PUSH.search(cmd):
        return "git push is not allowed for builders: commit locally, the publisher pushes"
    if REMOTE.search(cmd):
        return "changing git remotes is not allowed for builders"
    if GH_WRITE.search(cmd) and "gh_redact.py" not in cmd:
        return "post to GitHub only through scripts/ops/ci_box/builder_egress/gh_redact.py"
    if INSTALL.search(cmd) and "--ignore-scripts" not in cmd and "NPM_CONFIG_IGNORE_SCRIPTS" not in cmd:
        return "dependency installs need --ignore-scripts; new dependencies need human review"
    if ".github/workflows" in cmd and re.search(r"(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b)", cmd):
        return "writing under .github/workflows is not allowed for builders"
    kinds = [k for k in findings(cmd) if k in ("key", "pem", "secret", "urlcred")]
    if kinds:
        return "the command contains secret-shaped text (" + ", ".join(kinds) + "); remove it"
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        print("pretool_guard: unreadable hook input, refusing", file=sys.stderr)
        return 2
    reason = decide(payload)
    if reason:
        print(f"BLOCKED: {reason}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
