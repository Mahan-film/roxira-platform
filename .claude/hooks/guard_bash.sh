#!/usr/bin/env bash
# PreToolUse hook (Bash): block two repo rules before the command runs.
#   1. pytest over src/ or the repo root (CLAUDE.md: most src test_*.py files
#      run git commands and call paid LLM APIs at import time). This covers
#      "pytest", "pytest .", "pytest src", "pytest src/x/" and "pytest --co"
#      without a specific test file.
#   2. git ... --no-verify (and "git commit -n").
# Reads the hook JSON payload on stdin: {"tool_input": {"command": "..."}}.
# Exit 2 with a short reason on stderr blocks the call. Anything it cannot
# parse is allowed (exit 0), so a parser bug never blocks every Bash call.
# Tests: scripts/dev/tests/test_guard_bash.py.

set -u

payload="$(cat)"
GUARD_PAYLOAD="$payload" python3 - <<'PY'
import json
import os
import re
import shlex
import sys

try:
    data = json.loads(os.environ.get("GUARD_PAYLOAD") or "")
    cmd = (data.get("tool_input") or {}).get("command") or ""
except Exception:
    sys.exit(0)
if not isinstance(cmd, str) or not cmd.strip():
    sys.exit(0)

SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", ";;", "|&"}
WRAPPERS = {"time", "env", "sudo", "nice", "command", "exec", "nohup", "xargs"}
# pytest options whose value is the next token (so it is not read as a path).
VALUE_OPTS = {
    "-p", "-k", "-m", "-c", "-o", "-W", "-n", "-r", "--rootdir", "--confcutdir", "--basetemp",
    "--ignore", "--ignore-glob", "--deselect", "--tb", "--timeout", "--maxfail", "--junitxml",
    "--junit-xml", "--log-level", "--durations", "--override-ini", "--import-mode", "--cov",
    "--cov-report", "--cov-config", "--capture",
}
COLLECT_ONLY = {"--co", "--collect-only", "--collectonly"}


def strip_heredocs(text: str) -> str:
    """Drop heredoc bodies: their text is data, not a command."""
    out, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        tags = re.findall(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?", line)
        i += 1
        for tag in tags:
            while i < len(lines) and lines[i].strip() != tag:
                i += 1
            i += 1
    return "\n".join(out)


def segments(text: str):
    for line in strip_heredocs(text).split("\n"):
        lex = shlex.shlex(line, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        lex.commenters = "#"
        seg = []
        for tok in lex:
            # shlex glues adjacent punctuation (";(" or "|&"), so any token made
            # only of ;&|() separates commands.
            if tok in SEPARATORS or re.fullmatch(r"[;&|()]+", tok):
                if seg:
                    yield seg
                seg = []
            else:
                seg.append(tok)
        if seg:
            yield seg


def unwrap(seg):
    """Skip VAR=value prefixes and wrappers like env, time, sudo, rtk, uv run."""
    i = 0
    while i < len(seg):
        tok = seg[i]
        base = os.path.basename(tok)
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tok) or base in WRAPPERS:
            i += 1
        elif base == "rtk":
            i += 2 if i + 1 < len(seg) and seg[i + 1] == "proxy" else 1
        elif base in ("uv", "poetry", "pipenv") and i + 1 < len(seg) and seg[i + 1] == "run":
            i += 2
        else:
            break
    return seg[i:]


def pytest_args(seg):
    """Return pytest's argument list if this segment runs pytest, else None."""
    if not seg:
        return None
    base = os.path.basename(seg[0])
    if base in ("pytest", "py.test"):
        return seg[1:]
    if re.match(r"^python[0-9.]*$", base):
        for j in range(1, len(seg) - 1):
            if seg[j] == "-m":
                return seg[j + 2:] if seg[j + 1] in ("pytest", "py.test") else None
            if not seg[j].startswith("-"):
                return None
    return None


def is_repo_root(path: str) -> bool:
    return os.path.isabs(path) and os.path.exists(os.path.join(path, ".git"))


def is_specific(path: str) -> bool:
    return path.endswith(".py") or "::" in path


def strip_redirects(args):
    """Drop redirections ("2>&1", "> out.txt", "2>/dev/null") so they are not read as paths.
    shlex splits "2>&1" into "2", ">&", "1" and "2>/dev/null" into "2", ">", "/dev/null"."""
    out, i = [], 0
    while i < len(args):
        tok = args[i]
        if re.fullmatch(r"[<>&]+", tok) and re.search(r"[<>]", tok):
            if out and out[-1].isdigit():
                out.pop()
            i += 2
            continue
        out.append(tok)
        i += 1
    return out


INFO_ONLY = {"--version", "-V", "--help", "-h"}  # print and exit; no collection


def check_pytest(args):
    args = strip_redirects(args)
    if any(tok in INFO_ONLY for tok in args):
        return None
    paths, collect, skip = [], False, False
    for tok in args:
        if skip:
            skip = False
            continue
        if tok in COLLECT_ONLY:
            collect = True
        elif tok in VALUE_OPTS:
            skip = True
        elif tok.startswith("-"):
            continue
        else:
            paths.append(tok)
    if not paths:
        return "pytest with no path collects src/ (testpaths); name a specific test file"
    for p in paths:
        norm = p.rstrip("/")
        while norm.startswith("./"):
            norm = norm[2:]
        if norm in ("", ".", "..") or is_repo_root(norm or "/"):
            return f"pytest over the repo root ({p}); name a specific test file"
        if not is_specific(norm) and (
            norm == "src" or norm.startswith("src/") or (os.path.isabs(norm) and "/src/" in norm + "/")
        ):
            return f"pytest over src/ ({p}); name a specific test file"
    if collect and not any(is_specific(p) for p in paths):
        return "pytest --co without a specific test file; name one"
    return None


def check(text: str, depth: int = 0):
    for raw in segments(text):
        seg = unwrap(raw)
        if not seg:
            continue
        base = os.path.basename(seg[0])
        if base in ("bash", "sh", "zsh") and "-c" in seg[1:] and depth < 3:
            idx = seg.index("-c")
            if idx + 1 < len(seg):
                reason = check(seg[idx + 1], depth + 1)
                if reason:
                    return reason
            continue
        if base == "git":
            if "--no-verify" in seg[1:]:
                return "git --no-verify is not allowed (AGENTS.md section 8)"
            if "commit" in seg[1:] and "-n" in seg[seg.index("commit") + 1:]:
                return "git commit -n skips the hooks (same as --no-verify)"
            continue
        args = pytest_args(seg)
        if args is not None:
            reason = check_pytest(args)
            if reason:
                return reason
    return None


try:
    reason = check(cmd)
except Exception:
    sys.exit(0)
if reason:
    print(f"Blocked by .claude/hooks/guard_bash.sh: {reason}. See CLAUDE.md.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
PY
