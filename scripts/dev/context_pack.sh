#!/usr/bin/env bash
# Write one Markdown file with the current project context for another AI or a reviewer:
# docs/CONTEXT_HUB.md, docs/STATE.md, docs/SYSTEM_MAP.md, the strategy index, the last 40 commits on
# origin/main and the open PRs. Docs only: no code, no data, no secrets.
#
# Usage: bash scripts/dev/context_pack.sh [output_dir]   (default: current directory)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
OUT_DIR="${1:-.}"
OUT="$OUT_DIR/context_pack_$(date +%Y-%m-%d).md"

git -C "$ROOT" fetch --quiet origin main 2>/dev/null || true
REF="origin/main"
git -C "$ROOT" rev-parse --verify --quiet "$REF" >/dev/null || REF="HEAD"

section() {  # $1 title, $2 repo path
  printf '\n\n---\n\n# %s (`%s`)\n\n' "$1" "$2"
  git -C "$ROOT" show "$REF:$2" 2>/dev/null || echo "(missing: $2)"
}

{
  printf '# Roxira context pack — %s (from %s @ %s)\n' "$(date +%Y-%m-%d)" "$REF" \
    "$(git -C "$ROOT" rev-parse --short "$REF")"
  section "Context hub" "docs/CONTEXT_HUB.md"
  section "Current state" "docs/STATE.md"
  section "System map" "docs/SYSTEM_MAP.md"
  printf '\n\n---\n\n# Strategy documents\n\n'
  git -C "$ROOT" ls-tree --name-only "$REF" docs/strategy/ | sed 's/^/- /'
  printf '\n\n---\n\n# Last 40 commits on main\n\n```\n'
  git -C "$ROOT" log --oneline -40 "$REF"
  printf '```\n'
  if command -v gh >/dev/null 2>&1; then
    printf '\n\n---\n\n# Open pull requests\n\n```\n'
    gh pr list --repo Mahan-film/roxira-platform --state open --limit 30 2>/dev/null || echo "(gh not available)"
    printf '```\n'
  fi
} >"$OUT"

echo "wrote $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)"
