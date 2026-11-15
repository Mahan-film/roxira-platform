#!/usr/bin/env bash
# Lane preflight: run once at the start of every Antigravity chat, on any machine (macOS or Linux).
#   bash scripts/dev/lane_preflight.sh L1
# Prints one OK/WARN/FAIL line per check, with the fix for each FAIL. Exit 1 if any FAIL.
# Portable to macOS bash 3.2 (no associative arrays, no ${var,,}).
set -u

LANE="${1:-}"
REPO="${ROXIRA_REPO:-Mahan-film/roxira-platform}"
fails=0
ok()   { printf 'OK    %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n      fix: %s\n' "$1" "$2"; fails=$((fails + 1)); }

case "$LANE" in
  L1|L2|L3|L4) ok "lane $LANE" ;;
  *) fail "lane id missing or wrong ('$LANE')" "bash scripts/dev/lane_preflight.sh L1   (first line of the prompt says which lane)" ;;
esac

if root=$(git rev-parse --show-toplevel 2>/dev/null); then
  ok "git clone at $root"
  url=$(git remote get-url origin 2>/dev/null || true)
  case "$url" in
    *Mahan-film/roxira-platform*) ok "origin = $REPO" ;;
    *) fail "origin is '$url'" "git remote set-url origin git@github.com:$REPO.git" ;;
  esac
  if git fetch -q origin main 2>/dev/null; then
    behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
    ok "git fetch works (this branch is $behind commits behind origin/main)"
  else
    fail "git fetch origin failed" "check network/VPN and: ssh -T git@github.com  (or gh auth setup-git)"
  fi
  hooks=$(git rev-parse --git-path hooks)
  if [ -f "$hooks/pre-push" ] && grep -q 'roxira-local-ci' "$hooks/pre-push" 2>/dev/null; then
    ok "pre-push hook installed"
  else
    warn "pre-push hook missing: bash scripts/dev/install_hooks.sh"
  fi
else
  fail "not inside the roxira-platform clone" "cd into your clone, or: gh repo clone $REPO && cd roxira-platform"
fi

if command -v gh >/dev/null 2>&1; then
  if login=$(gh api user --jq .login 2>/dev/null); then
    ok "gh logged in as $login"
    if gh issue view 592 --repo "$REPO" --json number --jq .number >/dev/null 2>&1; then
      ok "issue 592 readable"
    else
      fail "cannot read issue 592" "gh auth refresh -h github.com -s repo   (account needs access to $REPO)"
    fi
  else
    fail "gh not logged in" "gh auth login -h github.com   (use the lane account, not the hub account)"
  fi
else
  fail "gh CLI not installed" "macOS: brew install gh   Linux: see cli.github.com"
fi

if command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
    ok "python3 $(python3 -c 'import platform; print(platform.python_version())')"
  else
    fail "python3 older than 3.9" "macOS: brew install python@3.12"
  fi
else
  fail "python3 not installed" "macOS: brew install python@3.12"
fi

if [ -n "${root:-}" ] && [ -f "$root/scripts/dev/verify_agent_report.py" ]; then
  ok "verify_agent_report.py present"
else
  warn "scripts/dev/verify_agent_report.py not found on this branch: git checkout main && git pull"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "docker running (needed for DB specs)"
else
  warn "docker not running: specs that need Postgres will fail; start Docker Desktop, or mark those rows BLOCKED"
fi

for t in node; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t $("$t" --version 2>/dev/null | head -1)"; else warn "$t not installed (only needed for its own specs)"; fi
done

if [ -n "${root:-}" ] && [ -n "$(git status --porcelain 2>/dev/null | head -1)" ]; then
  warn "uncommitted changes in this checkout: commit them on their own branch or stash before a new task"
fi

if [ "$fails" -eq 0 ]; then echo "PREFLIGHT: OK"; else echo "PREFLIGHT: $fails FAIL"; exit 1; fi
