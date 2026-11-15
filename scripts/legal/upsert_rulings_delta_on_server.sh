#!/usr/bin/env bash
# Upsert delta ruling files (scripts/legal/rulings_delta.py output) into the EXISTING Qdrant collection iran_rulings_v1 ON the server.
# افزودن آرای جدید (دلتا) به کالکشن موجود iran_rulings_v1. کالکشن را نمی‌سازد و حذف نمی‌کند؛ سرویس را عوض نمی‌کند.
#
#   cd /opt/roxira_platform && bash scripts/legal/upsert_rulings_delta_on_server.sh [--dry-run] [--include-review] FILE.jsonl [FILE2.jsonl ...]
#
#   --dry-run         preflight + filter + validate + ingest dry-run only; nothing is written.
#   --include-review  also upsert rows with needs_review=true (default: they are skipped and counted).
#
# Point ids are deterministic (ingest_pipeline.point_id), so a rerun overwrites the same points: idempotent. Refuses when the collection
# does not exist (the first build is build_rulings_collection_on_server.sh). Takes a Qdrant snapshot of the collection before writing.
# Never touches iran_laws_v2/v3 and never prints env values. Server timer for this job needs owner approval (docs/legal/RULINGS_DESIGN.md).
set -euo pipefail

DST=iran_rulings_v1
QDRANT=${QDRANT_URL:-http://127.0.0.1:6333}
REPO=/opt/roxira_platform
APP=roxira_app_prod
QDR=roxira_qdrant_prod
MIN_FREE_GB=${MIN_FREE_GB:-3}

DRY=0 INCLUDE_REVIEW=0
FILES=()
for arg in "$@"; do
  case $arg in
    --dry-run) DRY=1 ;;
    --include-review) INCLUDE_REVIEW=1 ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    -*) echo "unknown argument: $arg" >&2; exit 2 ;;
    *) FILES+=("$arg") ;;
  esac
done
[ "${#FILES[@]}" -gt 0 ] || { echo "usage: $0 [--dry-run] [--include-review] FILE.jsonl ..." >&2; exit 2; }

step() { printf '\n=== %s ===\n' "$*"; }
die() {
  printf '\nخطا / ERROR: %s\n' "$1" >&2
  printf 'متوقف شد؛ سرویس production و کالکشن‌های قوانین تغییر نکرده‌اند. / Stopped; serving and the law collections were not touched.\n' >&2
  exit 1
}
count() { # points_count of a collection, empty if missing
  curl -fsS "$QDRANT/collections/$1" 2>/dev/null |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["points_count"])' 2>/dev/null || true
}
http_code() { curl -s -o /dev/null -w '%{http_code}' "$QDRANT/collections/$1" || true; }

# ---------------------------------------------------------------- 1. preflight
step "1. Preflight / بررسی‌های اولیه"
[ "$(pwd -P)" = "$REPO" ] || die "run from $REPO (cd $REPO first) / باید داخل $REPO اجرا شود"
for b in docker curl python3; do command -v "$b" >/dev/null || die "$b not found"; done
[ -z "$(git status --porcelain)" ] || die "git tree is not clean / درخت git تمیز نیست (git status)"
echo "git: clean at $(git rev-parse --short HEAD)"
for c in "$APP" "$QDR"; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || true)" = true ] || die "container $c is not running / کانتینر $c بالا نیست"
done
for f in "${FILES[@]}" scripts/legal/ingest_rulings.py scripts/legal/ingest_pipeline.py; do
  [ -f "$f" ] || die "missing file $f / فایل وجود ندارد (git pull / checkout the merged commit)"
done
[ "$(http_code "$DST")" = 200 ] || die "$DST does not exist; build it first with build_rulings_collection_on_server.sh / کالکشن وجود ندارد"
BEFORE=$(count "$DST")
echo "$DST points before: $BEFORE"
free_kb=$(docker exec "$QDR" df -Pk /qdrant/storage 2>/dev/null | awk 'NR==2{print $4}' || true)
[ -n "$free_kb" ] || free_kb=$(df -Pk "$REPO" | awk 'NR==2{print $4}')
free_gb=$((free_kb / 1024 / 1024))
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "only ${free_gb} GB free, need >= ${MIN_FREE_GB} GB / فضای دیسک کافی نیست"
echo "disk free: ${free_gb} GB (min ${MIN_FREE_GB})"

# ---------------------------------------------------------------- 2. filter needs_review rows (host python, stdlib only)
step "2. Select rows / انتخاب ردیف‌ها"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP" "$INCLUDE_REVIEW" "${FILES[@]}" <<'PY'
import json, sys
from pathlib import Path

out, include_review, files = Path(sys.argv[1]), sys.argv[2] == "1", sys.argv[3:]
total = kept = skipped = 0
for i, f in enumerate(files):
    rows = []
    for ln in Path(f).read_text(encoding="utf-8").splitlines():
        if not ln.strip():
            continue
        total += 1
        r = json.loads(ln)
        if r.get("needs_review") and not include_review:
            skipped += 1
            print(f"  skip needs_review: {r.get('ruling_id')}")
            continue
        kept += 1
        rows.append(ln)
    (out / f"{i:02d}_{Path(f).name}").write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
print(f"rows read: {total}, to upsert: {kept}, skipped (needs_review): {skipped}")
(out / "COUNTS").write_text(f"{kept}\n", encoding="utf-8")
PY
KEPT=$(cat "$TMP/COUNTS")
if [ "$KEPT" = 0 ]; then
  echo "nothing to upsert."
  exit 0
fi
SEL=()
for f in "$TMP"/*.jsonl; do [ -s "$f" ] && SEL+=("/delta/$(basename "$f")"); done

IMG=$(docker inspect -f '{{.Config.Image}}' "$APP")
run() { # python helper in the app image, sharing Qdrant's network namespace (127.0.0.1:6333 = Qdrant)
  docker run --rm --network "container:$QDR" --volumes-from "$APP" \
    -v "$REPO:/repo:ro" -v "$TMP:/delta:ro" -w /repo -e QDRANT_HOST=127.0.0.1 -e QDRANT_PORT=6333 \
    "$IMG" python3 "$@"
}
run_step() {
  local desc=$1
  shift
  echo "--- $desc"
  run "$@" || die "step failed: $desc / مرحله ناموفق: $desc"
}

step "Validate / اعتبارسنجی (no writes)"
run_step "validate rulings" scripts/legal/ingest_rulings.py validate "${SEL[@]}"
run_step "apply dry run" scripts/legal/ingest_rulings.py apply "${SEL[@]}" --collection "$DST" --allow-existing --dry-run
if [ "$DRY" = 1 ]; then
  echo "[dry-run] stopping before any write. Planned: snapshot $DST, upsert $KEPT row(s) into it (bge-m3, deterministic ids)"
  exit 0
fi

# ---------------------------------------------------------------- 3. snapshot, upsert, verify
step "3. Snapshot $DST / اسنپ‌شات"
snap=$(curl -fsS -X POST "$QDRANT/collections/$DST/snapshots" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["name"])') || die "snapshot of $DST failed"
echo "snapshot: $snap  (stored in $QDR:/qdrant/storage/snapshots/$DST/)"

step "4. Upsert / افزودن"
run_step "apply --allow-existing (embeds with bge-m3)" scripts/legal/ingest_rulings.py apply "${SEL[@]}" --collection "$DST" --allow-existing
AFTER=$(count "$DST")
echo "$DST points: before=$BEFORE after=$AFTER added=$((AFTER - BEFORE)) (rows upserted: $KEPT; re-upserted existing ids do not add points)"
[ -n "$AFTER" ] && [ "$AFTER" -ge "$BEFORE" ] || die "point count dropped or unreadable after the upsert"
echo
echo "done / پایان. Laws untouched; serving flag unchanged."
