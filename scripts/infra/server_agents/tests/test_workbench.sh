#!/usr/bin/env bash
# Group-selection tests for workbench.sh in --dry-run mode. No docker, no network, no repo state needed.
#   bash scripts/infra/server_agents/tests/test_workbench.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WB="$HERE/../workbench.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/wbtest.XXXXXX")"
trap 'rm -rf "$T"' EXIT
FAIL=0

mk() { mkdir -p "$T/wt/$(dirname "$1")"; : >"$T/wt/$1"; }
for f in output_apps/enterprise_hub/frontend/src/a.tsx output_apps/enterprise_hub/frontend/src/c.tsx output_apps/enterprise_hub/src/b.ts \
  output_apps/enterprise_hub/mcp/mcp.module.ts output_apps/enterprise_hub/docs/a.md \
  output_apps/generated_modules/smartjudge/mod.py output_apps/generated_modules/smartjudge/tests/test_mod.py \
  output_apps/generated_modules/smartjudge/tests/test_other.py scripts/x/tool.py scripts/x/tests/test_tool.py \
  src/test_danger.py src/lib.py scripts/run.sh docs/a.md; do mk "$f"; done

run() { printf '%s\n' "$@" >"$T/files"; "$WB" "$T/wt" --dry-run --files-from "$T/files" 2>&1; }
expect() { # label, output, pattern (grep -E)
  if ! printf '%s\n' "$2" | grep -Eq -- "$3"; then echo "FAIL [$1]: missing /$3/"; printf '%s\n' "$2"; FAIL=1; fi
}
reject() {
  if printf '%s\n' "$2" | grep -Eq -- "$3"; then echo "FAIL [$1]: unexpected /$3/"; printf '%s\n' "$2"; FAIL=1; fi
}

o="$(run output_apps/enterprise_hub/frontend/src/a.tsx)"
expect fe-tsc "$o" 'GROUP frontend:tsc .*node:20-bookworm-slim.*npx --no-install tsc --noEmit -p \.'
expect fe-eslint "$o" 'GROUP frontend:eslint .*eslint src/a\.tsx'
expect fe-docker "$o" 'GROUP docker:frontend .*image=docker.*--target builder.*frontend/Dockerfile'
reject fe-no-hub "$o" 'GROUP hub:'
reject fe-no-py "$o" 'GROUP py:'
reject fe-no-docker-backend "$o" 'GROUP docker:backend'
reject fe-no-copy-coverage "$o" 'GROUP dockerfile:copy-coverage'

o="$(run output_apps/enterprise_hub/frontend/src/a.tsx output_apps/enterprise_hub/frontend/src/c.tsx)"
expect fe-eslint-multi "$o" 'GROUP frontend:eslint .*node:20-bookworm-slim.*eslint src/a\.tsx src/c\.tsx'

o="$(run output_apps/enterprise_hub/src/b.ts)"
expect hub-tsc "$o" 'GROUP hub:tsc'
expect hub-jest "$o" 'GROUP hub:jest .*--findRelatedTests src/b\.ts --passWithNoTests'
expect hub-docker "$o" 'GROUP docker:backend .*image=docker.*--target builder.*output_apps/enterprise_hub/Dockerfile.*output_apps/enterprise_hub'
expect hub-copy-coverage "$o" 'GROUP dockerfile:copy-coverage .*dockerfile_copy_coverage\.py'
expect hub-docker-app "$o" 'GROUP docker:app .*image=docker.*--target builder.*Dockerfile\.prod'
reject hub-no-fe "$o" 'GROUP frontend:'
reject hub-no-docker-fe "$o" 'GROUP docker:frontend'

o="$(run output_apps/enterprise_hub/docs/a.md)"   # hub docs do not affect the backend/frontend image
reject hubdocs-no-docker "$o" 'GROUP docker:(backend|frontend)'
reject hubdocs-no-copy "$o" 'GROUP dockerfile:copy-coverage'

o="$(run Dockerfile.prod)"   # the Python app image's own Dockerfile
expect prod-docker-app "$o" 'GROUP docker:app .*--target builder.*Dockerfile\.prod'
reject prod-no-backend "$o" 'GROUP docker:backend'

o="$(run output_apps/generated_modules/smartjudge/mod.py)"
expect py-block "$o" 'GROUP py:ruff-blocking .*F821,F822,F823,E9'
expect py-report "$o" 'GROUP py:ruff-report'
expect py-neighbour-test "$o" 'GROUP py:pytest .*smartjudge/tests/test_mod\.py'
reject py-not-other-tests "$o" 'test_other\.py'

o="$(run scripts/x/tests/test_tool.py)"
expect py-changed-test "$o" 'GROUP py:pytest .*scripts/x/tests/test_tool\.py'

o="$(run src/test_danger.py src/lib.py)"
expect src-ruff "$o" 'GROUP py:ruff-blocking'
reject src-no-pytest "$o" 'GROUP py:pytest'
expect src-ignored "$o" 'IGNORED src/test_danger\.py'

o="$(run scripts/run.sh)"
expect sh "$o" 'GROUP sh:bash-n .*host.*bash -n scripts/run\.sh'
reject sh-only "$o" 'GROUP (py|hub|frontend)'

o="$(run docs/a.md)"
expect none "$o" 'NO GROUPS'

o="$(run scripts/gone.sh output_apps/enterprise_hub/src/deleted.ts)"   # deleted files: no lint targets, hub still checked
expect del-hub "$o" 'GROUP hub:tsc'
reject del-no-sh "$o" 'GROUP sh:'

# eslint_diff helper: only NEW errors fail (base comparison)
printf '%s\n' '[{"filePath":"/work/src/a.tsx","messages":[{"ruleId":"react-hooks/rules-of-hooks","severity":2}]}]' >"$T/base.json"
printf '%s\n' '[{"filePath":"/work/src/a.tsx","messages":[{"ruleId":"react-hooks/rules-of-hooks","severity":2}]}]' >"$T/cur.json"
set +e; out="$(python3 "$HERE/../eslint_diff.py" "$T/cur.json" "$T/base.json")"; rc=$?; set -e
[ "$rc" = 0 ] || { echo "FAIL [eslint-diff-preexisting]: exit $rc"; FAIL=1; }
[ "$out" = "no new errors (1 pre-existing)" ] || { echo "FAIL [eslint-diff-preexisting]: $out"; FAIL=1; }

printf '%s\n' '[]' >"$T/base.json"
set +e; out="$(python3 "$HERE/../eslint_diff.py" "$T/cur.json" "$T/base.json")"; rc=$?; set -e
[ "$rc" = 1 ] || { echo "FAIL [eslint-diff-new]: exit $rc"; FAIL=1; }
expect eslint-diff-new "$out" 'new errors: src/a\.tsx:react-hooks/rules-of-hooks x 1'

# JSON output in dry-run
printf 'scripts/run.sh\n' >"$T/files"
WORKBENCH_BACKEND=local "$WB" "$T/wt" --dry-run --files-from "$T/files" --json "$T/out.json" >/dev/null 2>&1
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["ok"] is True and d["groups"][0]["name"] == "sh:bash-n" and d["groups"][0]["status"] == "skip", d
assert d["backend"] == "local", d
' "$T/out.json" || { echo "FAIL [json]"; FAIL=1; }

# --emit-groups: machine-readable group list for the daytona backend (no docker)
printf 'scripts/run.sh\n' >"$T/files"
"$WB" "$T/wt" --files-from "$T/files" --emit-groups "$T/groups.json" >/dev/null 2>&1
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
g = [x for x in d["groups"] if x["name"] == "sh:bash-n"]
assert g and g[0]["kind"] == "host" and g[0]["cmd"].startswith("bash -n"), d
' "$T/groups.json" || { echo "FAIL [emit-groups]"; FAIL=1; }

printf 'output_apps/enterprise_hub/frontend/src/a.tsx\n' >"$T/files"
"$WB" "$T/wt" --files-from "$T/files" --emit-groups "$T/groups-lint.json" >/dev/null 2>&1
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
g = [x for x in d["groups"] if x["kind"] == "lint"]
assert g and g[0]["eslint_prefix"] == "npx --no-install eslint" and g[0]["files"] == ["src/a.tsx"], d
' "$T/groups-lint.json" || { echo "FAIL [emit-groups-lint]"; FAIL=1; }

printf 'output_apps/enterprise_hub/src/b.ts\n' >"$T/files"
"$WB" "$T/wt" --files-from "$T/files" --emit-groups "$T/groups-docker.json" >/dev/null 2>&1
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
g = [x for x in d["groups"] if x["name"] == "docker:backend"]
assert g and g[0]["kind"] == "docker" and "--target builder" in g[0]["cmd"], d
cov = [x for x in d["groups"] if x["name"] == "dockerfile:copy-coverage"]
assert cov and cov[0]["kind"] == "host", d
' "$T/groups-docker.json" || { echo "FAIL [emit-groups-docker]"; FAIL=1; }

# daytona backend: a runner that refuses to start -> local fallback, recorded in the JSON
printf '%s\n' 'import sys' 'sys.exit(3)' >"$T/fake_daytona.py"
printf 'scripts/run.sh\n' >"$T/files"
WORKBENCH_BACKEND=daytona WORKBENCH_DAYTONA_RUNNER="$T/fake_daytona.py" \
  "$WB" "$T/wt" --files-from "$T/files" --json "$T/fallback.json" >/dev/null 2>&1
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["backend"] == "local-fallback", d
assert d["groups"] and d["groups"][0]["name"] == "sh:bash-n", d
' "$T/fallback.json" || { echo "FAIL [backend-fallback]"; FAIL=1; }

# wrong arguments exit 2
set +e; "$WB" >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 2 ] || { echo "FAIL [args]: exit $rc"; FAIL=1; }

if [ "$FAIL" = 0 ]; then echo "test_workbench: all passed"; else exit 1; fi
