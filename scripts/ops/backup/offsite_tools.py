#!/usr/bin/env python3
"""Small, offline-testable helpers for the off-site backup scripts (neon_offsite.sh,
codeberg_mirror.sh, restore_drill.sh). Stdlib only. Secrets are read from the environment
by NAME; they are never accepted as arguments and never printed.

Subcommands:
  redact                      stdin -> stdout with secrets masked
  url-db ENVNAME DBNAME       print the URL held in $ENVNAME with its database replaced by DBNAME
  check-url ENVNAME           validate a direct (non-pooler) postgres URL; prints nothing, exit 0/3/4
  count-sql                   stdin "schema|table" lines -> one UNION ALL count(*) statement
  compare SRC DST [PCT [ABS]] compare "label|count" files (tolerance: max(ABS, PCT% of source))
"""
from __future__ import annotations

import os
import re
import sys
from urllib.parse import unquote, urlsplit, urlunsplit

REDACT_ENV_DEFAULT = ("NEON_BACKUP_URL", "CODEBERG_TOKEN", "NOTIFY_BOT_TOKEN")
_USERINFO = re.compile(r"([A-Za-z][A-Za-z0-9+.\-]*://)[^/\s@]*@")
_KV = re.compile(
    r"(?i)\b(password|passwd|token|secret|authorization|apikey|api_key)(\s*[=:]\s*)(?:Basic\s+|Bearer\s+)?[^\s&'\"]+"
)
_BASIC = re.compile(r"(?i)\b(Basic|Bearer)\s+[A-Za-z0-9+/=._\-]{8,}")
_URL_PARAM = re.compile(r"(?i)([?&](?:password|token|sslpassword)=)[^&\s]+")


def _secret_values(names) -> list[str]:
    vals: set[str] = set()
    for n in names:
        v = os.environ.get(n, "")
        if len(v) >= 6:
            vals.add(v)
        if "://" in v:  # also mask the password / user parts of a URL on their own
            try:
                p = urlsplit(v)
                for part in (p.password, p.username):
                    if part and len(part) >= 4:
                        vals.update({part, unquote(part)})
            except ValueError:
                pass
    return sorted(vals, key=len, reverse=True)


def redact(text: str, env_names=None) -> str:
    names = tuple(env_names) if env_names else REDACT_ENV_DEFAULT
    extra = tuple(os.environ.get("REDACT_ENV_NAMES", "").split())
    for v in _secret_values(names + extra):
        text = text.replace(v, "[redacted]")
    text = _USERINFO.sub(r"\1[redacted]@", text)
    text = _URL_PARAM.sub(r"\1[redacted]", text)
    text = _BASIC.sub(r"\1 [redacted]", text)
    text = _KV.sub(lambda m: m.group(1) + m.group(2) + "[redacted]", text)
    return text


def _parse_pg_url(url: str):
    p = urlsplit(url)
    if p.scheme not in ("postgres", "postgresql") or not p.hostname:
        raise ValueError("not a postgres URL")
    return p


def url_with_db(url: str, db: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]{1,63}", db):
        raise ValueError("bad database name")
    p = _parse_pg_url(url)
    return urlunsplit((p.scheme, p.netloc, "/" + db, p.query, ""))


def check_url(url: str) -> int:
    try:
        p = _parse_pg_url(url)
    except ValueError:
        return 4
    if "-pooler" in (p.hostname or ""):
        return 3  # pg_restore --clean needs a session connection, not the pooler
    return 0


def _q_ident(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def _q_lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def count_sql(lines) -> str:
    parts = []
    for line in lines:
        line = line.rstrip("\n")
        if "|" not in line:
            continue
        schema, table = line.split("|", 1)
        parts.append(
            f"SELECT {_q_lit(schema + '.' + table)} AS t, count(*) AS n FROM {_q_ident(schema)}.{_q_ident(table)}"
        )
    return (" UNION ALL ".join(parts) + " ORDER BY 1;") if parts else ""


def _read_counts(path: str) -> dict[str, int]:
    out: dict[str, int] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if "|" in line:
                label, n = line.rsplit("|", 1)
                out[label] = int(n)
    return out


def compare(src: dict[str, int], dst: dict[str, int], pct: float = 2.0, abs_slack: int = 10) -> list[str]:
    """Return human-readable problems (empty list = match). The source is live, so a small drift
    between the pre-dump count and the restored copy is expected and tolerated."""
    problems = []
    if not src:
        problems.append("no tables found on the source")
    for label, s in src.items():
        if label not in dst:
            problems.append(f"{label}: missing in target")
            continue
        d = dst[label]
        allowed = max(abs_slack, int(s * pct / 100))
        if s > 0 and d == 0:
            problems.append(f"{label}: target empty, source {s}")
        elif abs(d - s) > allowed:
            problems.append(f"{label}: source {s} vs target {d}")
    return problems


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd == "redact":
        for line in sys.stdin:
            sys.stdout.write(redact(line))
        return 0
    if cmd == "url-db" and len(argv) == 4:
        try:
            print(url_with_db(os.environ.get(argv[2], ""), argv[3]))
        except ValueError as exc:
            print(f"url-db: {exc}", file=sys.stderr)
            return 4
        return 0
    if cmd == "check-url" and len(argv) == 3:
        return check_url(os.environ.get(argv[2], ""))
    if cmd == "count-sql":
        sql = count_sql(sys.stdin)
        if not sql:
            return 1
        print(sql)
        return 0
    if cmd == "compare" and len(argv) >= 4:
        pct = float(argv[4]) if len(argv) > 4 else 2.0
        slack = int(argv[5]) if len(argv) > 5 else 10
        problems = compare(_read_counts(argv[2]), _read_counts(argv[3]), pct, slack)
        for p in problems:
            print(p)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
