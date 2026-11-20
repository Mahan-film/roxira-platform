#!/usr/bin/env bash
# OSV-Scanner over the dependency lockfiles this repo tracks (package-lock.json, requirements*.txt).
# Usage: scripts/ci/osv_scan.sh <osv-scanner binary> [json-output-file]
# Prints a per-file table; exits with the scanner's code (0 clean, 1 vulnerabilities found,
# 127/128 usage or no files). CI runs it in report mode (see .github/workflows/ci.yml, job osv-scanner).
set -uo pipefail

OSV="${1:?usage: osv_scan.sh <osv-scanner> [json-out]}"
OUT="${2:-}"
cd "$(git rev-parse --show-toplevel)"

args=()
while IFS= read -r f; do
  args+=("-L" "$f")
done < <(git ls-files | grep -E '(^|/)(package-lock\.json|requirements[^/]*\.txt)$')

if [ "${#args[@]}" -eq 0 ]; then
  echo "no lockfiles tracked"
  exit 0
fi
printf 'lockfiles: %s\n' "$(( ${#args[@]} / 2 ))"
if [ -n "$OUT" ]; then
  "$OSV" scan source "${args[@]}" --format json --output-file "$OUT"
else
  "$OSV" scan source "${args[@]}" --format table
fi
