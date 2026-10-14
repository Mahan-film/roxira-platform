#!/usr/bin/env bash
# Build and evaluate the Qdrant collection iran_laws_v4 ON the production server.
# ساخت و ارزیابی کالکشن iran_laws_v4 روی سرور. سرویس production را عوض نمی‌کند.
#
#   cd /opt/roxira_platform && bash scripts/legal/build_v4_on_server.sh [--dry-run] [--rebuild]
#
#   --dry-run  preflight + validate + merge + build_collection --dry-run only; nothing is written.
#   --rebuild  delete ONLY iran_laws_v4 (after typing its name on /dev/tty) and build it again.
#
# Inputs are the v3 files first, then the 2026-10-13 staged files; a later input wins when the
# same law+article+section appears again (dedupe_staged_rows.py). needs_review rows are kept.
# Never modifies or deletes iran_laws_v3 (only reads it and takes a snapshot). Never switches
# serving. Never prints env values. Source of truth: docs/legal/BUILD_V4.md.
set -euo pipefail

SRC=iran_laws_v3
DST=iran_laws_v4
QDRANT=${QDRANT_URL:-http://127.0.0.1:6333}
REPO=/opt/roxira_platform
APP=roxira_app_prod
QDR=roxira_qdrant_prod
MIN_FREE_GB=${MIN_FREE_GB:-5}
LEASE_LAW="قانون روابط موجر و مستاجر ۱۳۷۶"
STAGED=data/legal/staged
# applied in this order (lowest priority first); *.repealed.jsonl is never listed here
FILES=(
  "$STAGED/corpus_fill_2026-10-11.jsonl"
  "$STAGED/corpus_fill_2026-10-11_replace_lease1376.jsonl"
  "$STAGED/corpus_fill_2026-10-12_ekhtebar.jsonl"
  "$STAGED/coverage_nezamat_2026-10-13.jsonl"
  "$STAGED/qavanin_2026-10-13.jsonl"
  "$STAGED/qavanin_laws_2026-10-13.jsonl"
  "$STAGED/deregulation_board_2026-10-13.jsonl"
  "$STAGED/circulars_2026-10-13.jsonl"
)
SETS=(retrieval_golden retrieval_golden_new_laws retrieval_golden_crawl_2026-10-12)

DRY=0 REBUILD=0
for arg in "$@"; do
  case $arg in
    --dry-run) DRY=1 ;;
    --rebuild) REBUILD=1 ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s ===\n' "$*"; }
die() {
  printf '\nخطا / ERROR: %s\n' "$1" >&2
  printf 'متوقف شد؛ چیزی روی %s تغییر نکرده است. / Stopped; %s was not touched.\n' "$SRC" "$SRC" >&2
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
command -v docker >/dev/null || die "docker not found"
command -v curl >/dev/null || die "curl not found"
command -v python3 >/dev/null || die "python3 not found"
[ -z "$(git status --porcelain)" ] || die "git tree is not clean / درخت git تمیز نیست (git status)"
echo "git: clean at $(git rev-parse --short HEAD)"
for c in "$APP" "$QDR"; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || true)" = true ] ||
    die "container $c is not running / کانتینر $c بالا نیست"
done
echo "containers: $APP, $QDR up"
for f in "${FILES[@]}" scripts/legal/build_collection.py scripts/legal/ingest_pipeline.py \
         scripts/legal/dedupe_staged_rows.py scripts/eval_chat_golden.py; do
  [ -f "$f" ] || die "missing file $f / فایل وجود ندارد (git pull / checkout the merged commit)"
done
for f in "${FILES[@]}"; do
  case $f in *.repealed.jsonl) die "refusing to ingest a repealed side file $f / فایل منسوخ نباید وارد شود" ;; esac
done
for s in "${SETS[@]}"; do
  [ -f "data/eval/chat_golden/$s.json" ] || die "missing golden set $s / مجموعهٔ طلایی وجود ندارد"
done
V3_COUNT=$(count "$SRC")
[ -n "$V3_COUNT" ] || die "$SRC not found in Qdrant / $SRC پیدا نشد"
echo "$SRC points: $V3_COUNT (expected 5822)"

V4_EXISTS=0
if [ "$(http_code "$DST")" = 200 ]; then
  V4_EXISTS=1
  if [ "$REBUILD" = 1 ]; then
    [ "$DRY" = 0 ] || die "--rebuild is not allowed together with --dry-run"
    [ -r /dev/tty ] || die "no /dev/tty for confirmation / ترمینال برای تأیید وجود ندارد"
    echo "$DST exists ($(count "$DST") points); --rebuild will delete it after validation and snapshot succeed."
  else
    die "$DST already exists ($(count "$DST") points). Use --rebuild to delete and rebuild it / $DST از قبل هست؛ برای ساخت مجدد --rebuild"
  fi
fi

free_kb=$(docker exec "$QDR" df -Pk /qdrant/storage 2>/dev/null | awk 'NR==2{print $4}' || true)
[ -n "$free_kb" ] || free_kb=$(df -Pk "$REPO" | awk 'NR==2{print $4}')
free_gb=$((free_kb / 1024 / 1024))
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "only ${free_gb} GB free, need >= ${MIN_FREE_GB} GB / فضای دیسک کافی نیست"
echo "disk free: ${free_gb} GB (min ${MIN_FREE_GB})"

# work dir shared with the app container for the merged (deduped) input
WORK=$(mktemp -d)
MERGED=/work/merged.jsonl

# python helper inside the app image, sharing Qdrant's network namespace (127.0.0.1:6333 = Qdrant)
IMG=$(docker inspect -f '{{.Config.Image}}' "$APP")
EXTRA_ENV=()
run() {
  docker run --rm --network "container:$QDR" --volumes-from "$APP" \
    -v "$REPO:/repo:ro" -v "$WORK:/work" -w /repo -e QDRANT_HOST=127.0.0.1 -e QDRANT_PORT=6333 \
    "${EXTRA_ENV[@]}" "$IMG" python3 "$@"
}
run_step() { # description, then command args; stops on first failure
  local desc=$1
  shift
  echo "--- $desc"
  run "$@" || die "step failed: $desc / مرحله ناموفق: $desc"
}

# ---------------------------------------------------------------- gates (read-only)
step "Validate staged files / اعتبارسنجی فایل‌ها (no writes)"
for f in "${FILES[@]}"; do
  run_step "validate $f" scripts/legal/ingest_pipeline.py validate "$f" --allow-proposed
done

step "Merge + dedupe inputs (later input wins) / ادغام و حذف تکراری"
# Rows with needs_review stay in the merged file and keep the flag in the payload.
run_step "merge ${#FILES[@]} inputs" scripts/legal/dedupe_staged_rows.py --out "$MERGED" "${FILES[@]}"
run_step "validate merged input" scripts/legal/ingest_pipeline.py validate "$MERGED" --allow-proposed

# ---------------------------------------------------------------- 2. snapshot
step "2. Snapshot $SRC / اسنپ‌شات"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] would POST $QDRANT/collections/$SRC/snapshots"
else
  snap=$(curl -fsS -X POST "$QDRANT/collections/$SRC/snapshots" |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["name"])') ||
    die "snapshot of $SRC failed / ساخت اسنپ‌شات ناموفق"
  echo "snapshot: $snap  (collection $SRC, stored in $QDR:/qdrant/storage/snapshots/$SRC/)"
fi

# ---------------------------------------------------------------- 3. build
step "3. Build $DST / ساخت"
if [ "$V4_EXISTS" = 1 ]; then
  printf 'This DELETES %s (%s points). %s is not touched. Type the collection name to confirm: ' \
    "$DST" "$(count "$DST")" "$SRC" >/dev/tty
  read -r answer </dev/tty
  [ "$answer" = "$DST" ] || die "confirmation mismatch; nothing deleted / تأیید نادرست؛ چیزی حذف نشد"
  curl -fsS -X DELETE "$QDRANT/collections/iran_laws_v4" >/dev/null ||
    die "delete of $DST failed; $SRC is untouched, $DST may be partial / حذف $DST ناموفق؛ $SRC دست‌نخورده، $DST ممکن است ناقص باشد"
  echo "deleted $DST"
fi
echo "--- copy $SRC -> $DST (dry run)"
# build_collection.py prints one JSON object (indent=2) with points_kept / points_dropped
DRY_JSON=$(run scripts/legal/build_collection.py --src "$SRC" --dst "$DST" --drop-law "$LEASE_LAW" --dry-run) ||
  die "copy dry run failed / اجرای آزمایشی کپی ناموفق"
echo "$DRY_JSON"
KEPT=$(printf '%s' "$DRY_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["points_kept"])') ||
  die "could not parse points_kept from the dry-run JSON"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] stopping before any write. Planned next: real copy, then apply of the merged input:"
  printf '  %s\n' "${FILES[@]}"
  echo "[dry-run] done / پایان اجرای آزمایشی"
  exit 0
fi
REBUILD_CMD="bash scripts/legal/build_v4_on_server.sh --rebuild"
run scripts/legal/build_collection.py --src "$SRC" --dst "$DST" --drop-law "$LEASE_LAW" ||
  die "copy failed; $SRC is untouched, $DST may be partial. Re-run: $REBUILD_CMD / کپی ناموفق؛ $SRC دست‌نخورده، $DST ناقص است"
got=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  got=$(count "$DST")
  [ "$got" = "$KEPT" ] && break
  sleep 3
done
echo "$DST points after copy: $got (expected $KEPT = $V3_COUNT minus replaced lease rows)"
[ "$got" = "$KEPT" ] ||
  die "count mismatch after copy ($got != $KEPT): $DST is PARTIAL, $SRC is untouched. Re-run: $REBUILD_CMD / $DST ناقص است؛ با --rebuild دوباره بسازید"

# one apply of the merged (deduped) input; ingest_pipeline upserts by deterministic point id,
# so within an input a later row also replaces an earlier one with the same law+article+label.
run_step "apply merged input (dry run)" scripts/legal/ingest_pipeline.py apply "$MERGED" \
  --collection "$DST" --allow-existing --allow-proposed --dry-run
run_step "apply merged input" scripts/legal/ingest_pipeline.py apply "$MERGED" \
  --collection "$DST" --allow-existing --allow-proposed
echo "$DST final points: $(count "$DST")"

# ---------------------------------------------------------------- 4. eval
step "4. Retrieval-only eval vs $SRC (no LLM, no cost) / ارزیابی بازیابی"
OUT=$(mktemp -d)
for C in "$SRC" "$DST"; do
  for S in "${SETS[@]}"; do
    echo "--- $C / $S"
    # exit code 1 only means some case failed; the table below reports it
    EXTRA_ENV=(-e "LIGHTRAG_QDRANT_COLLECTION=$C")
    run scripts/eval_chat_golden.py --retrieval-only \
      --retrieval-set "data/eval/chat_golden/$S.json" >"$OUT/$C.$S.txt" 2>"$OUT/$C.$S.err" ||
      true
    [ -s "$OUT/$C.$S.txt" ] || die "eval produced no output for $C/$S (see $OUT/$C.$S.err)"
    grep -q "^collection=$C " "$OUT/$C.$S.txt" ||
      die "eval used another collection than $C (embedder guard?) see $OUT/$C.$S.txt"
  done
done

EXTRA_ENV=()
python3 - "$OUT" "$SRC" "$DST" "${SETS[@]}" <<'PY'
import re, sys
out, src, dst, *sets = sys.argv[1:]
def load(c, s):
    res = {}
    for line in open(f"{out}/{c}.{s}.txt", encoding="utf-8"):
        m = re.match(r"(PASS|FAIL|GAP) (\S+)", line)
        if m:
            res[m.group(2)] = m.group(1)
    return res
def recall(c, s):
    txt = open(f"{out}/{c}.{s}.txt", encoding="utf-8").read()
    m = re.search(r"recall@5 \(after relevance filter\): (\d+)/(\d+)", txt)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
print(f"{'golden set':<44}{src:>16}{dst:>16}  regressions")
bad = 0
tot = {src: [0, 0], dst: [0, 0]}
for s in sets:
    a, b = load(src, s), load(dst, s)
    reg = [k for k, v in a.items() if v == "PASS" and b.get(k) != "PASS"]
    bad += len(reg)
    ha, sa = recall(src, s)
    hb, sb = recall(dst, s)
    tot[src][0] += ha; tot[src][1] += sa
    tot[dst][0] += hb; tot[dst][1] += sb
    print(f"{s:<44}{f'{ha}/{sa}':>16}{f'{hb}/{sb}':>16}  {', '.join(reg) or '-'}")
ra = tot[src][0] / tot[src][1] if tot[src][1] else 0.0
rb = tot[dst][0] / tot[dst][1] if tot[dst][1] else 0.0
print(f"\nrecall@5 {src}: {tot[src][0]}/{tot[src][1]} = {ra:.3f}")
print(f"recall@5 {dst}: {tot[dst][0]}/{tot[dst][1]} = {rb:.3f}")
verdict = "V4_BETTER" if rb > ra else ("V4_EQUAL" if rb == ra else "V4_WORSE")
print(f"VERDICT: {verdict}")
print("\nSwitch criterion: v4 loses no case that v3 passes, and new-law cases pass."
      + ("  -> REGRESSIONS FOUND, do not switch." if bad else "  -> no regressions."))
PY
echo "raw eval output: $OUT"

# ---------------------------------------------------------------- 5. switch / rollback
step "5. Switch and rollback (NOT executed) / سوئیچ و بازگشت (اجرا نشد)"
cat <<'TXT'
Switch (owner approval needed; the serving collection is env LIGHTRAG_QDRANT_COLLECTION in /opt/roxira_platform/.env,
read by service enterprise_app / container roxira_app_prod):
  cd /opt/roxira_platform
  cp .env /root/env-backups/.env.before-v4 && chmod 600 /root/env-backups/.env.before-v4
  grep -q '^LIGHTRAG_QDRANT_COLLECTION=' .env \
    && sed -i 's/^LIGHTRAG_QDRANT_COLLECTION=.*/LIGHTRAG_QDRANT_COLLECTION=iran_laws_v4/' .env \
    || echo 'LIGHTRAG_QDRANT_COLLECTION=iran_laws_v4' >> .env
  docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate enterprise_app

Rollback (v3 is untouched):
  cd /opt/roxira_platform
  sed -i 's/^LIGHTRAG_QDRANT_COLLECTION=.*/LIGHTRAG_QDRANT_COLLECTION=iran_laws_v3/' .env
  docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate enterprise_app
TXT
echo
echo "done / پایان. $SRC untouched; serving not switched."
