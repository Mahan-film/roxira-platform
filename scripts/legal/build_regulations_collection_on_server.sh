#!/usr/bin/env bash
# Build the Qdrant collection iran_regulations_v1 (deregulation-board resolutions + CBI circulars) ON the production server.
# ساخت کالکشن iran_regulations_v1 (مصوبات هیئت مقررات‌زدایی + بخشنامه‌های بانک مرکزی). سرویس production را عوض نمی‌کند.
#
#   cd /opt/roxira_platform && bash scripts/legal/build_regulations_collection_on_server.sh [--dry-run] [--rebuild]
#
#   --dry-run  preflight + validate + ingest dry-run only; nothing is written.
#   --rebuild  delete ONLY iran_regulations_v1 (after typing its name on /dev/tty) and build it again.
#
# Never touches iran_laws_v2/v3 or iran_rulings_v1 (only reads their point counts). Never switches serving: the flag
# SMARTJUDGE_REGULATIONS_COLLECTION stays unset until the owner runs the printed command. Never prints env values.
# Design: output_apps/generated_modules/smartjudge/regulations_retrieval.py.
set -euo pipefail

DST=iran_regulations_v1
LAWS=iran_laws_v3
RULINGS=iran_rulings_v1
QDRANT=${QDRANT_URL:-http://127.0.0.1:6333}
REPO=/opt/roxira_platform
APP=roxira_app_prod
QDR=roxira_qdrant_prod
MIN_FREE_GB=${MIN_FREE_GB:-3}
STAGED=data/legal/staged
FILES=(
  "$STAGED/deregulation_board_2026-10-13.jsonl"
  "$STAGED/circulars_2026-10-13.jsonl"
)
GOLDEN=data/eval/chat_golden/regulations_golden_2026-10-13.json

DRY=0 REBUILD=0
for arg in "$@"; do
  case $arg in
    --dry-run) DRY=1 ;;
    --rebuild) REBUILD=1 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s ===\n' "$*"; }
die() {
  printf '\nخطا / ERROR: %s\n' "$1" >&2
  printf 'متوقف شد؛ سرویس production و کالکشن‌های قوانین/آرا تغییر نکرده‌اند. / Stopped; serving and the law/rulings collections were not touched.\n' >&2
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
for f in "${FILES[@]}" scripts/legal/ingest_regulations.py scripts/legal/ingest_pipeline.py; do
  [ -f "$f" ] || die "missing file $f / فایل وجود ندارد (git pull / checkout the merged commit)"
done
LAW_COUNT=$(count "$LAWS")
echo "$LAWS points (read only): ${LAW_COUNT:-missing}"
echo "$RULINGS points (read only): $(count "$RULINGS" || true)"

EXISTS=0
if [ "$(http_code "$DST")" = 200 ]; then
  EXISTS=1
  if [ "$REBUILD" = 1 ]; then
    [ "$DRY" = 0 ] || die "--rebuild is not allowed together with --dry-run"
    [ -r /dev/tty ] || die "no /dev/tty for confirmation / ترمینال برای تأیید وجود ندارد"
    echo "$DST exists ($(count "$DST") points); --rebuild deletes it after validation succeeds."
  else
    die "$DST already exists ($(count "$DST") points). Use --rebuild to delete and rebuild it / $DST از قبل هست؛ برای ساخت مجدد --rebuild"
  fi
fi
free_kb=$(docker exec "$QDR" df -Pk /qdrant/storage 2>/dev/null | awk 'NR==2{print $4}' || true)
[ -n "$free_kb" ] || free_kb=$(df -Pk "$REPO" | awk 'NR==2{print $4}')
free_gb=$((free_kb / 1024 / 1024))
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "only ${free_gb} GB free, need >= ${MIN_FREE_GB} GB / فضای دیسک کافی نیست"
echo "disk free: ${free_gb} GB (min ${MIN_FREE_GB})"

IMG=$(docker inspect -f '{{.Config.Image}}' "$APP")
EXTRA_ENV=()
run() { # python helper in the app image, sharing Qdrant's network namespace (127.0.0.1:6333 = Qdrant)
  docker run --rm --network "container:$QDR" --volumes-from "$APP" \
    -v "$REPO:/repo:ro" -w /repo -e QDRANT_HOST=127.0.0.1 -e QDRANT_PORT=6333 \
    "${EXTRA_ENV[@]}" "$IMG" python3 "$@"
}
run_step() {
  local desc=$1
  shift
  echo "--- $desc"
  run "$@" || die "step failed: $desc / مرحله ناموفق: $desc"
}

step "Validate staged files / اعتبارسنجی فایل‌ها (no writes)"
run_step "validate regulations" scripts/legal/ingest_regulations.py validate "${FILES[@]}"
run_step "apply dry run" scripts/legal/ingest_regulations.py apply "${FILES[@]}" --collection "$DST" --allow-existing --dry-run
if [ "$DRY" = 1 ]; then
  echo "[dry-run] stopping before any write. Planned: create $DST (bge-m3, 1024-d, cosine), snapshot it"
  exit 0
fi

# ---------------------------------------------------------------- 2. build
step "2. Build $DST / ساخت"
if [ "$EXISTS" = 1 ]; then
  printf 'This DELETES %s (%s points). The law/rulings collections are not touched. Type the collection name to confirm: ' "$DST" "$(count "$DST")" >/dev/tty
  read -r answer </dev/tty
  [ "$answer" = "$DST" ] || die "confirmation mismatch; nothing deleted / تأیید نادرست؛ چیزی حذف نشد"
  curl -fsS -X DELETE "$QDRANT/collections/$DST" >/dev/null || die "delete of $DST failed"
  echo "deleted $DST"
fi
run_step "apply (embeds with bge-m3, writes $DST)" scripts/legal/ingest_regulations.py apply "${FILES[@]}" --collection "$DST"
got=$(count "$DST")
echo "$DST points: $got"
[ -n "$got" ] && [ "$got" -gt 0 ] || die "$DST is empty after the build"

# ---------------------------------------------------------------- 3. snapshot (backup of the NEW collection)
step "3. Snapshot $DST / اسنپ‌شات"
snap=$(curl -fsS -X POST "$QDRANT/collections/$DST/snapshots" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["name"])') || die "snapshot of $DST failed"
echo "snapshot: $snap  (stored in $QDR:/qdrant/storage/snapshots/$DST/)"

# ---------------------------------------------------------------- 4. eval (optional: no regulations golden yet)
step "4. Retrieval-only eval (no LLM, no cost) / ارزیابی بازیابی"
if [ -f "$GOLDEN" ]; then
  OUT=$(mktemp -d)
  EXTRA_ENV=(-e "LIGHTRAG_QDRANT_COLLECTION=$DST")
  run scripts/eval_chat_golden.py --retrieval-only --retrieval-set "$GOLDEN" >"$OUT/regulations.txt" 2>"$OUT/regulations.err" || true
  [ -s "$OUT/regulations.txt" ] || die "eval produced no output (see $OUT/regulations.err)"
  grep -q "^collection=$DST " "$OUT/regulations.txt" || die "eval used another collection than $DST (embedder guard?) see $OUT/regulations.txt"
  cat "$OUT/regulations.txt"
  EXTRA_ENV=()
  echo "raw eval output: $OUT"
else
  echo "no golden set yet ($GOLDEN); skipping retrieval eval. The law/rulings goldens do not cover regulations."
fi

# ---------------------------------------------------------------- 5. switch / rollback
step "5. Switch and rollback (NOT executed) / فعال‌سازی و بازگشت (اجرا نشد)"
cat <<'TXT'
Switch on (owner approval needed; flag read by service enterprise_app / container roxira_app_prod; unset = off):
  cd /opt/roxira_platform
  cp .env /root/env-backups/.env.before-regulations && chmod 600 /root/env-backups/.env.before-regulations
  grep -q '^SMARTJUDGE_REGULATIONS_COLLECTION=' .env \
    && sed -i 's/^SMARTJUDGE_REGULATIONS_COLLECTION=.*/SMARTJUDGE_REGULATIONS_COLLECTION=iran_regulations_v1/' .env \
    || echo 'SMARTJUDGE_REGULATIONS_COLLECTION=iran_regulations_v1' >> .env
  docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate enterprise_app

Rollback (the law/rulings collections are untouched; the flag alone controls regulations):
  cd /opt/roxira_platform
  sed -i 's/^SMARTJUDGE_REGULATIONS_COLLECTION=.*/SMARTJUDGE_REGULATIONS_COLLECTION=/' .env
  docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate enterprise_app
TXT
echo
echo "done / پایان. Laws/rulings untouched; serving not switched."
