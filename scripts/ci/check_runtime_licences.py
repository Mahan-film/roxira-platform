#!/usr/bin/env python3
"""CI runtime licence gate (T252 / #991).

Scans runtime lockfiles (Node package-lock.json) and container/Python dependency
manifests for Smart Judge, voice, and core services. Fails on forbidden runtime
licences: GPL, AGPL, SSPL, RSAL, CC-BY-NC, ELv2 (Elastic-2.0), unless explicitly
listed in config/licence_allowlist.txt with a documented reason.

Usage:
  python3 scripts/ci/check_runtime_licences.py [--root <dir>] [--allowlist <file>]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

DEFAULT_LOCKFILES = [
    "output_apps/enterprise_hub/package-lock.json",
    "output_apps/enterprise_hub/frontend/package-lock.json",
    "services/voice_phone_agent/package-lock.json",
    "services/migration_worker/package-lock.json",
]

DEFAULT_DOCKERFILES = [
    "Dockerfile.prod",
    "output_apps/enterprise_hub/Dockerfile",
    "output_apps/enterprise_hub/frontend/Dockerfile",
    "services/research/Dockerfile",
    "docker-compose.prod.yml",
]

# Forbidden runtime licence patterns (case-insensitive, word-boundary aware).
# Note: LGPL is intentionally NOT matched by (?<![A-Z])GPL.
FORBIDDEN_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("AGPL", re.compile(r"\bAGPL(?:[-v ]?[0-9.]+)?", re.IGNORECASE)),
    ("GPL", re.compile(r"(?<![A-Z])GPL(?:[-v ]?[0-9.]+)?", re.IGNORECASE)),
    ("SSPL", re.compile(r"\bSSPL(?:[-v ]?[0-9.]+)?", re.IGNORECASE)),
    ("RSAL", re.compile(r"\bRSAL(?:v?[0-9.]+)?", re.IGNORECASE)),
    ("CC-BY-NC", re.compile(r"\bCC-BY-NC(?:-[A-Z0-9.]+)*", re.IGNORECASE)),
    ("ELv2", re.compile(r"\b(?:ELv2|Elastic-2\.0)\b", re.IGNORECASE)),
]

# Permissive licences that satisfy an SPDX "OR" dual-licence choice.
PERMISSIVE_RE = re.compile(
    r"\b(?:MIT|MIT-0|Apache-2\.0|BSD(?:-[0-9]-Clause)?|ISC|PostgreSQL|0BSD|Unlicense|CC0-1\.0|Zlib|Python-2\.0|BlueOak-1\.0\.0)\b",
    re.IGNORECASE,
)

# Known forbidden base images / packages when referenced in Dockerfiles or compose.
FORBIDDEN_IMAGE_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    ("redis:8+", "RSAL/SSPL/AGPL", re.compile(r"(?:image:\s*|FROM\s+)(?:docker\.io/library/)?redis:8(?:\.[0-9]+)?", re.IGNORECASE)),
]


def load_allowlist(path: pathlib.Path) -> set[str]:
    """Load allowlisted package keys (`pkg` or `pkg@licence`) from a text file."""
    allowed: set[str] = set()
    if not path.is_file():
        return allowed
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            allowed.add(line.lower())
    return allowed


def match_forbidden_licence(expr: str) -> str | None:
    """Return the first forbidden licence tag if expr requires a forbidden licence, else None.

    SPDX `OR` expressions (e.g. `(MIT OR GPL-2.0)`) are allowed if at least one
    branch is a permissive licence and has no `AND` binding a forbidden licence.
    """
    text = (expr or "").strip()
    if not text:
        return None
    # Split top-level OR branches (simple parenthesised or plain SPDX OR).
    cleaned = text.strip("()")
    if " OR " in cleaned and " AND " not in cleaned:
        branches = [b.strip("() ") for b in cleaned.split(" OR ")]
        if any(PERMISSIVE_RE.search(b) and not _raw_forbidden(b) for b in branches):
            return None
    return _raw_forbidden(text)


def _raw_forbidden(text: str) -> str | None:
    for tag, pat in FORBIDDEN_PATTERNS:
        if pat.search(text):
            return tag
    return None


def scan_npm_lockfile(lock_path: pathlib.Path, rel: str, allowlist: set[str]) -> list[str]:
    findings: list[str] = []
    if not lock_path.is_file():
        return findings
    data = json.loads(lock_path.read_text(encoding="utf-8"))
    packages = data.get("packages", {})
    for pkg_path, meta in packages.items():
        if not pkg_path or not isinstance(meta, dict):
            continue
        if meta.get("dev") is True:
            continue  # dev-only dependency; runtime gate only checks runtime deps
        lic = meta.get("license") or meta.get("licenses")
        if isinstance(lic, list):
            lic_str = " OR ".join(
                (item.get("type", "") if isinstance(item, dict) else str(item)) for item in lic
            )
        elif isinstance(lic, dict):
            lic_str = str(lic.get("type", ""))
        else:
            lic_str = str(lic or "")
        tag = match_forbidden_licence(lic_str)
        if not tag:
            continue
        pkg_name = pkg_path.split("node_modules/")[-1]
        if pkg_name.lower() in allowlist or f"{pkg_name}@{tag}".lower() in allowlist:
            continue
        findings.append(f"{rel}: runtime package `{pkg_name}` has forbidden licence `{lic_str}` (matched {tag})")
    return findings


def scan_docker_and_compose(root: pathlib.Path, rels: list[str], allowlist: set[str]) -> list[str]:
    findings: list[str] = []
    for rel in rels:
        p = root / rel
        if not p.is_file():
            continue
        for lineno, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for img_label, lic_label, pat in FORBIDDEN_IMAGE_PATTERNS:
                if pat.search(stripped):
                    if img_label.lower() in allowlist or f"{img_label}@{lic_label}".lower() in allowlist:
                        continue
                    findings.append(f"{rel}:{lineno}: forbidden runtime image `{img_label}` ({lic_label})")
    return findings


def run_scan(
    root: pathlib.Path,
    allowlist_path: pathlib.Path,
    lockfiles: list[str] | None = None,
    dockerfiles: list[str] | None = None,
) -> list[str]:
    allowlist = load_allowlist(allowlist_path)
    findings: list[str] = []
    for rel in lockfiles if lockfiles is not None else DEFAULT_LOCKFILES:
        findings.extend(scan_npm_lockfile(root / rel, rel, allowlist))
    findings.extend(scan_docker_and_compose(root, dockerfiles if dockerfiles is not None else DEFAULT_DOCKERFILES, allowlist))
    return findings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="CI runtime licence gate (T252)")
    ap.add_argument("--root", default=".", help="Repository root directory")
    ap.add_argument("--allowlist", default="config/licence_allowlist.txt", help="Allowlist file relative to root (or absolute)")
    args = ap.parse_args(argv)

    root = pathlib.Path(args.root).resolve()
    al_path = pathlib.Path(args.allowlist)
    if not al_path.is_absolute():
        al_path = root / al_path

    findings = run_scan(root, al_path)
    if findings:
        print(f"runtime licence gate: FAIL ({len(findings)} forbidden runtime dependency finding(s)):", file=sys.stderr)
        for f in findings:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("runtime licence gate: PASS (0 forbidden runtime dependencies found)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
