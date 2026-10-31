#!/usr/bin/env python3
"""Fail when model ids are hardcoded outside config/ (AGENTS.md sections 3-4).

Model ids and prices live in config/models.yaml (and config/key_pool.yaml for
provider-native ids). Code reads them through
output_apps/generated_modules/smartjudge/model_registry.py. This check scans
tracked source files for quoted OpenRouter-style ids (``vendor/model``) and
compares the per-file count with scripts/ci/hardcoded_model_ids_baseline.txt:
a new file, or more ids than the baseline records, fails. Existing offenders
are grandfathered so they can be migrated one by one; lowering a count never
fails (run with ``--update`` to rewrite the baseline after a migration).

It prints paths and counts only, never file contents beyond the matched id.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = Path(__file__).with_name("hardcoded_model_ids_baseline.txt")

VENDORS = (
    "anthropic|deepseek|google|openai|qwen|meta-llama|nvidia|z-ai|moonshotai|"
    "mistralai|x-ai|minimax|inception|poolside|thinkingmachines|xiaomi|scaledown"
)
MODEL_ID_RE = re.compile(rf"""["'`]((?:{VENDORS})/[a-z0-9][a-z0-9._-]*(?::free)?)["'`]""", re.IGNORECASE)

SCAN_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".mjs", ".sh")
# Config is the source of truth; docs/archive/tests/fixtures may name ids freely.
SKIP_PREFIXES = ("config/", "docs/", "archive/", "e2e/", "backups/", "data/", "projects/")
SKIP_PARTS = ("node_modules/", "/tests/", "/__tests__/", "/fixtures/")
SKIP_NAMES = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*_test\.py|[^/]*\.(spec|test)\.[jt]sx?|conftest\.py)$")


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout
    return out.splitlines()


def in_scope(path: str) -> bool:
    return (
        path.endswith(SCAN_SUFFIXES)
        and not path.startswith(SKIP_PREFIXES)
        and not any(part in path for part in SKIP_PARTS)
        and not SKIP_NAMES.search(path)
    )


def count_ids(text: str) -> int:
    return len(MODEL_ID_RE.findall(text))


def scan(paths: list[str]) -> Counter:
    counts: Counter = Counter()
    for path in paths:
        if not in_scope(path):
            continue
        try:
            text = (ROOT / path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        n = count_ids(text)
        if n:
            counts[path] = n
    return counts


def load_baseline() -> dict[str, int]:
    baseline: dict[str, int] = {}
    if BASELINE.exists():
        for line in BASELINE.read_text().splitlines():
            if line.strip() and not line.startswith("#"):
                path, _, n = line.rpartition("\t")
                baseline[path] = int(n)
    return baseline


def write_baseline(counts: Counter) -> None:
    header = (
        "# Grandfathered hardcoded model ids (scripts/ci/check_hardcoded_model_ids.py).\n"
        "# path<TAB>count. Migrate a file to config/models.yaml, then run\n"
        "# `python3 scripts/ci/check_hardcoded_model_ids.py --update`. Never add entries by hand.\n"
    )
    BASELINE.write_text(header + "".join(f"{p}\t{n}\n" for p, n in sorted(counts.items())))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--update", action="store_true", help="rewrite the baseline to the current counts")
    args = ap.parse_args(argv)
    counts = scan(tracked_files())
    if args.update:
        write_baseline(counts)
        print(f"baseline updated: {len(counts)} files, {sum(counts.values())} ids")
        return 0
    baseline = load_baseline()
    bad = [(p, n, baseline.get(p, 0)) for p, n in sorted(counts.items()) if n > baseline.get(p, 0)]
    for path, n, allowed in bad:
        print(f"HARDCODED MODEL ID: {path}: {n} found, {allowed} allowed", file=sys.stderr)
    if bad:
        print(
            "Read ids from config/models.yaml via model_registry.role_models(<role>) instead "
            "(AGENTS.md section 3).",
            file=sys.stderr,
        )
        return 1
    print(f"ok: {sum(counts.values())} grandfathered ids in {len(counts)} files, none new")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
