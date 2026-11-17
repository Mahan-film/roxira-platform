#!/usr/bin/env bash
# Nightly deterministic legal gate for srv1 (T201). Runs scripts/eval/legal_gate.py in
# retrieval mode (no LLM, 0 USD) INSIDE the app container, so it measures the collection the
# app really serves (LIGHTRAG_QDRANT_COLLECTION of the container; nothing is overridden), and
# sends one Recall@1 / Recall@5 line to Telegram through scripts/ops/notify/notify.py (a silent
# no-op when NOTIFY_* is not configured). Read-only: Qdrant is only queried.
#
# The container does not mount scripts/ or the question set, so the gate files are copied into
# a scratch dir inside the container (/tmp/nightly_legal_gate) and run there with PYTHONPATH=/app.
#
# Usage: nightly_legal_gate.sh [--dry-run]
#   --dry-run   print what would run; run nothing, send nothing
#
# Install (on the server, as root; NOT done by this repo):
#   install -m 644 scripts/ops/nightly_legal_gate/roxira-legal-gate.service /etc/systemd/system/
#   install -m 644 scripts/ops/nightly_legal_gate/roxira-legal-gate.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now roxira-legal-gate.timer
#   bash scripts/ops/nightly_legal_gate.sh --dry-run     # check first
#   systemctl start roxira-legal-gate.service && journalctl -u roxira-legal-gate.service -n 30
#
# Env overrides: DOCKER_BIN, APP_CONTAINER (roxira_app_prod), REPO (/opt/roxira_platform),
# GATE_SET, NOTIFY_BIN, STATE_FILE, WARN_DROP (points of recall@5 that trigger a warning, default 3).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$HERE/../.." && pwd)}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
APP_CONTAINER="${APP_CONTAINER:-roxira_app_prod}"
GATE_SET="${GATE_SET:-data/eval/chat_golden/legal_gate_2026-10-21.json}"
NOTIFY_BIN="${NOTIFY_BIN:-$HERE/notify/notify.py}"
DEPLOY_STATE="${DEPLOY_STATE:-/root/deploy-state}"
STATE_FILE="${STATE_FILE:-$DEPLOY_STATE/legal-gate-last.json}"
WARN_DROP="${WARN_DROP:-3}"
SCRATCH=/tmp/nightly_legal_gate

DRY_RUN=0
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n 2,22p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf '[legal-gate] unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

log() { printf '[legal-gate] %s\n' "$*"; }

for f in scripts/eval/legal_gate.py scripts/eval_chat_golden.py "$GATE_SET"; do
  [ -f "$REPO/$f" ] || { log "missing $REPO/$f"; exit 2; }
done

if [ "$DRY_RUN" = 1 ]; then
  log "dry-run: would copy gate files into $APP_CONTAINER:$SCRATCH and run"
  log "  python3 $SCRATCH/scripts/eval/legal_gate.py retrieval --set $SCRATCH/$GATE_SET --json"
  log "  then send the Recall@1/@5 line with $NOTIFY_BIN and store $STATE_FILE"
  exit 0
fi

OUT="$(mktemp -d "${TMPDIR:-/tmp}/legal-gate.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

"$DOCKER_BIN" exec "$APP_CONTAINER" sh -c "rm -rf $SCRATCH && mkdir -p $SCRATCH/scripts/eval $SCRATCH/$(dirname "$GATE_SET")"
"$DOCKER_BIN" cp "$REPO/scripts/eval/legal_gate.py" "$APP_CONTAINER:$SCRATCH/scripts/eval/legal_gate.py"
"$DOCKER_BIN" cp "$REPO/scripts/eval_chat_golden.py" "$APP_CONTAINER:$SCRATCH/scripts/eval_chat_golden.py"
"$DOCKER_BIN" cp "$REPO/$GATE_SET" "$APP_CONTAINER:$SCRATCH/$GATE_SET"

rc=0
"$DOCKER_BIN" exec -e PYTHONPATH=/app "$APP_CONTAINER" \
  python3 "$SCRATCH/scripts/eval/legal_gate.py" retrieval --set "$SCRATCH/$GATE_SET" --json \
  >"$OUT/gate.txt" 2>"$OUT/gate.err" || rc=$?
"$DOCKER_BIN" exec "$APP_CONTAINER" rm -rf "$SCRATCH" >/dev/null 2>&1 || true

send() { python3 "$NOTIFY_BIN" "$1" || true; }

if ! grep -q '^LEGAL_GATE_JSON ' "$OUT/gate.txt"; then
  log "gate produced no result (exit $rc); last error lines:"
  tail -n 5 "$OUT/gate.err" >&2 || true
  send "Legal gate nightly FAILED (exit $rc): no LEGAL_GATE_JSON. Check the roxira-legal-gate journal."
  exit 1
fi

LINE="$(python3 - "$OUT/gate.txt" "$STATE_FILE" "$WARN_DROP" <<'PY'
import json
import sys
from pathlib import Path

gate_txt, state_file, warn_drop = sys.argv[1], Path(sys.argv[2]), float(sys.argv[3])
rep = None
for raw in open(gate_txt, encoding="utf-8"):
    if raw.startswith("LEGAL_GATE_JSON "):
        rep = json.loads(raw[len("LEGAL_GATE_JSON "):])
kept = rep["summary"]["all"]["kept"]
r1, r5 = kept.get("recall@1"), kept.get("recall@5")
n = rep["summary"]["all"].get("n")
coll = (rep.get("meta") or {}).get("collection") or "?"


def pct(v):
    return "n/a" if v is None else f"{float(v) * 100:.1f}%" if float(v) <= 1 else f"{float(v):.1f}%"


text = f"Legal gate nightly: collection={coll} Recall@1={pct(r1)} Recall@5={pct(r5)} n={n}"
prev = None
try:
    prev = json.loads(state_file.read_text(encoding="utf-8")).get("recall@5")
except Exception:
    pass
if prev is not None and r5 is not None:
    scale = 100 if float(r5) <= 1 else 1
    drop = (float(prev) - float(r5)) * scale
    if drop > warn_drop:
        text += f" WARNING: Recall@5 dropped {drop:.1f} points since the last run"
try:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps({"recall@1": r1, "recall@5": r5, "collection": coll}), encoding="utf-8")
except Exception:
    pass
print(text)
PY
)"

log "$LINE"
send "$LINE"
