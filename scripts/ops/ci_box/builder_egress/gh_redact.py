#!/usr/bin/env python3
"""Redacting front for `gh` (R20-6, issue #1022). Stdlib only.

Use instead of `gh` when a builder or the publisher posts text to GitHub:
  gh_redact.py pr comment 12 --body "text"      gh_redact.py issue comment 3 --body-file report.md
It runs every text argument (--body/-b, --title/-t, --body-file/-F, `-F -` stdin) through redact.py and then execs the
real gh (GH_BIN, default `gh`). Subcommands that cannot carry free text pass straight through. `gh api` is refused
unless it is a plain GET, because its fields are free-form.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from redact import redact  # noqa: E402

TEXT_FLAGS = {"--body", "-b", "--title", "-t", "--message", "-m", "--notes", "-n"}
FILE_FLAGS = {"--body-file", "-F"}
POSTING = {("pr", "comment"), ("pr", "create"), ("pr", "edit"), ("pr", "review"), ("pr", "ready"),
           ("issue", "comment"), ("issue", "create"), ("issue", "edit"), ("release", "create")}


def rewrite(args: list[str], tmpdir: str) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        flag, eq, val = a.partition("=")
        if flag in TEXT_FLAGS and eq:
            out.append(f"{flag}={redact(val)}")
        elif flag in TEXT_FLAGS and i + 1 < len(args):
            out += [a, redact(args[i + 1])]
            i += 1
        elif flag in FILE_FLAGS:
            src = val if eq else (args[i + 1] if i + 1 < len(args) else "")
            if not eq:
                i += 1
            text = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")
            clean = Path(tmpdir) / f"body{len(out)}.md"
            clean.write_text(redact(text), encoding="utf-8")
            out += [flag, str(clean)]
        else:
            out.append(a)
        i += 1
    return out


def main(argv: list[str]) -> int:
    args = argv[1:]
    gh = os.environ.get("GH_BIN", "gh")
    if args[:1] == ["api"] and any(x in ("-X", "--method", "-f", "-F", "--field", "--raw-field", "--input")
                                   or x.startswith("--method=") for x in args):
        print("gh_redact: `gh api` with a method or fields is refused; use pr/issue subcommands", file=sys.stderr)
        return 3
    if tuple(args[:2]) not in POSTING:
        return subprocess.call([gh, *args])
    with tempfile.TemporaryDirectory() as tmp:
        return subprocess.call([gh, *rewrite(args, tmp)])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
