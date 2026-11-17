#!/usr/bin/env python3
"""Squawk lint for migration files ADDED on this branch (T170). Stdlib only.

Pulls the string/template-literal argument of every `<runner>.query(...)` in up() out of each added
TypeORM migration, writes it to a temp .sql file and runs Squawk on it. Literals with `${...}`
interpolation, concatenations and non-literal arguments cannot be linted: they are listed as
skipped. SQL emitted by helpers (e.g. enableTenantRls) is not seen either.

Blocking rules: adding-required-field (named adding-not-nullable-field before Squawk 2.x) and
prefer-robust-stmts. require-lock-timeout is report-only unless --enforce-lock-timeout is given:
99 of 110 migrations on main set no lock_timeout (TypeORM runs them in one transaction on a
deploy-time connection), so enforcing it today would fail almost every new migration. Every other
finding is printed and does not fail. Files are linted with --assume-in-transaction (TypeORM wraps
each migration run in a transaction), otherwise prefer-robust-stmts flags every ALTER/CREATE INDEX.

Squawk is taken from $SQUAWK, then `squawk` on PATH. Get the checksum-verified pinned binary with
`SQUAWK=$(bash scripts/dev/install_squawk.sh)`.
Usage: python3 scripts/dev/lint_migrations_squawk.py [--base origin/main] [--dir DIR] [FILE.ts ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_migration_ids import MIGRATION_DIR, added_files  # noqa: E402

BLOCKING = {"adding-required-field", "adding-not-nullable-field", "prefer-robust-stmts"}
QUERY_RE = re.compile(r"\.query\s*\(\s*")


def up_body(src: str) -> str:
    m = re.search(r"\bup\s*\([^)]*\)[^{]*\{", src)
    if not m:
        return ""
    d = re.search(r"\bdown\s*\([^)]*\)[^{]*\{", src[m.end():])
    return src[m.end(): m.end() + d.start()] if d else src[m.end():]


def extract(src: str) -> tuple[list[str], list[str]]:
    """Return (sql statements, skipped reasons) for the up() method."""
    body, sql, skipped = up_body(src), [], []
    for m in QUERY_RE.finditer(body):
        i = m.end()
        line = body.count("\n", 0, i) + 1
        if i >= len(body) or body[i] not in "'\"`":
            skipped.append(f"up() offset line {line}: argument is not a string literal")
            continue
        q, j, buf, dynamic = body[i], i + 1, [], False
        while j < len(body) and body[j] != q:
            c = body[j]
            if c == "\\" and j + 1 < len(body):
                buf.append(body[j + 1] if body[j + 1] in "'\"`\\" else c + body[j + 1])
                j += 2
                continue
            if q == "`" and c == "$" and body[j + 1: j + 2] == "{":
                dynamic = True
            buf.append(c)
            j += 1
        rest = body[j + 1:].lstrip()
        if dynamic:
            skipped.append(f"up() offset line {line}: template literal has ${{}} interpolation")
        elif rest.startswith("+"):
            skipped.append(f"up() offset line {line}: string concatenation")
        else:
            sql.append("".join(buf).strip().rstrip(";") + ";")
    return sql, skipped


def squawk_cmd() -> list[str] | None:
    if os.environ.get("SQUAWK"):
        return [os.environ["SQUAWK"]]
    if shutil.which("squawk"):
        return ["squawk"]
    return None


def lint(files: list[str], cmd: list[str], blocking_rules: set[str]) -> int:
    blocking = 0
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            with open(f, encoding="utf-8") as fh:
                sql, skipped = extract(fh.read())
            print(f"--- {f}: {len(sql)} statement(s) linted, {len(skipped)} skipped")
            for s in skipped:
                print(f"    skipped: {s}")
            if not sql:
                continue
            path = os.path.join(tmp, os.path.basename(f)[:-3] + ".sql")
            starts, line_no = [], 0  # 0-based file line where each statement begins
            for st in sql:
                starts.append(line_no)
                line_no += st.count("\n") + 1
            with open(path, "w", encoding="utf-8") as out:
                out.write("\n".join(sql) + "\n")
            p = subprocess.run([*cmd, "--assume-in-transaction", "--reporter", "json", path],
                               capture_output=True, text=True)
            try:
                findings = json.loads(p.stdout or "[]")
            except json.JSONDecodeError:
                print(f"    squawk failed (exit {p.returncode}): {p.stderr.strip()[-300:]}")
                blocking += 1
                continue
            for v in findings:
                rule = v.get("rule_name", "?")
                idx = max(i for i, st in enumerate(starts) if st <= v.get("line", 0))
                stmt = sql[idx]
                tag = "ERROR" if rule in blocking_rules else "report"
                print(f"    {tag} [{rule}] {v.get('message')} | {' '.join(stmt.split())[:110]}")
                blocking += rule in blocking_rules
    return blocking


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--dir", default=MIGRATION_DIR)
    ap.add_argument("--enforce-lock-timeout", action="store_true")
    ap.add_argument("files", nargs="*", help="lint these files instead of the added ones")
    a = ap.parse_args()
    files = a.files or added_files(a.base, a.dir)
    if not files:
        print("no migration files added; nothing to lint")
        return 0
    cmd = squawk_cmd()
    if cmd is None:
        print("error: need $SQUAWK or squawk on PATH (bash scripts/dev/install_squawk.sh)", file=sys.stderr)
        return 2
    rules = BLOCKING | ({"require-lock-timeout"} if a.enforce_lock_timeout else set())
    n = lint(files, cmd, rules)
    if n:
        print(f"squawk: {n} blocking finding(s) ({', '.join(sorted(rules))}). "
              "Fix the SQL, or explain in the PR why the statement is safe.")
        return 1
    print("squawk: no blocking findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
