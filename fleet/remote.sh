#!/usr/bin/env bash
# Usage: remote.sh <pushed-branch> <command...>   (runs in output_apps/enterprise_hub of a fresh Daytona sandbox)
# Example: remote.sh my-branch npx jest --maxWorkers=4 modules/sales
# Env knobs: REMOTE_CPU/MEM/DISK (4/4/10), REMOTE_TIMEOUT (1500s), REMOTE_MAX (4), REMOTE_PG=auto|1|0.
set -u
[ $# -ge 2 ] || { echo "usage: remote.sh <branch> <command...>" >&2; exit 2; }
br=$1; shift
REPO_URL=https://github.com/Mahan-film/roxira-platform.git
sha=$(git ls-remote "$REPO_URL" "refs/heads/$br" 2>/dev/null | cut -c1-7)
[ -n "$sha" ] || { echo "branch '$br' is not pushed to $REPO_URL (a clone contains only pushed commits)" >&2; exit 2; }
echo "[remote] branch $br @ $sha (public clone; only pushed, tracked files ship)"
# warn when a local checkout of this branch differs from what ships
wt=$(git -C /home/mahan/Developer/roxira-platform worktree list --porcelain 2>/dev/null | awk -v b="refs/heads/$br" '/^worktree /{w=$2} $1=="branch"&&$2==b{print w}')
if [ -n "$wt" ]; then
  [ -n "$(git -C "$wt" status --porcelain 2>/dev/null | head -1)" ] && echo "[remote] WARNING: $wt has uncommitted changes that will NOT be in the sandbox"
  lh=$(git -C "$wt" rev-parse --short=7 HEAD); [ "$lh" != "$sha" ] && echo "[remote] WARNING: local HEAD $lh != pushed $sha"
fi
# load keys without printing; pass ONLY the Daytona keys on to python
set -a; . "$HOME/Secrets/roxira/roxira.env" >/dev/null 2>&1; set +a
exec env -i PATH="$PATH" HOME="$HOME" \
  ${DAYTONA_API_KEY:+DAYTONA_API_KEY="$DAYTONA_API_KEY"} ${DAYTONA_API_KEY_2:+DAYTONA_API_KEY_2="$DAYTONA_API_KEY_2"} \
  ${DAYTONA_API_KEY_3:+DAYTONA_API_KEY_3="$DAYTONA_API_KEY_3"} ${DAYTONA_API_KEY_4:+DAYTONA_API_KEY_4="$DAYTONA_API_KEY_4"} \
  ${REMOTE_CPU:+REMOTE_CPU=$REMOTE_CPU} ${REMOTE_MEM:+REMOTE_MEM=$REMOTE_MEM} ${REMOTE_DISK:+REMOTE_DISK=$REMOTE_DISK} \
  ${REMOTE_TIMEOUT:+REMOTE_TIMEOUT=$REMOTE_TIMEOUT} ${REMOTE_MAX:+REMOTE_MAX=$REMOTE_MAX} ${REMOTE_PG:+REMOTE_PG=$REMOTE_PG} \
  python3 -I "$(dirname "$(readlink -f "$0")")/remote.py" "$br" "$@"
