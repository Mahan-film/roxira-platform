#!/usr/bin/env python3
"""Fail when a tracked path looks like a committed plaintext secret.

Scans the output of ``git ls-files`` only. It never prints file contents; it
reads an encrypted file solely to confirm a ``sops:`` marker is present.
``--report-only`` prints offending paths but always exits 0.
"""

from __future__ import annotations

import argparse
import subprocess
from collections.abc import Sequence
from fnmatch import fnmatch
from pathlib import Path

FORBIDDEN_GLOBS = ("*.pem", "*.key", "id_rsa*", "*.p12")
ENC_GLOB = "*.enc.*"
ENV_EXAMPLE = ".env.example"


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def is_forbidden(path: str) -> bool:
    """Return True when a tracked path must never be committed as plaintext."""
    name = _basename(path)
    if name == ".env":
        return True
    if name.startswith(".env.") and name != ENV_EXAMPLE:
        return True
    return any(fnmatch(name, pattern) for pattern in FORBIDDEN_GLOBS)


def _lacks_sops_marker(repo: Path, path: str) -> bool:
    try:
        return b"sops:" not in (repo / path).read_bytes()
    except OSError:
        return True


def list_tracked_files(repo: Path) -> list[str]:
    """Return tracked repo-relative paths from ``git ls-files``."""
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def check_repo(repo: Path) -> list[str]:
    """Return the sorted tracked paths that violate secret hygiene."""
    offenders: set[str] = set()
    for path in list_tracked_files(repo):
        if is_forbidden(path):
            offenders.add(path)
        elif fnmatch(_basename(path), ENC_GLOB) and _lacks_sops_marker(repo, path):
            offenders.add(path)
    return sorted(offenders)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", nargs="?", type=Path, default=Path("."))
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="print offending paths but always exit 0",
    )
    args = parser.parse_args(argv)
    offenders = check_repo(args.repo)
    for path in offenders:
        print(path)
    if offenders and not args.report_only:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
