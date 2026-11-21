#!/usr/bin/env python3
"""Content guard for the box backup: drop any file that looks like it holds a secret.

stdin: NUL-separated file list. stdout: NUL-separated list of the files that are clean.
stderr: one line per dropped file, `SECRET-SCAN: <path> (<rule>)` (never the matched text).
Exit 0 always (a dropped file must not stop the backup of everything else; the caller reports the count).
Stdlib only, reads at most the first 1 MiB of each file.
"""
import re
import sys

RULES = {
    "private-key-block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "provider-key": re.compile(r"\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|"
                               r"AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})"),
    "telegram-bot-token": re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "url-with-password": re.compile(r"[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]{3,}@"),
    "secret-assignment": re.compile(
        r"(?im)^[ \t]*[\w.-]*(?:password|passwd|secret|api[_-]?key|token|private[_-]?key)[\w.-]*[ \t]*[:=][ \t]*"
        r"[\"']?(?!os\.environ|\$|<|REPLACE|env:|file:|none|null|true|false|changeme)[A-Za-z0-9/+_=.-]{20,}[\"']?[ \t]*$"
    ),
}


def scan(path):
    try:
        with open(path, "rb") as fh:
            head = fh.read(1 << 20)
    except OSError:
        return "unreadable"
    if b"\0" in head[:4096]:
        return ""  # binary (sqlite etc.): name filters are the guard; the stage copy is scanned by the caller
    text = head.decode("utf-8", "replace")
    for name, rx in RULES.items():
        if rx.search(text):
            return name
    return ""


def main():
    paths = [p for p in sys.stdin.buffer.read().split(b"\0") if p]
    out = sys.stdout.buffer
    for raw in paths:
        path = raw.decode("utf-8", "surrogateescape")
        hit = scan(path)
        if hit:
            print(f"SECRET-SCAN: {path} ({hit})", file=sys.stderr)
        else:
            out.write(raw + b"\0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
