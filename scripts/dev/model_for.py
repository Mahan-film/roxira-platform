#!/usr/bin/env python3
"""Print the primary model id for a config/models.yaml role (single source of truth).

Usage: python3 scripts/dev/model_for.py <role> [--prefix openrouter] [--all]
  --prefix P   print P/<id> (OpenCode provider/model form), e.g. openrouter/deepseek/...
  --all        print every id of the role, one per line (primary first)
Roles: executor, mechanical, free, cheap, reviewer, ... (see config/models.yaml).
Exit 2 on unknown role / empty role. Prints no secrets.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "output_apps" / "generated_modules" / "smartjudge"))

import model_registry  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("role")
    ap.add_argument("--prefix", default="")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    try:
        ids = model_registry.role_models(args.role)
    except Exception as exc:  # unknown role / unreadable registry
        print(f"model_for: {exc}", file=sys.stderr)
        return 2
    if not ids:
        print(f"model_for: role {args.role!r} has no models", file=sys.stderr)
        return 2
    for mid in ids if args.all else ids[:1]:
        print(f"{args.prefix}/{mid}" if args.prefix else mid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
