#!/usr/bin/env bash
# scripts/dev/ui_debt_ratchet.sh
# CI ratchet for frontend UI debt.
# Verifies that raw palette classes and physical-direction classes in each folder
# do not exceed the baseline recorded in output_apps/enterprise_hub/frontend/.ui-debt/<folder>.json.
#
# Usage:
#   bash scripts/dev/ui_debt_ratchet.sh                 # Verify all baselines
#   bash scripts/dev/ui_debt_ratchet.sh --check         # Verify all baselines (explicit)
#   bash scripts/dev/ui_debt_ratchet.sh --update        # Update all baselines to current counts
#   bash scripts/dev/ui_debt_ratchet.sh --update <dir>  # Update baseline for specific folder
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/output_apps/enterprise_hub/frontend"
BASELINE_DIR="$FRONTEND_DIR/.ui-debt"
COUNT_SCRIPT="$SCRIPT_DIR/ui_debt_count.sh"

MODE="check"
TARGET_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --update|-u)
      MODE="update"
      if [ $# -gt 1 ] && [[ "$2" != --* ]]; then
        TARGET_DIR="$2"
        shift
      fi
      shift
      ;;
    --check|-c)
      MODE="check"
      shift
      ;;
    *)
      if [ -z "$TARGET_DIR" ]; then
        TARGET_DIR="$1"
      fi
      shift
      ;;
  esac
done

mkdir -p "$BASELINE_DIR"

python3 - "$REPO_ROOT" "$FRONTEND_DIR" "$BASELINE_DIR" "$COUNT_SCRIPT" "$MODE" "$TARGET_DIR" << 'EOF'
import sys, os, json, subprocess
from pathlib import Path

repo_root = Path(sys.argv[1]).resolve()
frontend_dir = Path(sys.argv[2]).resolve()
baseline_dir = Path(sys.argv[3]).resolve()
count_script = sys.argv[4]
mode = sys.argv[5]
specific_target = sys.argv[6]

src_dir = frontend_dir / "src"

def get_count(target_path):
    cmd = ["bash", count_script, str(target_path), "--json"]
    out = subprocess.check_output(cmd, text=True)
    data = json.loads(out)
    return data["total"], data["palette"], data["direction"]

def get_folder_slug(folder_path):
    # e.g. src/components/chat -> components-chat
    # e.g. src/app/app/accounting -> app-app-accounting
    rel = folder_path.relative_to(src_dir)
    return str(rel).replace("/", "-").replace("\\", "-")

def get_target_folders():
    folders = []
    
    # components/*
    components_dir = src_dir / "components"
    if components_dir.is_dir():
        for d in sorted(components_dir.iterdir()):
            if d.is_dir() and d.name != "ui":
                folders.append(d)
                
    # app/app/* (sub-slices)
    app_app_dir = src_dir / "app" / "app"
    if app_app_dir.is_dir():
        for d in sorted(app_app_dir.iterdir()):
            if d.is_dir():
                folders.append(d)
                
    # app/* (public routes except app/app and app/fonts)
    app_dir = src_dir / "app"
    if app_dir.is_dir():
        for d in sorted(app_dir.iterdir()):
            if d.is_dir() and d.name not in ["app", "fonts", "api"]:
                folders.append(d)
                
    # Other src dirs
    for name in ["lib", "print-templates"]:
        d = src_dir / name
        if d.is_dir():
            folders.append(d)
            
    return folders

all_folders = get_target_folders()

if mode == "update":
    targets_to_update = []
    if specific_target:
        # Match single folder
        st_path = Path(specific_target).resolve()
        for f in all_folders:
            if f == st_path or f.name == specific_target or get_folder_slug(f) == specific_target or specific_target in str(f):
                targets_to_update.append(f)
                break
        if not targets_to_update:
            print(f"Error: Target folder '{specific_target}' not found in known top folders.")
            sys.exit(1)
    else:
        targets_to_update = all_folders

    updated_count = 0
    for f in targets_to_update:
        slug = get_folder_slug(f)
        total, p_cnt, d_cnt = get_count(f)
        baseline_file = baseline_dir / f"{slug}.json"
        rel_folder = str(f.relative_to(frontend_dir))
        payload = {
            "folder": rel_folder,
            "count": total,
            "palette": p_cnt,
            "direction": d_cnt
        }
        baseline_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Updated baseline: {slug}.json => {total} (palette={p_cnt}, direction={d_cnt})")
        updated_count += 1
    print(f"\nSuccessfully wrote {updated_count} baseline file(s) in {baseline_dir}")
    sys.exit(0)

# Check mode:
baseline_files = sorted(baseline_dir.glob("*.json"))
if not baseline_files:
    print(f"Error: No baseline files found in {baseline_dir}. Run with --update to generate.")
    sys.exit(1)

regressions = []
checked = 0
total_current_debt = 0
total_baseline_debt = 0

for b_file in baseline_files:
    try:
        data = json.loads(b_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error reading {b_file.name}: {e}")
        regressions.append((b_file.name, 0, 0, f"Malformed JSON: {e}"))
        continue

    folder_rel = data.get("folder")
    baseline_count = data.get("count", 0)
    target_path = frontend_dir / folder_rel

    if not target_path.exists():
        print(f"WARN: Folder {folder_rel} does not exist on disk, skipping.")
        continue

    current_count, p_cnt, d_cnt = get_count(target_path)
    checked += 1
    total_current_debt += current_count
    total_baseline_debt += baseline_count

    if current_count > baseline_count:
        diff = current_count - baseline_count
        regressions.append((folder_rel, current_count, baseline_count, f"+{diff} debt increase"))
        print(f"FAIL  {folder_rel:<35} current={current_count:<4} baseline={baseline_count:<4} (+{diff} REGRESSION)")
    elif current_count < baseline_count:
        diff = baseline_count - current_count
        print(f"OK    {folder_rel:<35} current={current_count:<4} baseline={baseline_count:<4} (-{diff} IMPROVED)")
    else:
        print(f"OK    {folder_rel:<35} current={current_count:<4} baseline={baseline_count:<4}")

print("\n" + "=" * 65)
print(f"Summary: {checked} folders checked | Total debt: {total_current_debt} (baseline: {total_baseline_debt})")

if regressions:
    print(f"\nFAILED: {len(regressions)} regression(s) detected where UI debt increased:")
    for folder, cur, base, reason in regressions:
        print(f"  • {folder}: {cur} > {base} ({reason})")
    print("Fix the raw palette / physical direction classes or review baseline.")
    sys.exit(1)
else:
    print("\nRESULT: OK (no UI debt regressions)")
    sys.exit(0)
EOF
