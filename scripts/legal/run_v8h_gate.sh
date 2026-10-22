#!/usr/bin/env bash
# Build iran_laws_v8h (dense + BM25 sparse) and run the legal retrieval gate for
# iran_laws_v6 (dense) and iran_laws_v8h (hybrid, SMARTJUDGE_HYBRID_SPARSE=1), printing
# both recall@1/3/5 summaries.
#
# The source collection is only read (scroll with vectors, no re-embedding); v8h is a NEW
# collection. No serving collection or env is switched. The gate is scripts/eval/legal_gate.py
# (the v6/v7b retrieval gate that prints the LEGAL_GATE_JSON marker line).
#
#   bash scripts/legal/run_v8h_gate.sh
#   SRC=iran_laws_v6 DST=iran_laws_v8h QDRANT_URL=http://127.0.0.1:6333 \
#     GATE_SET=data/eval/chat_golden/legal_gate_2026-10-21.json \
#     bash scripts/legal/run_v8h_gate.sh
set -euo pipefail

SRC=${SRC:-iran_laws_v6}
DST=${DST:-iran_laws_v8h}
QDRANT_URL=${QDRANT_URL:-http://127.0.0.1:6333}
GATE_SET=${GATE_SET:-data/eval/chat_golden/legal_gate_2026-10-21.json}
PYTHON=${PYTHON:-python3}
OUT=${OUT:-$(mktemp -d)}

step() { printf '\n=== %s ===\n' "$*"; }

step "0. Preflight / بررسی‌های اولیه"
for f in scripts/legal/build_v8_hybrid.py scripts/eval/legal_gate.py "$GATE_SET"; do
  [ -f "$f" ] || { echo "missing file $f / فایل وجود ندارد" >&2; exit 2; }
done
echo "src=$SRC dst=$DST qdrant=$QDRANT_URL set=$GATE_SET"

step "1. Build $DST from $SRC (dry-run then apply) / ساخت کالکشن ترکیبی"
"$PYTHON" scripts/legal/build_v8_hybrid.py --src "$SRC" --dst "$DST" --qdrant "$QDRANT_URL" --dry-run
"$PYTHON" scripts/legal/build_v8_hybrid.py --src "$SRC" --dst "$DST" --qdrant "$QDRANT_URL" --apply

gate() { # collection, hybrid(0|1), label
  local coll=$1 hybrid=$2 label=$3
  step "2. Gate $label: $coll (hybrid=$hybrid) / گیت بازیابی"
  LIGHTRAG_QDRANT_COLLECTION="$coll" SMARTJUDGE_HYBRID_SPARSE="$hybrid" \
    "$PYTHON" scripts/eval/legal_gate.py retrieval --set "$GATE_SET" --json \
    >"$OUT/gate.$label.txt" 2>"$OUT/gate.$label.err" || true
  if ! grep -q '^LEGAL_GATE_JSON ' "$OUT/gate.$label.txt"; then
    echo "gate produced no LEGAL_GATE_JSON for $label; see $OUT/gate.$label.err" >&2
    cat "$OUT/gate.$label.err" >&2
    return 1
  fi
  echo "report: $OUT/gate.$label.txt"
}

gate "$SRC" 0 dense
gate "$DST" 1 hybrid

step "3. Summaries (alias-aware recall@1/3/5) / خلاصه"
"$PYTHON" - "$OUT" "$SRC" "$DST" <<'PY'
import json
import sys

out, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
MARK = "LEGAL_GATE_JSON "


def load(label):
    for line in open(f"{out}/gate.{label}.txt", encoding="utf-8"):
        if line.startswith(MARK):
            return json.loads(line[len(MARK):])
    raise SystemExit(f"no LEGAL_GATE_JSON for {label}")


def fmt(rep):
    summary = rep["summary"]["all"]["kept"]
    return "  ".join(f"recall@{k}={summary.get(f'recall@{k}')}" for k in (1, 3, 5))


dense = load("dense")
hybrid = load("hybrid")
print(f"{src:>18} (dense) : {fmt(dense)}")
print(f"{dst:>18} (hybrid): {fmt(hybrid)}")
print(
    f"meta: dense collection={dense.get('meta', {}).get('collection')} "
    f"hybrid collection={hybrid.get('meta', {}).get('collection')}"
)
PY
echo
echo "done. Nothing switched; $SRC untouched. Raw output: $OUT"
