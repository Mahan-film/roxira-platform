#!/usr/bin/env bash
# Offline test for prune_worktrees.sh. Builds a fake repo under $TMPDIR with one worktree per class and a
# stubbed `gh` (no network). Run: bash scripts/ops/test_prune_worktrees.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/pwt.XXXXXX")"
trap 'rm -r -- "$T"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid

# stub gh: `gh pr list --head <branch> ...` prints "STATE oid" lines from $T/gh/<branch with / -> _>; file named ERR_* fails
mkdir -p "$T/bin" "$T/gh"
cat >"$T/bin/gh" <<EOS
#!/usr/bin/env bash
echo "gh \$*" >>"$T/gh_calls"
[ "\$1 \$2" = "pr list" ] || exit 1
while [ \$# -gt 0 ]; do [ "\$1" = "--head" ] && b="\$2"; shift; done
f="$T/gh/\$(echo "\$b" | tr / _)"
[ -e "\$f.err" ] && exit 1
[ -e "\$f" ] && cat "\$f"
exit 0
EOS
chmod +x "$T/bin/gh"
export GH_BIN="$T/bin/gh" REPORT_FILE="$T/report.txt" CACHE_PATHS="fake=$T/nocache"

git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/main" 2>/dev/null
cd "$T/main" || exit 1
git checkout -q -b main
echo base >f; git add f; git commit -q -m base; git push -q origin main
BASE="$(git rev-parse HEAD)"

# mk <name> [pushed=1]: worktree wt/<name> on branch b/<name> with one extra commit, optionally pushed
mk() {
  git worktree add -q -b "b/$1" "$T/wt/$1" main
  (cd "$T/wt/$1" && echo "$1" >"$1.txt" && git add "$1.txt" && git commit -q -m "$1" && { [ "${2:-1}" = 1 ] && git push -q origin "b/$1" || true; })
}
head_of() { git -C "$T/wt/$1" rev-parse HEAD; }

mk safe_merged;    echo "MERGED $(head_of safe_merged)" >"$T/gh/b_safe_merged"
mk safe_contained; echo "CLOSED $BASE" >"$T/gh/b_safe_contained"          # PR head differs, but HEAD is on origin
mk dirty;          echo "MERGED $(head_of dirty)" >"$T/gh/b_dirty"; echo x >>"$T/wt/dirty/f"
mk untracked;      echo "MERGED $(head_of untracked)" >"$T/gh/b_untracked"; echo x >"$T/wt/untracked/new.txt"
mk openpr;         printf 'MERGED %s\nOPEN %s\n' "$BASE" "$(head_of openpr)" >"$T/gh/b_openpr"
mk nopr
mk unpushed 0;     echo "MERGED $BASE" >"$T/gh/b_unpushed"                  # HEAD neither a PR head nor on a remote
mk ghfail;         touch "$T/gh/b_ghfail.err"
mk locked;         echo "MERGED $(head_of locked)" >"$T/gh/b_locked"; git worktree lock "$T/wt/locked"
mk current;        echo "MERGED $(head_of current)" >"$T/gh/b_current"      # safe-looking, but we run from here
git worktree add -q --detach "$T/wt/detached" main
mk gone;           echo "MERGED $(head_of gone)" >"$T/gh/b_gone"; mv "$T/wt/gone" "$T/gone.moved"   # prunable

cd "$T/wt/current" || exit 1
out="$(bash "$HERE/prune_worktrees.sh" 2>&1)"
# shellcheck disable=SC2329  # called via eval in check()
cls() { printf '%s\n' "$out" | grep -E "^  [A-Z_]+ +dirty=.*$1( |$)" | awk '{print $1}'; }
for p in "safe_merged:SAFE" "safe_contained:SAFE"; do
  n="${p%%:*}"; check "dry-run lists $n as SAFE" "printf '%s\n' \"\$out\" | grep -q \"b/$n  .*/wt/$n\$\""
done
check "dirty -> DIRTY" "[ \"\$(cls /wt/dirty)\" = DIRTY ]"
check "untracked -> DIRTY" "[ \"\$(cls /wt/untracked)\" = DIRTY ]"
check "openpr -> OPEN_PR" "[ \"\$(cls /wt/openpr)\" = OPEN_PR ]"
check "nopr -> NO_PR" "[ \"\$(cls /wt/nopr)\" = NO_PR ]"
check "detached -> NO_PR" "[ \"\$(cls /wt/detached)\" = NO_PR ]"
check "unpushed -> UNPUSHED" "[ \"\$(cls /wt/unpushed)\" = UNPUSHED ]"
check "gh failure -> UNKNOWN (fail closed)" "[ \"\$(cls /wt/ghfail)\" = UNKNOWN ]"
check "locked -> LOCKED" "[ \"\$(cls /wt/locked)\" = LOCKED ]"
check "unpushed count reported" "printf '%s\n' \"\$out\" | grep -q 'unpushed=1 .*/wt/unpushed'"
check "dirty count reported" "printf '%s\n' \"\$out\" | grep -q 'dirty=1 .*/wt/dirty'"
check "current worktree excluded" "! printf '%s\n' \"\$out\" | grep -q 'b/current'"
check "main checkout excluded" "! printf '%s\n' \"\$out\" | grep -q \"  $T/main\$\""
check "SAFE count is 2" "printf '%s\n' \"\$out\" | grep -qE '^SAFE +2 '"
check "report file written" "[ -s \"$T/report.txt\" ]"
check "missing cache reported, not an error" "printf '%s\n' \"\$out\" | grep -q 'fake: not present'"
check "dry-run removed nothing" "[ -d $T/wt/safe_merged ] && [ -d $T/wt/safe_contained ]"

out="$(bash "$HERE/prune_worktrees.sh" --apply 2>&1)"; rc=$?
check "--apply exits 0" "[ $rc = 0 ]"
check "--apply removed safe_merged" "[ ! -d $T/wt/safe_merged ]"
check "--apply removed safe_contained" "[ ! -d $T/wt/safe_contained ]"
for k in dirty untracked openpr nopr unpushed ghfail locked current detached; do
  check "--apply kept $k" "[ -d $T/wt/$k ]"
done
check "--apply kept main checkout" "[ -d $T/main/.git ]"
check "--apply kept branches" "git -C $T/main rev-parse --verify -q b/safe_merged >/dev/null"
check "dirty edit intact" "grep -q x $T/wt/dirty/f"
check "script never passes --force to git" "! grep -v '^#' \"$HERE/prune_worktrees.sh\" | grep -q -e '--force'"
exit "$fail"
