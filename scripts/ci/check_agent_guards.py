#!/usr/bin/env python3
"""Deterministic guards against recurring AI-agent defects (T207, docs/agents/LESSONS.md).

Four rules, no third-party dependencies:

  money     Number()/parseFloat()/parseInt()/float division on money-named values in
            output_apps/enterprise_hub/modules/** (LESSONS 8). Money is bigint minor units via
            modules/accounting/money.ts. Suppress with `// money-ok: <reason>`.
  tenant    A raw DataSource (`this.dataSource.query/createQueryBuilder/getRepository`) touching a
            tenant table, and BullMQ processors that touch tenant entities without TenantScope
            (LESSONS 5-6). Use TenantScope.run/within or set_config('app.tenant_id', $1, true).
            Suppress with `// tenant-scope-ok: <reason>`.
  model     Provider model-id literals (gpt-*, claude-*, gemini-*, whisper-*, llama*, deepseek*,
            qwen*) outside config/models.yaml and tests, in TS and Python (AGENTS.md section 3).
            Suppress with `# model-ok: <reason>` / `// model-ok: <reason>`.
  secret    Entity columns named *secret*/*token*/*password*/*api_key* that are not
            *_encrypted / *_hash (AGENTS.md section 4). Suppress with `// secret-ok: <reason>`.

Modes:
  default            only lines ADDED relative to the merge base (--base, default origin/main),
                     so existing debt never blocks a PR. Exit 1 on any finding.
  --all              scan every tracked file, print all findings (used to measure debt); exit 0
                     unless --strict.
Prints file:line and a fix hint, never anything else from the file.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULES = "output_apps/enterprise_hub/modules/"

SKIP_PARTS = ("node_modules/", "/tests/", "/__tests__/", "/fixtures/", "/__fixtures__/", "/acceptance/")
SKIP_NAMES = re.compile(
    r"(^|/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py|[^/]*\.(spec|test|e2e-spec)\.[jt]sx?)$"
)


@dataclass(frozen=True)
class Finding:
    rule: str
    path: str
    line: int
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: [{self.rule}] {self.message}"


def is_test(path: str) -> bool:
    return bool(SKIP_NAMES.search(path)) or any(p in path for p in SKIP_PARTS)


def suppressed(lines: list[str], idx: int, tag: str) -> bool:
    marker = f"{tag}:"
    here = lines[idx]
    prev = lines[idx - 1] if idx > 0 else ""
    return marker in here or (marker in prev and prev.strip().startswith(("//", "#", "*", "/*")))


# --------------------------------------------------------------------------- text helpers


def mask_strings_and_comments(text: str) -> str:
    """Blank out comments and string/template literals, keeping offsets and newlines.

    Template literal ${...} contents are kept (they are code). Good enough for line heuristics.
    """
    out = list(text)
    i, n = 0, len(text)

    def blank(a: int, b: int) -> None:
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = text.find("\n", i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
        elif c == "/" and nxt == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
        elif c in "'\"":
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            blank(i, min(j + 1, n))
            i = j + 1
        elif c == "`":
            j = i + 1
            while j < n and text[j] != "`":
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "$" and j + 1 < n and text[j + 1] == "{":
                    depth, k = 1, j + 2
                    while k < n and depth:
                        depth += {"{": 1, "}": -1}.get(text[k], 0)
                        k += 1
                    j = k
                    continue
                if text[j] not in "\n":
                    out[j] = " "
                j += 1
            blank(i, i + 1)
            if j < n:
                out[j] = " "
            i = j + 1
        else:
            i += 1
    return "".join(out)


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


# --------------------------------------------------------------------------- money

MONEY_WORD = re.compile(r"(amount|total|price|debit|credit|balance|vat|tax|fee|cost)", re.IGNORECASE)
# Words that make a money-looking name a count/ratio/display value, not money.
NOT_MONEY = re.compile(
    r"(count|pages?|rows?|items?|length|qty|quantit|lines|entries|size|seconds|millis|duration|"
    r"percent|pct|rate|ratio|index|offset|limit|number|num\b|taxonomy|taxon|type|kind|status|"
    r"label|name|title|code|date|at\b|currency|account|ledger|vouchers?|dimension|key|ids?\b|uuid|"
    r"weight|bytes|leads|days|width|height|usable)",
    re.IGNORECASE,
)
IDENT = r"[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]\n]*\])*"


def is_money_name(name: str, division: bool = False) -> bool:
    # Only the last property segment decides ("row.totalCount" is a count, "totals.amount" money).
    last = re.split(r"[.\]]", name.rstrip("?"))[-1] or name
    # Split camel/snake case into words so "taxId" -> NOT_MONEY via "Id", "balanceSheet" stays money.
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", last).replace("$", "_")
    if not MONEY_WORD.search(spaced):
        return False
    if division and re.search(r"minor", spaced, re.IGNORECASE):
        return False  # bigint minor units: `/` is integer division, which is the intended way
    return not NOT_MONEY.search(spaced.replace("_", " ") + " ")


def balanced_arg(src: str, start: int) -> str:
    """Text of the first call argument beginning at src[start] (just after the open paren)."""
    depth, i = 0, start
    while i < len(src):
        c = src[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif c == "," and depth == 0:
            break
        i += 1
    return src[start:i]


CAST_CALL = re.compile(r"\b(Number|parseFloat|parseInt)\s*\(")
DIV_AFTER = re.compile(rf"({IDENT})\s*/(?![/*=])\s*(?!\d+n\b)(?=[\w(])")
DIV_BEFORE = re.compile(rf"(?<=[\w)\]])\s*/(?![/*=])\s*({IDENT})")


def scan_money(path: str, text: str) -> list[Finding]:
    if not path.startswith(MODULES) or not path.endswith((".ts", ".tsx")) or is_test(path):
        return []
    masked = mask_strings_and_comments(text)
    raw_lines = text.splitlines()
    found: dict[int, Finding] = {}

    def add(offset: int, what: str) -> None:
        ln = line_of(masked, offset)
        if ln - 1 < len(raw_lines) and suppressed(raw_lines, ln - 1, "money-ok"):
            return
        found.setdefault(
            ln,
            Finding(
                "money",
                path,
                ln,
                f"{what} on a money value: use bigint minor units via modules/accounting/money.ts "
                "(LESSONS 8); if it is not money add `// money-ok: <reason>`",
            ),
        )

    for m in CAST_CALL.finditer(masked):
        arg = balanced_arg(masked, m.end())
        if re.search(r"\b\d[\d_]*n\b", arg):
            continue  # bigint ratio (e.g. `(a * 10000n) / b`) converted for display only
        for ident in re.findall(IDENT, arg):
            if is_money_name(ident):
                add(m.start(), f"{m.group(1)}()")
                break
    for m in DIV_AFTER.finditer(masked):
        lhs = m.group(1)
        # `a.b / c` where lhs is a method call result is out of scope: require a plain value.
        if is_money_name(lhs, True) and not masked[m.end(1) : m.end(1) + 1] == "(":
            add(m.start(), "float division")
    for m in DIV_BEFORE.finditer(masked):
        if is_money_name(m.group(1), True):
            add(m.start(), "float division")
    return list(found.values())


# --------------------------------------------------------------------------- tenant scope

_tenant_cache: tuple[set[str], set[str]] | None = None


def tenant_tables_and_entities() -> tuple[set[str], set[str]]:
    """(tenant table names, tenant entity class names) derived from migrations and entities."""
    global _tenant_cache
    if _tenant_cache is not None:
        return _tenant_cache
    tables: set[str] = set()
    entities: set[str] = set()
    base = ROOT / "output_apps/enterprise_hub"
    for mig in sorted((base / "migrations").glob("*.ts")):
        src = mig.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_0-9]+)"?\s*\(', src):
            body = src[m.end() : m.end() + 6000]
            end = body.find("`)")
            body = body if end < 0 else body[:end]
            if '"tenant_id"' in body or " tenant_id " in body:
                tables.add(m.group(1))
    for ent in sorted(base.glob("modules/**/*.entity.ts")):
        src = ent.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"@Entity\(\s*(?:\{\s*name:\s*)?['\"]([a-z_0-9]+)['\"]", src)
        cls = re.search(r"export class (\w+)", src)
        if m and cls and (m.group(1) in tables or re.search(r"\btenantId\b|['\"]tenant_id['\"]", src)):
            tables.add(m.group(1))
            entities.add(cls.group(1))
    # Entities whose table came from migrations only.
    for ent in sorted(base.glob("modules/**/*.entity.ts")):
        src = ent.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"@Entity\(\s*(?:\{\s*name:\s*)?['\"]([a-z_0-9]+)['\"]", src)
        cls = re.search(r"export class (\w+)", src)
        if m and cls and m.group(1) in tables:
            entities.add(cls.group(1))
    _tenant_cache = (tables, entities)
    return _tenant_cache


RAW_DS_CALL = re.compile(
    r"\b(?:this\.)?(?:data_?source|ds|connection)\s*\.\s*(query|createQueryBuilder|getRepository|manager\s*\.\s*(?:query|find\w*|createQueryBuilder))\s*(?:<[^>(]*>)?\s*\("
    , re.IGNORECASE)
INJECT_REPO = re.compile(r"@InjectRepository\(\s*(\w+)\s*\)")


def call_text(src: str, open_idx: int) -> str:
    depth, i = 0, open_idx
    while i < len(src):
        if src[i] == "(":
            depth += 1
        elif src[i] == ")":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return src[open_idx : i + 1]


def scan_tenant(path: str, text: str, tables: set[str] | None = None, entities: set[str] | None = None) -> list[Finding]:
    if not path.startswith(MODULES) or not path.endswith(".ts") or is_test(path):
        return []
    if path.endswith("/tenant-scope.ts") or "/migrations/" in path:
        return []
    if tables is None or entities is None:
        tables, entities = tenant_tables_and_entities()
    raw_lines = text.splitlines()
    findings: list[Finding] = []
    hint = (
        "raw DataSource access to tenant table: run it inside TenantScope.run/within or after "
        "set_config('app.tenant_id', $1, true) on the same transaction (LESSONS 5-6); "
        "or add `// tenant-scope-ok: <reason>` (e.g. a pre-login lookup)"
    )
    for m in RAW_DS_CALL.finditer(text):
        open_idx = m.end() - 1
        body = call_text(text, open_idx)
        method = m.group(1)
        touches = False
        if method.startswith("getRepository") or "find" in method:
            touches = any(re.search(rf"\b{re.escape(e)}\b", body) for e in entities)
        else:
            touches = any(re.search(rf'(?<![\w])"?{re.escape(t)}"?(?![\w])', body) for t in tables) or (
                method == "createQueryBuilder" and any(re.search(rf"\b{re.escape(e)}\b", body) for e in entities)
            )
        if not touches:
            continue
        ln = line_of(text, m.start())
        if suppressed(raw_lines, ln - 1, "tenant-scope-ok"):
            continue
        findings.append(Finding("tenant", path, ln, hint))
    # BullMQ processors run outside any request: they must establish the tenant themselves.
    if re.search(r"@Processor\(|extends\s+WorkerHost", text) and "TenantScope" not in text and "set_config" not in text:
        for m in INJECT_REPO.finditer(text):
            if m.group(1) in entities:
                ln = line_of(text, m.start())
                if not suppressed(raw_lines, ln - 1, "tenant-scope-ok"):
                    findings.append(
                        Finding(
                            "tenant",
                            path,
                            ln,
                            f"BullMQ processor reads tenant entity {m.group(1)} without TenantScope: "
                            "inject TenantScope and wrap the job body in tenantScope.run(tenantId, ...) (LESSONS 6)",
                        )
                    )
    return findings


# --------------------------------------------------------------------------- model ids

MODEL_LITERAL = re.compile(
    r"""["'`]((?:gpt-|chatgpt-|claude-|gemini-|whisper-|llama[-\d]|deepseek[-/]|qwen\d*[-/]|o[134]-(?:mini|preview))[a-z0-9][A-Za-z0-9._:/-]*)["'`]"""
)
MODEL_SUFFIXES = (".ts", ".tsx", ".js", ".mjs", ".py")
MODEL_SKIP_PREFIXES = ("config/", "docs/", "archive/", "e2e/", "backups/", "data/", "projects/", "templates/", "scripts/ci/")


def scan_model(path: str, text: str) -> list[Finding]:
    if not path.endswith(MODEL_SUFFIXES) or path.startswith(MODEL_SKIP_PREFIXES) or is_test(path):
        return []
    if "/migrations/" in path:
        return []
    findings = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not MODEL_LITERAL.search(line) or suppressed(lines, i, "model-ok"):
            continue
        findings.append(
            Finding(
                "model",
                path,
                i + 1,
                "hard-coded model id: add it to config/models.yaml and read it via "
                "smartjudge/model_registry.py (AGENTS.md section 3); or add `model-ok: <reason>`",
            )
        )
    return findings


# --------------------------------------------------------------------------- secrets

SECRET_SEGMENT = re.compile(r"(?:^|_)(secret|token|password|passwd|apikey|api_key)(?:_|$)", re.IGNORECASE)
SAFE_SUFFIX = re.compile(r"(?:_|^)(enc|encrypted|hash|hashed|ciphertext|digest|fingerprint|prefix|ref|id|type|expires|expiry|at|count|ttl|length|version|status|hint|last4|sha256)(?:_|$)", re.IGNORECASE)
COLUMN_DECO = re.compile(r"@(?:Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn)\s*\(")
PROP = re.compile(r"\s*(?:public\s+|private\s+|readonly\s+)*([A-Za-z_]\w*)[!?]?\s*:")


def snake(name: str) -> str:
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()


def scan_secret(path: str, text: str) -> list[Finding]:
    if not path.endswith(".entity.ts") or is_test(path):
        return []
    masked_comments = mask_strings_and_comments(text)  # only used for offsets
    raw_lines = text.splitlines()
    findings = []
    for m in COLUMN_DECO.finditer(text):
        if masked_comments[m.start()] == " ":
            continue
        body = call_text(text, m.end() - 1)
        after = text[m.end() - 1 + len(body) : m.end() + len(body) + 200]
        pm = PROP.match(after)
        if not pm:
            continue
        explicit = re.search(r"\bname:\s*['\"]([\w]+)['\"]", body)
        names = {snake(pm.group(1))}
        if explicit:
            names.add(explicit.group(1).lower())
        bad = [n for n in names if SECRET_SEGMENT.search(n) and not SAFE_SUFFIX.search(n.replace("api_key", "apikey"))]
        # `refresh_token_hash` style: any safe segment after the secret word makes it safe.
        if not bad:
            continue
        ln = line_of(text, m.start())
        if suppressed(raw_lines, ln - 1, "secret-ok") or suppressed(raw_lines, ln, "secret-ok"):
            continue
        findings.append(
            Finding(
                "secret",
                path,
                ln,
                f"column `{sorted(bad)[0]}` looks like a secret stored in plaintext: store ciphertext "
                "as *_encrypted (envelope encryption) or a one-way digest as *_hash; or add "
                "`// secret-ok: <reason>`",
            )
        )
    return findings


# --------------------------------------------------------------------------- driver

SCANNERS = (scan_money, scan_tenant, scan_model, scan_secret)


def scan_text(path: str, text: str) -> list[Finding]:
    out: list[Finding] = []
    for fn in SCANNERS:
        out.extend(fn(path, text))
    return out


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def added_lines(base: str) -> dict[str, set[int]]:
    """Map path -> added line numbers in the diff from merge-base(base, HEAD) to the work tree."""
    try:
        mb = git("merge-base", base, "HEAD").strip()
    except subprocess.CalledProcessError:
        print(f"error: cannot find merge base with {base}; fetch it first", file=sys.stderr)
        raise SystemExit(2)
    diff = git("diff", "-U0", "--no-color", "--diff-filter=AMR", mb)
    out: dict[str, set[int]] = {}
    cur: str | None = None
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            cur = line[6:]
            out.setdefault(cur, set())
        elif line.startswith("@@") and cur is not None:
            m = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if m:
                start, cnt = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
                out[cur].update(range(start, start + cnt))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--all", action="store_true", help="scan all tracked files (debt report)")
    ap.add_argument("--strict", action="store_true", help="with --all, exit 1 on findings")
    ap.add_argument("--rule", choices=["money", "tenant", "model", "secret"])
    args = ap.parse_args(argv)

    findings: list[Finding] = []
    if args.all:
        paths = {p: None for p in git("ls-files").splitlines()}
    else:
        paths = added_lines(args.base)
    for path, lines in sorted(paths.items()):
        f = ROOT / path
        if not f.is_file() or not path.endswith((".ts", ".tsx", ".js", ".mjs", ".py")):
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for fd in scan_text(path, text):
            if args.rule and fd.rule != args.rule:
                continue
            if lines is None or fd.line in lines:
                findings.append(fd)
    for fd in findings:
        print(fd)
    mode = "all files" if args.all else f"lines added since merge-base with {args.base}"
    print(f"agent guards: {len(findings)} finding(s) ({mode})")
    if findings and (not args.all or args.strict):
        print("Fix the cause, or add the documented `<rule>-ok: <reason>` comment. See docs/agents/LESSONS.md.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
