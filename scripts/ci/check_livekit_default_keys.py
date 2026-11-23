#!/usr/bin/env python3
"""Fail when a tracked file carries LiveKit's public dev API key pair (#1036).

The well-known dev pair must never ship in the repo or be an example value. The phone-stack installer
generates a random pair at install time instead (services/voice_phone_agent/deploy/livekit_keys.sh).
The literals are built from parts so this file does not trip itself.

Usage: check_livekit_default_keys.py [--root DIR]   (exit 1 and file:line list, no values, on a hit)
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

DEV_KEY = "dev" + "key"
DEV_SECRET = "sec" + "ret"
PATTERNS = (
    # the dev key name as a whole word, anywhere (yaml keys map, api_key: ..., env line, docs example)
    re.compile(rf"(?<![A-Za-z0-9_]){DEV_KEY}(?![A-Za-z0-9_])", re.I),
    # LIVEKIT_API_SECRET=<dev secret> / api_secret: <dev secret>
    re.compile(rf"api[_-]?secret\s*[:=]\s*[\"']?{DEV_SECRET}[\"']?\s*$", re.I),
)
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".woff", ".woff2", ".gz", ".zip", ".lock"}
SKIP_NAMES = {"package-lock.json"}


def tracked_files(root: Path) -> list[Path]:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=True
        ).stdout.decode("utf-8", "replace")
        return [root / p for p in out.split("\0") if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts]


def scan(root: Path) -> list[str]:
    hits: list[str] = []
    for path in tracked_files(root):
        if path.suffix.lower() in SKIP_SUFFIXES or path.name in SKIP_NAMES or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if any(p.search(line) for p in PATTERNS):
                hits.append(f"{path.relative_to(root)}:{n}")
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    hits = scan(Path(ap.parse_args().root))
    for h in hits:
        print(f"LiveKit dev key pair found at {h}")
    if hits:
        print("Replace it: the installer generates a random pair (phone-stack keys rotate).")
        return 1
    print("OK: no LiveKit dev key pair in tracked files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
