#!/usr/bin/env python3
"""Gate 2 static check: the backend Dockerfile COPYs every dir app.module.ts imports.

Incident (#807): output_apps/enterprise_hub/mcp/ was added and imported from
app.module.ts, but the backend Dockerfile only COPYed main.ts, app.module.ts,
modules/ and security/. tsc/jest passed (the sources were in the tree) while every
deploy failed because the build context never had mcp/.

This checker parses the relative imports of app.module.ts, maps each to its
top-level directory under the hub, keeps the ones that contain .ts files, and
fails when the Dockerfile does not COPY that directory.

Usage:
    python3 dockerfile_copy_coverage.py [HUB_DIR]      # default output_apps/enterprise_hub
Exit: 0 every imported dir is covered, 1 a dir is missing from the Dockerfile, 2 bad usage.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

IMPORT_RE = re.compile(r"""(?:from\s+|import\s+)['"](\./[^'"]+)['"]""")
SKIP_DIRS = {"node_modules", "dist", ".next"}


def relative_import_dirs(text: str) -> set[str]:
    """Top-level directory names of every relative import in a TypeScript module."""
    dirs: set[str] = set()
    for spec in IMPORT_RE.findall(text or ""):
        path = spec[2:] if spec.startswith("./") else spec
        if path:
            dirs.add(path.split("/", 1)[0])
    return dirs


def copied_sources(dockerfile_text: str) -> set[str]:
    """Source arguments of every plain COPY instruction (COPY --from=... ignored)."""
    sources: set[str] = set()
    logical: list[str] = []
    buf = ""
    for raw in (dockerfile_text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if raw.rstrip().endswith("\\"):
            buf += raw.rstrip()[:-1] + " "
            continue
        buf += line
        logical.append(buf)
        buf = ""
    if buf:
        logical.append(buf)
    for line in logical:
        tokens = line.split()
        if not tokens or tokens[0].upper() != "COPY":
            continue
        args = [t for t in tokens[1:] if not t.startswith("--")]
        if len(args) < 2:
            continue
        sources.update(args[:-1])
    return sources


def _norm(src: str) -> str:
    src = src.strip()
    if src.startswith("./"):
        src = src[2:]
    return src.rstrip("/")


def _covers(source: str, directory: str) -> bool:
    source = _norm(source)
    if source in (".", ""):  # COPY . . -> the whole context
        return True
    return source == directory or source.startswith(directory + "/")


def _has_ts(directory: Path) -> bool:
    for path in directory.rglob("*.ts"):
        if not SKIP_DIRS.intersection(path.relative_to(directory).parts):
            return True
    return False


def missing_copies(hub: Path, app_module: Path | None = None, dockerfile: Path | None = None) -> list[str]:
    """Sorted top-level dirs imported by app.module.ts that the Dockerfile does not COPY."""
    hub = Path(hub)
    app_module = app_module or hub / "app.module.ts"
    dockerfile = dockerfile or hub / "Dockerfile"
    if not app_module.is_file() or not dockerfile.is_file():
        return []
    imported = relative_import_dirs(app_module.read_text(errors="replace"))
    copied = copied_sources(dockerfile.read_text(errors="replace"))
    missing = []
    for name in sorted(imported):
        directory = hub / name
        if not directory.is_dir() or not _has_ts(directory):
            continue
        if not any(_covers(src, name) for src in copied):
            missing.append(name)
    return missing


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) > 1:
        sys.stderr.write("usage: dockerfile_copy_coverage.py [HUB_DIR]\n")
        return 2
    hub = Path(argv[0]) if argv else Path("output_apps/enterprise_hub")
    missing = missing_copies(hub)
    if missing:
        sys.stdout.write("dockerfile:copy-coverage: missing COPY for: %s\n" % ", ".join(missing))
        return 1
    sys.stdout.write("dockerfile:copy-coverage: ok\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
