#!/usr/bin/env python3
"""Print each fallback chain with steps marked ACTIVE / SKIPPED(no key).

Shows env var NAMES only, never values.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.ops_fallback.loader import load_config, step_status


def main() -> int:
    cfg = load_config()
    for name, chain in cfg["chains"].items():
        free = chain.get("allow_free_tier", True)
        print(f"{name}  (role={chain.get('role', '-')}, allow_free_tier={free})")
        for s in step_status(cfg, name):
            mark = "ACTIVE" if s["active"] else "SKIPPED(no key)"
            names = ", ".join(s["env"])
            print(f"  {s['step']:<10} {mark:<16} env: {names}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
