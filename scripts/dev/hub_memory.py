#!/usr/bin/env python3
"""Keep the hub's Claude memory in git so a new account or Mac user can continue.

export : copy ~/.claude/projects/<slug>/memory/*.md into docs/hub/memory/ (scrubbed:
         server/LAN IPs and phone numbers replaced; refuses if a key pattern is found).
restore: copy docs/hub/memory/*.md back into the memory folder of the current user
         (never overwrites a newer local file unless --force).

Usage:  python3 scripts/dev/hub_memory.py export|restore [--force]
The repo is public: export scrubs, but always read the diff before committing.
"""
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "hub" / "memory"
# The main checkout path decides Claude's project folder name (worktrees share it).
MAIN = Path(os.environ.get("ROXIRA_MAIN_CHECKOUT", str(REPO)))
if "/.claude/worktrees/" in str(MAIN):
    MAIN = Path(str(MAIN).split("/.claude/worktrees/")[0])
SLUG = re.sub(r"[/.]", "-", str(MAIN))
MEM = Path.home() / ".claude" / "projects" / SLUG / "memory"

KEEP_IPS = {"127.0.0.1", "0.0.0.0", "1.1.1.1"}
IP = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
PHONE = re.compile(r"(?:\+98|\b0)9\d{9}\b")
KEY = re.compile(
    r"(sk-ant-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|"
    r"gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|xai-[A-Za-z0-9]{20,}|tvly-[A-Za-z0-9-]{20,})"
)


def scrub(text: str) -> str:
    text = IP.sub(lambda m: m.group(0) if m.group(0) in KEEP_IPS else "<ip>", text)
    return PHONE.sub("<phone>", text)


def export() -> int:
    if not MEM.is_dir():
        print(f"no memory folder at {MEM}")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    bad = []
    for f in sorted(MEM.glob("*.md")):
        t = f.read_text(encoding="utf-8")
        if KEY.search(t):
            bad.append(f.name)
            continue
        (OUT / f.name).write_text(scrub(t), encoding="utf-8")
    if bad:
        print("REFUSED (key pattern found, fix these first):", ", ".join(bad))
        return 2
    print(f"exported {len(list(OUT.glob('*.md')))} files to {OUT.relative_to(REPO)}")
    return 0


def restore(force: bool) -> int:
    MEM.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted(OUT.glob("*.md")):
        dst = MEM / f.name
        if dst.exists() and not force and dst.stat().st_mtime > f.stat().st_mtime:
            continue
        dst.write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
        n += 1
    print(f"restored {n} files into {MEM}")
    print("Note: IPs and phone numbers are '<ip>'/'<phone>' in git; the real ones are in")
    print("~/.ssh/config (roxira-prod alias) and ~/Secrets/roxira/ on the owner's Mac.")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "export":
        sys.exit(export())
    if cmd == "restore":
        sys.exit(restore("--force" in sys.argv))
    print(__doc__)
    sys.exit(64)
