#!/usr/bin/env python3
"""DEPRECATED stub. The old sentinel returned a hardcoded finding list and wrote into the git checkout.

The real tech radar is scripts/ops/radar/radar.py (systemd: deploy/systemd/roxira-radar.timer). If an old
unit still calls this file it now does nothing and exits 0, so nothing is rewritten and no files are produced.
"""
import sys


def main() -> int:
    print("tech_radar_sentinel is retired: use scripts/ops/radar/radar.py (see docs/radar/README.md)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
