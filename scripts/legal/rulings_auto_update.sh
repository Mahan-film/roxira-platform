#!/usr/bin/env bash
# Automatic ruling updates: the job the server timer runs (ops/systemd/roxira-rulings-update.timer, every 6 h).
# به‌روزرسانی خودکار آرای وحدت رویه: آرای جدید را از law_watch می‌سازد و به iran_rulings_v1 اضافه می‌کند.
#
#   bash scripts/legal/rulings_auto_update.sh [--dry-run]
#
# What it does, in order:
#   1. flock so runs never overlap (a second run exits 0 immediately);
#   2. keeps its OWN checkout (RULINGS_WORKER_DIR, default /opt/roxira_legal_worker) and fast-forwards it to origin/main;
#      it never touches, pulls or reads the state of the production checkout /opt/roxira_platform beyond reading its origin URL
#      once, on the first run, to create the worker clone;
#   3. runs scripts/legal/rulings_delta.py there, writing to RULINGS_STATE_DIR (default /var/lib/roxira/rulings, outside any git tree);
#   4. merges committed data/legal/staged/unity_rulings_delta_*.jsonl with the fresh delta (newest per ruling_id) and compares with state/upserted.json (ruling_id -> sha256 of holding+text); needs_review rows are never upserted;
#   5. only when something is new, calls upsert_rulings_delta_on_server.sh (REPO=worker checkout) on the new rows, and only after it
#      succeeded records them in the state file. Rows keep their unofficial source label (source_tier travels in the payload).
#
# --dry-run: runs steps 1-4 and the upsert script's own --dry-run (validate, embed plan); the state file is NOT updated.
# Exit 0 when nothing is new (or another run holds the lock); non-zero on any failure. Output goes to journald (stdout/stderr).
#
# Env: RULINGS_WORKER_DIR, RULINGS_STATE_DIR, RULINGS_WORKER_ORIGIN (clone source; default = origin URL of /opt/roxira_platform),
#      RULINGS_BRANCH (default main), RULINGS_SKIP_UPSERT=1 (TEST ONLY: skip docker/Qdrant and treat the upsert as successful).
set -euo pipefail

WORKER=${RULINGS_WORKER_DIR:-/opt/roxira_legal_worker}
STATE_DIR=${RULINGS_STATE_DIR:-/var/lib/roxira/rulings}
BRANCH=${RULINGS_BRANCH:-main}
PROD=${RULINGS_PROD_DIR:-/opt/roxira_platform}
ORIGIN=${RULINGS_WORKER_ORIGIN:-}
SKIP_UPSERT=${RULINGS_SKIP_UPSERT:-0}
export PYTHONDONTWRITEBYTECODE=1

DRY=0
for arg in "$@"; do
  case $arg in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n 2,20p "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '[rulings-auto] %s\n' "$*"; }
die() { printf '[rulings-auto] ERROR: %s\n' "$1" >&2; exit 1; }
command -v git >/dev/null || die "git not found"
command -v python3 >/dev/null || die "python3 not found"

mkdir -p "$STATE_DIR" "$STATE_DIR/out" "$STATE_DIR/pending"

# ---------------------------------------------------------------- 1. lock
command -v flock >/dev/null || die "flock not found"
exec 9>"$STATE_DIR/.lock"
if ! flock -n 9; then
  log "another run holds the lock; exiting 0"
  exit 0
fi
log "start $(date -u +%FT%TZ)$([ "$DRY" = 1 ] && echo ' (dry-run)')"

# ---------------------------------------------------------------- 2. own checkout, fast-forwarded
if [ ! -d "$WORKER/.git" ]; then
  if [ -z "$ORIGIN" ]; then
    [ -d "$PROD/.git" ] || die "no RULINGS_WORKER_ORIGIN and $PROD is not a git checkout"
    ORIGIN=$(git -C "$PROD" remote get-url origin) || die "cannot read origin URL of $PROD"
  fi
  [ ! -e "$WORKER" ] || [ -z "$(ls -A "$WORKER" 2>/dev/null)" ] || die "$WORKER exists and is not a git checkout"
  log "creating worker checkout $WORKER (branch $BRANCH)"
  git clone -q --branch "$BRANCH" "$ORIGIN" "$WORKER" || die "clone failed"
fi
cd "$WORKER"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$WORKER is not a git work tree"
[ -z "$(git status --porcelain)" ] || die "worker checkout $WORKER is not clean; fix it by hand (git status)"
git fetch -q origin "$BRANCH" || die "git fetch failed"
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -B "$BRANCH" "origin/$BRANCH"
git merge -q --ff-only "origin/$BRANCH" || die "cannot fast-forward $WORKER to origin/$BRANCH"
WORKER=$(pwd -P)
log "worker at $(git rev-parse --short HEAD) ($BRANCH)"

# ---------------------------------------------------------------- 3. delta
OUT="$STATE_DIR/out"
rm -f "$OUT"/unity_rulings_delta_*.jsonl
python3 scripts/legal/rulings_delta.py --out-dir "$OUT" || die "rulings_delta.py failed"

# ---------------------------------------------------------------- 4. what is new vs the state file
STATE_FILE="$STATE_DIR/upserted.json"
PENDING="$STATE_DIR/pending/unity_rulings_new.jsonl"
rm -f "$PENDING"
# Sources, newest wins per ruling_id: (a) every COMMITTED delta file in the worker checkout (git is not the truth of what the server
# holds; the state file is), (b) the freshly computed delta from rulings_delta.py.
shopt -s nullglob
DELTAS=("$WORKER"/data/legal/staged/unity_rulings_delta_*.jsonl "$OUT"/unity_rulings_delta_*.jsonl)
shopt -u nullglob
if [ "${#DELTAS[@]}" -eq 0 ]; then
  log "no delta rows; nothing new"
  exit 0
fi
NEW=$(python3 - "$STATE_FILE" "$PENDING" "${DELTAS[@]}" <<'PY'
import hashlib, json, sys
from pathlib import Path

state_file, pending, files = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:]
state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
best, review = {}, 0
for f in files:
    for ln in Path(f).read_text(encoding="utf-8").splitlines():
        if not ln.strip():
            continue
        r = json.loads(ln)
        k = str(r.get("wp_modified") or "")
        cur = best.get(r["ruling_id"])
        if cur is None or k >= str(cur.get("wp_modified") or ""):  # later file wins ties (fresh delta is listed last)
            best[r["ruling_id"]] = r
rows = []
for rid, r in sorted(best.items()):
    if r.get("needs_review"):
        review += 1
        continue
    h = hashlib.sha256(((r.get("holding") or "") + "\n" + (r.get("text") or "")).encode("utf-8")).hexdigest()
    if state.get(rid) != h:
        r["_h"] = h
        rows.append(r)
if rows:
    pending.write_text("".join(json.dumps({k: v for k, v in r.items() if k != "_h"}, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    pending.with_suffix(".hashes.json").write_text(json.dumps({r["ruling_id"]: r["_h"] for r in rows}), encoding="utf-8")
    for r in rows:
        print(f"  new: {r['ruling_id']}", file=sys.stderr)
print(len(rows))
print(f"needs_review rows held back: {review}", file=sys.stderr)
PY
)
if [ "$NEW" = 0 ]; then
  log "nothing new (all delta rows already upserted)"
  exit 0
fi
log "$NEW new ruling row(s) to upsert"

# ---------------------------------------------------------------- 5. upsert, then record state
if [ "$SKIP_UPSERT" = 1 ]; then
  log "RULINGS_SKIP_UPSERT=1: skipping the upsert call (test mode)"
else
  UP=()
  [ "$DRY" = 1 ] && UP+=(--dry-run)
  REPO="$WORKER" bash scripts/legal/upsert_rulings_delta_on_server.sh ${UP[@]+"${UP[@]}"} "$PENDING" || die "upsert failed; state not updated, next run retries"
fi
if [ "$DRY" = 1 ]; then
  log "dry-run: state file not updated"
  exit 0
fi
python3 - "$STATE_FILE" "${PENDING%.jsonl}.hashes.json" <<'PY'
import json, sys
from pathlib import Path

sf, hf = Path(sys.argv[1]), Path(sys.argv[2])
state = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {}
state.update(json.loads(hf.read_text(encoding="utf-8")))
tmp = sf.with_suffix(".tmp")
tmp.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
tmp.replace(sf)
print(f"state updated: {len(state)} ruling id(s) recorded")
PY
log "done"
