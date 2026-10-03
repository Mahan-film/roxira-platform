#!/usr/bin/env python3
"""Pin GitHub Actions ``uses:`` references to immutable commit SHAs.

Scans ``.github/workflows/*.yml`` for ``uses: owner/repo[/path]@ref`` where
``ref`` is still a mutable tag or branch. Each ``owner/repo@ref`` is resolved
to a 40-hex commit SHA through the injectable ``resolve`` function (by default
``gh api repos/<owner>/<repo>/commits/<ref> -q .sha``, which dereferences
annotated tags to the commit). The line is rewritten to::

    uses: owner/repo@<sha> # <ref>

Indentation and any pre-existing trailing comment are preserved. Local
(``./...``) and Docker (``docker://...``) references are left untouched.

The default is a dry run that prints a unified diff. Pass ``--apply`` to write
the files. The process exits 1 when any ref cannot be resolved, and the line
for that ref is not changed.
"""

from __future__ import annotations

import argparse
import difflib
import re
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import NamedTuple

SHA_RE = re.compile(r"[0-9a-fA-F]{40}")
USES_RE = re.compile(
    r"^(?P<lead>\s*(?:-\s+)?uses:\s+)(?P<action>\S+)(?:\s+(?P<comment>#.*?))?\s*$"
)

Resolver = Callable[[str, str], str]


class ResolutionError(RuntimeError):
    """Raised when a mutable ref cannot be resolved to a commit SHA."""


class RewriteResult(NamedTuple):
    """Outcome of rewriting one workflow document."""

    text: str
    changed: bool
    unresolved: tuple[str, ...]


def resolve(owner_repo: str, ref: str) -> str:
    """Resolve ``owner/repo@ref`` to a commit SHA using the GitHub CLI."""
    proc = subprocess.run(
        ["gh", "api", f"repos/{owner_repo}/commits/{ref}", "-q", ".sha"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or f"exit code {proc.returncode}"
        raise ResolutionError(f"could not resolve {owner_repo}@{ref}: {detail}")
    sha = proc.stdout.strip()
    if not SHA_RE.fullmatch(sha):
        raise ResolutionError(f"could not resolve {owner_repo}@{ref}: unexpected output")
    return sha


def _comment_text(comment: str | None) -> str:
    if not comment:
        return ""
    return comment.lstrip("#").strip()


def _is_pinnable(action: str) -> bool:
    if action.startswith("./") or action.startswith("docker://"):
        return False
    return "@" in action


def rewrite_text(text: str, resolve_fn: Resolver = resolve) -> RewriteResult:
    """Pin every mutable ``uses:`` reference in ``text``.

    ``resolve_fn(owner_repo, ref)`` returns the commit SHA. A ref that cannot be
    resolved is reported in ``unresolved`` and its line is left unchanged.
    """
    out: list[str] = []
    unresolved: list[str] = []
    cache: dict[str, str] = {}

    for raw in text.splitlines(keepends=True):
        body = raw.rstrip("\r\n")
        ending = raw[len(body) :]
        match = USES_RE.match(body)
        if match is None:
            out.append(raw)
            continue

        action = match.group("action")
        if not _is_pinnable(action):
            out.append(raw)
            continue

        owner_repo_path, _, ref = action.rpartition("@")
        if SHA_RE.fullmatch(ref):
            out.append(raw)
            continue

        owner_repo = "/".join(owner_repo_path.split("/")[:2])
        key = f"{owner_repo}@{ref}"
        sha = cache.get(key)
        if sha is None:
            try:
                sha = resolve_fn(owner_repo, ref)
            except ResolutionError:
                unresolved.append(key)
                out.append(raw)
                continue
            if not SHA_RE.fullmatch(sha):
                unresolved.append(key)
                out.append(raw)
                continue
            cache[key] = sha

        line = f"{match.group('lead')}{owner_repo_path}@{sha} # {ref}"
        comment = _comment_text(match.group("comment"))
        if comment:
            line = f"{line} {comment}"
        out.append(line + ending)

    new_text = "".join(out)
    return RewriteResult(new_text, new_text != text, tuple(unresolved))


def workflow_files(root: Path) -> list[Path]:
    """Return the sorted ``*.yml`` files directly under ``root``."""
    return sorted(root.glob("*.yml"))


def process_file(path: Path, resolve_fn: Resolver, apply: bool) -> tuple[bool, list[str]]:
    """Rewrite one workflow file; return ``(changed, unresolved)``."""
    original = path.read_text(encoding="utf-8")
    result = rewrite_text(original, resolve_fn)
    if result.changed:
        diff = difflib.unified_diff(
            original.splitlines(keepends=True),
            result.text.splitlines(keepends=True),
            fromfile=str(path),
            tofile=str(path),
        )
        print("".join(diff), end="")
        if apply:
            path.write_text(result.text, encoding="utf-8")
    return result.changed, list(result.unresolved)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=Path(".github/workflows"),
        help="directory containing workflow YAML files (default: .github/workflows)",
    )
    parser.add_argument("--apply", action="store_true", help="write the pinned files")
    args = parser.parse_args(argv)

    unresolved: list[str] = []
    for path in workflow_files(args.root):
        _, found = process_file(path, resolve, args.apply)
        unresolved.extend(found)

    if unresolved:
        for ref in sorted(set(unresolved)):
            print(f"unresolved: {ref}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
