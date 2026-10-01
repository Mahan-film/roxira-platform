"""Offline integrity checks for agent-facing documentation."""

from __future__ import annotations

import pathlib
import re


SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
)


def check(root: pathlib.Path) -> list[str]:
    """Return documentation integrity problems below *root*."""
    docs = root / "docs"
    problems: list[str] = []

    decisions = docs / "decisions"
    for path in sorted(decisions.glob("*.md")):
        lines = path.read_text(encoding="utf-8").splitlines()
        if not any(line.startswith("Status:") or "Status:" in line for line in lines[:6]):
            problems.append(f"{path.relative_to(root)}: missing Status: in first 6 lines")

    for name in ("STATE.md", "SYSTEM_MAP.md"):
        if not (docs / name).is_file():
            problems.append(f"docs/{name}: missing required file")

    for path in sorted(docs.rglob("*")):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                problems.append(f"{path.relative_to(root)}: possible secret matches {pattern.pattern}")

    return problems


def main() -> int:
    root = pathlib.Path(__file__).resolve().parents[1]
    problems = check(root)
    for problem in problems:
        print(problem)
    return int(bool(problems))


if __name__ == "__main__":
    raise SystemExit(main())
