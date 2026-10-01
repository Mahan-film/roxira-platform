#!/usr/bin/env bash
# Safe Docker housekeeping: inspect by default, prune only with two explicit flags.

set -euo pipefail

mode="dry-run"
confirmed="false"

usage() {
  cat <<'EOF'
Usage: housekeeping.sh [--dry-run | --apply --yes]

Without --apply this script only reports the two Docker cache commands it would run.
--apply requires --yes and runs only the reported cache-prune commands.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --dry-run)
      mode="dry-run"
      ;;
    --apply)
      mode="apply"
      ;;
    --yes)
      confirmed="true"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$mode" == "apply" && "$confirmed" != "true" ]]; then
  printf '%s\n' 'Refusing to apply changes without --yes.' >&2
  exit 2
fi

if [[ "$mode" == "dry-run" ]]; then
  printf '%s\n' 'Safe housekeeping report (no changes will be made):'
  df -h /
  printf '%s\n' 'Would run: docker system df'
  printf '%s\n' 'Would run: docker builder prune -f'
  printf '%s\n' 'Would run: docker image prune -f'
  exit 0
fi

printf '%s\n' 'Applying approved build-cache housekeeping:'
docker builder prune -f
docker image prune -f
