#!/usr/bin/env python3
"""Build a sanitized, git-tracked-only export for a public release.

Never pushes. Prints file names and counts only, never secret values.
See docs/ops/PUBLIC_EXPORT.md.
"""

from __future__ import annotations

import argparse
import fnmatch
import ipaddress
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / "config" / "public_export.json"
REDACTIONS = Path.home() / ".config" / "roxira" / "public_export_redactions.txt"
MARKER = "PUBLIC_EXPORT_OK"
MANIFEST = "PUBLIC_EXPORT_MANIFEST.json"

_ASSIGN_NAME = r"[A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*"
SECRET_PATTERNS: dict[str, re.Pattern[str]] = {
    "tavily": re.compile(r"tvly-(?:dev|prod)-[A-Za-z0-9]{8,}"),
    "brave": re.compile(r"\bBSA[A-Za-z0-9_\-]{20,}"),
    "groq": re.compile(r"\bgsk_[A-Za-z0-9]{20,}"),
    "google_api": re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),
    "openrouter": re.compile(r"sk-or-v1-[A-Za-z0-9]{16,}"),
    "anthropic": re.compile(r"sk-ant-[A-Za-z0-9_\-]{16,}"),
    "xai": re.compile(r"\bxai-[A-Za-z0-9]{20,}"),
    "perplexity": re.compile(r"\bpplx-[A-Za-z0-9]{20,}"),
    "jina": re.compile(r"\bjina_[A-Za-z0-9]{20,}"),
    "firecrawl": re.compile(r"\bfc-[0-9a-fA-F]{24,}"),
    "google_oauth_secret": re.compile(r"GOCSPX-[A-Za-z0-9_\-]{10,}"),
    "google_oauth_client": re.compile(r"[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com"),
    "named_assignment": re.compile(
        rf"""\b{_ASSIGN_NAME}["']?\s*[:=]\s*["'][^"'\s]{{20,}}["']""", re.IGNORECASE
    ),
    "private_key_block": re.compile(r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----"),
}
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")


class ExportError(Exception):
    pass


def load_config(path: Path = CONFIG) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def tracked_files(repo: Path) -> list[str]:
    res = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z"],
        capture_output=True,
        check=True,
    )
    return [p for p in res.stdout.decode("utf-8", "surrogateescape").split("\0") if p]


def _matches(path: str, globs: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in globs)


def is_included(path: str, cfg: dict) -> bool:
    inc = any(path == i or (i.endswith("/") and path.startswith(i)) for i in cfg["include"])
    if not inc:
        return False
    if _matches(path, cfg["exclude"]):
        return False
    return not ("/" not in path and _matches(path, cfg.get("exclude_root_globs", [])))


def count_public_ips(text: str) -> int:
    n = 0
    for m in IPV4.finditer(text):
        try:
            ip = ipaddress.IPv4Address(m.group())
        except ValueError:
            continue
        if ip.is_global:
            n += 1
    return n


def _read_text(p: Path) -> str | None:
    try:
        data = p.read_bytes()
    except OSError:
        return None
    if b"\0" in data[:8192]:
        return None
    return data.decode("utf-8", "replace")


def content_excluded(text: str, path: str, cfg: dict) -> bool:
    if not any(path.startswith(s) for s in cfg.get("content_exclude_scopes", [])):
        return False
    if any(re.search(rx, text) for rx in cfg.get("content_exclude_regex", [])):
        return True
    return bool(cfg.get("content_exclude_public_ipv4") and count_public_ips(text))


def select_files(repo: Path, cfg: dict) -> tuple[list[str], list[str]]:
    keep: list[str] = []
    skipped: list[str] = []
    for path in tracked_files(repo):
        if not is_included(path, cfg):
            continue
        p = repo / path
        if not p.is_file() or p.is_symlink():
            continue
        if p.stat().st_size > cfg["max_file_bytes"]:
            skipped.append(path)
            continue
        text = _read_text(p)
        if text is not None and content_excluded(text, path, cfg):
            skipped.append(path)
            continue
        keep.append(path)
    return keep, skipped


def load_redactions(path: Path) -> list[re.Pattern[str]]:
    if not path.is_file():
        raise ExportError(
            f"Redaction file missing: {path}\n"
            "Create it with one regex per line (server IP, personal emails/phones to scrub;"
            " '#' comments allowed), chmod 600, then re-run. Nothing was exported."
        )
    pats = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            pats.append(re.compile(line))
    return pats


def apply_redactions(out: Path, pats: list[re.Pattern[str]]) -> int:
    total = 0
    for p in sorted(out.rglob("*")):
        if not p.is_file():
            continue
        text = _read_text(p)
        if text is None:
            continue
        new = text
        for rx in pats:
            new, n = rx.subn("[REDACTED]", new)
            total += n
        if new != text:
            p.write_text(new, encoding="utf-8")
    return total


def secret_gate(out: Path) -> dict[str, dict[str, int]]:
    """Return {relative file: {rule: count}} for every hit. Values are never kept."""
    hits: dict[str, dict[str, int]] = {}
    for p in sorted(out.rglob("*")):
        if not p.is_file() or p.name in (MARKER, MANIFEST):
            continue
        text = _read_text(p)
        if text is None:
            continue
        found: dict[str, int] = {}
        for name, rx in SECRET_PATTERNS.items():
            n = len(rx.findall(text))
            if n:
                found[name] = n
        n = count_public_ips(text)
        if n:
            found["public_ipv4"] = n
        if found:
            hits[str(p.relative_to(out))] = found
    return hits


def gitleaks_gate(out: Path) -> str:
    """Return 'SKIP', 'OK' or 'FAIL'."""
    exe = shutil.which("gitleaks")
    if not exe:
        return "SKIP"
    res = subprocess.run(
        [exe, "detect", "--no-git", "--source", str(out), "--no-banner", "--redact"],
        capture_output=True,
    )
    return "OK" if res.returncode == 0 else "FAIL"


def _inside(child: Path, parent: Path) -> bool:
    return child == parent or parent in child.parents


def export(repo: Path, out: Path, cfg: dict, redactions: Path) -> int:
    repo, out = repo.resolve(), out.resolve()
    if _inside(out, repo) or _inside(repo, out):
        print("ERROR: --out must be outside the repository.", file=sys.stderr)
        return 2
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        print("ERROR: --out must be an empty directory.", file=sys.stderr)
        return 2
    try:
        pats = load_redactions(redactions)
    except ExportError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    files, skipped = select_files(repo, cfg)
    out.mkdir(parents=True, exist_ok=True)
    for path in files:
        dest = out / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / path, dest)
    count = apply_redactions(out, pats)
    print(f"files copied: {len(files)}; skipped by content/size: {len(skipped)}")
    print(f"redaction replacements: {count}")
    for s in skipped:
        print(f"  skipped: {s}")

    hits = secret_gate(out)
    gl = gitleaks_gate(out)
    print(f"gitleaks: {gl}")
    for f, found in hits.items():
        print(f"  GATE HIT {f}: " + ", ".join(f"{k}={v}" for k, v in sorted(found.items())))
    if hits or gl == "FAIL":
        print("SECRET GATE FAILED: no marker written. Fix the source or the redactions.")
        return 1
    manifest = {
        "files": sorted(files),
        "skipped": sorted(skipped),
        "redactions": count,
        "gitleaks": gl,
    }
    (out / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out / MARKER).write_text("ok\n", encoding="utf-8")
    print(f"SECRET GATE OK. Wrote {MARKER}. Review {out}; publish manually (this never pushes).")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, type=Path, help="empty directory outside the repo")
    ap.add_argument("--repo", type=Path, default=REPO)
    ap.add_argument("--config", type=Path, default=CONFIG)
    ap.add_argument("--redactions", type=Path, default=REDACTIONS)
    a = ap.parse_args(argv)
    return export(a.repo, a.out, load_config(a.config), a.redactions)


if __name__ == "__main__":
    sys.exit(main())
