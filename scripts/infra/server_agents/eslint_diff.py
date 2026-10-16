#!/usr/bin/env python3
"""Compare two `eslint --format json` reports and report only NEW errors.

The workbench runs eslint twice on the changed lint-able files: once on the
agent's working tree and once after the base-branch versions have been copied
over the same paths. This module looks at the difference so that pre-existing
lint errors (already present on the base branch) do not fail an otherwise good
change.

An "error" is a message with severity 2; errors are counted per file and
ruleId. The current report fails only when some file has strictly more errors
for some ruleId than the base report. Files that do not appear in the base
report (new files) have a base count of zero, so any error in them is new.

Usage:
    python3 eslint_diff.py CURRENT.json BASE.json
Exit: 0 no new errors, 1 new errors found, 2 bad usage/unreadable report.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from typing import Iterable


def _rel(path: str) -> str:
    for prefix in ("/work/", "/base/"):
        if path.startswith(prefix):
            return path[len(prefix):]
    return path


def _counts(report) -> dict:
    """Map file path -> Counter(ruleId -> severity-2 count)."""
    out: dict = {}
    for entry in report or []:
        path = _rel(entry.get("filePath") or "")
        c = Counter()
        for msg in entry.get("messages") or []:
            if msg.get("severity") == 2:
                c[msg.get("ruleId") or "(unknown)"] += 1
        out[path] = c
    return out


def compare(current, base):
    """Return (new, pre).

    new is a sorted list of (file, rule, added_count) for every ruleId whose
    error count grew versus the base; pre is the number of pre-existing errors
    (present in the base report) that are still present in the current report.
    """
    cur = _counts(current)
    bas = _counts(base)
    new: list = []
    pre = 0
    for path, counts in cur.items():
        b = bas.get(path, Counter())
        for rule, n in counts.items():
            old = b.get(rule, 0)
            if n > old:
                new.append((path, rule, n - old))
            pre += min(n, old)
    new.sort()
    return new, pre


def report(new: Iterable, pre: int) -> str:
    new = list(new)
    if new:
        return "\n".join("new errors: %s:%s x %d" % (p, r, n) for p, r, n in new)
    return "no new errors (%d pre-existing)" % pre


def main(argv) -> int:
    if len(argv) != 3:
        sys.stderr.write("usage: eslint_diff.py CURRENT.json BASE.json\n")
        return 2
    try:
        with open(argv[1]) as fh:
            current = json.load(fh)
        with open(argv[2]) as fh:
            base = json.load(fh)
    except (OSError, ValueError) as exc:
        sys.stderr.write("eslint_diff: cannot read reports: %s\n" % exc)
        return 2
    new, pre = compare(current, base)
    sys.stdout.write(report(new, pre) + "\n")
    return 1 if new else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
