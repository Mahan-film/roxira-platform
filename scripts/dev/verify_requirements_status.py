#!/usr/bin/env python3
"""Verify every cited path and done-row proof in docs/strategy/REQUIREMENTS_STATUS.md.

Checks:
1. Every backticked file/directory path in markdown tables exists on `<ref>` via
   `git cat-file -e <ref>:<path>`.
2. Every row marked `done` cites at least one test/spec file in its evidence.

Usage:
    python3 scripts/dev/verify_requirements_status.py
    python3 scripts/dev/verify_requirements_status.py --ref origin/main
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_DOC_PATH = Path("docs/strategy/REQUIREMENTS_STATUS.md")
CODE_DOC_EXTS = (".ts", ".tsx", ".py", ".md", ".sh", ".json", ".yml", ".yaml")
HTTP_PREFIXES = ("/", ".../", "http://", "https://", "GET ", "POST ", "PUT ", "PATCH ", "DELETE ")
NON_PATH_TOKENS = frozenset({"origin/main"})
TEST_FILE_RE = re.compile(r"(?:\.(?:pg\.spec|property\.spec|tenant\.spec|spec|test)\.(?:ts|tsx)|(?:^|/)test_[^/`]+\.py)$")


def is_repo_path_token(token: str) -> bool:
    """Return True if a backticked token looks like a repo file/directory path."""
    if not token or token in NON_PATH_TOKENS or token.startswith(HTTP_PREFIXES):
        return False
    if any(ch in token for ch in ("*", "{", "}", "<", ">", " ", "…", ":")):
        return False
    if token.endswith("..."):
        return False
    return "/" in token or token.endswith(CODE_DOC_EXTS)


def split_markdown_row(line: str) -> list[str]:
    """Split a markdown table row on unescaped `|` delimiters."""
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|") and not inner.endswith("\\|"):
        inner = inner[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", inner)]


def extract_table_path_tokens(text: str) -> list[tuple[int, str]]:
    """Return (line_number, token) pairs for backticked paths inside markdown tables."""
    found: list[tuple[int, str]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.startswith("| "):
            continue
        cols = split_markdown_row(line)
        if not cols or cols[0] in ("Code", "Item", "Stage", "Task") or set(cols[0]) == {"-"}:
            continue
        for token in re.findall(r"`([^`]+)`", line):
            if is_repo_path_token(token):
                found.append((line_no, token))
    return found


def batch_git_paths_exist(ref: str, repo_paths: list[str]) -> dict[str, bool]:
    """Verify via `git cat-file --batch-check` which `repo_paths` exist at `ref`."""
    unique = sorted({p for p in repo_paths if p.rstrip("/")})
    if not unique:
        return {}
    queries = "\n".join(f"{ref}:{p.rstrip('/')}" for p in unique) + "\n"
    res = subprocess.run(
        ["git", "cat-file", "--batch-check"],
        input=queries,
        text=True,
        capture_output=True,
        check=False,
    )
    if res.returncode != 0:
        return {p: git_path_exists(ref, p) for p in unique}
    lines = res.stdout.splitlines()
    results: dict[str, bool] = {}
    for p, line in zip(unique, lines):
        results[p] = not line.endswith(" missing")
    return results


def git_path_exists(ref: str, repo_path: str) -> bool:
    """Verify via `git cat-file -e` that `repo_path` exists at `ref`."""
    normalized = repo_path.rstrip("/")
    if not normalized:
        return False
    res = subprocess.run(
        ["git", "cat-file", "-e", f"{ref}:{normalized}"],
        capture_output=True,
        check=False,
    )
    return res.returncode == 0


def check_done_rows(text: str) -> list[str]:
    """Ensure every row marked `done` cites at least one test/spec path."""
    errors: list[str] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.startswith("| "):
            continue
        cols = split_markdown_row(line)
        if len(cols) < 4:
            continue
        key, status, evidence = cols[0], cols[2].lower(), cols[3]
        if key in ("Code", "Item", "Stage", "Task") or set(key) == {"-"}:
            continue
        if status.startswith("done"):
            tokens = re.findall(r"`([^`]+)`", evidence)
            if not any(TEST_FILE_RE.search(tok) for tok in tokens):
                errors.append(
                    f"L{line_no} ({key}): status is '{cols[2]}' but evidence cites no test/spec file"
                )
    return errors


def verify_document(doc_path: Path, ref: str) -> list[str]:
    """Run all path and done-row checks on `doc_path` against `ref`."""
    text = doc_path.read_text(encoding="utf-8")
    errors: list[str] = []
    tokens = extract_table_path_tokens(text)
    if getattr(git_path_exists, "__name__", "") != "git_path_exists":
        # Allow unit tests mocking git_path_exists directly.
        cache: dict[str, bool] = {}
        for _, token in tokens:
            if token not in cache:
                cache[token] = git_path_exists(ref, token)
    else:
        cache = batch_git_paths_exist(ref, [tok for _, tok in tokens])

    for line_no, token in tokens:
        if not cache.get(token, False):
            errors.append(f"{doc_path}:{line_no}: missing `{token}` on {ref}")

    errors.extend(check_done_rows(text))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify docs/strategy/REQUIREMENTS_STATUS.md against git ref")
    parser.add_argument("--doc", type=Path, default=DEFAULT_DOC_PATH, help="Path to REQUIREMENTS_STATUS.md")
    parser.add_argument("--ref", default="origin/main", help="Git ref to verify against (default: origin/main)")
    args = parser.parse_args(argv)

    errors = verify_document(args.doc, args.ref)
    if errors:
        for err in errors:
            print(err, file=sys.stderr)
        return 1
    print(f"OK: all cited paths and done-row specs in {args.doc} verified against {args.ref}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
