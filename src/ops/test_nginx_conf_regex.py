"""nginx treats an unquoted `{` in a regex location as a block start and refuses to
start (incident 2026-11-05: `[0-9a-fA-F-]{36}` took the whole gateway down, every
host answered 000 and autodeploy rolled back). Any regex containing `{n}` must be quoted.
"""

from __future__ import annotations

import re
from pathlib import Path

CONF_DIR = Path(__file__).resolve().parents[2] / "output_apps" / "nginx_config"


def test_regex_locations_with_braces_are_quoted() -> None:
    bad = []
    for conf in sorted(CONF_DIR.rglob("*.conf")):
        for n, line in enumerate(conf.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"^\s*location\s+~", line) and re.search(r"\{\d", line):
                m = re.match(r"^\s*location\s+~\*?\s+(\S)", line)
                if not m or m.group(1) not in "\"'":
                    bad.append(f"{conf.name}:{n}")
    assert not bad, f"unquoted regex with {{n}} quantifier at {bad}"
