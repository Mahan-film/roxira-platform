#!/usr/bin/env bash
# Workbench (factory milestone F1): isolated automatic checks for ONE agent worktree.
#
#   workbench.sh <worktree> [--base origin/main] [--json OUT] [--dry-run] [--files-from FILE] [--emit-groups OUT] [--app-e2e]
#
#   --base REF        diff base (default origin/main); changed = `git diff --name-only REF...HEAD` + uncommitted/untracked
#   --json OUT        write {groups:[{name,cmd,status,seconds,tail}],ok,backend} to OUT (status pass|fail|skip|timeout)
#   --dry-run         print the groups and commands that WOULD run, start no docker/process (used by tests)
#   --files-from FILE use this newline-separated changed-file list instead of git (tests)
#   --emit-groups OUT write the selected groups as machine-readable JSON ({groups:[{name,kind,dir,cmd,
#                     eslint_prefix,files,base_files}],error}) and exit; used by the daytona backend so the check
#                     commands live in this file only. No docker/process is started.
# Exit: 0 always, except wrong arguments (2). Callers read "ok" from the JSON / the summary.
#
# Backend: WORKBENCH_BACKEND=local|daytona (default local). With daytona the groups are handed to
#   daytona_runner.py (override the path with WORKBENCH_DAYTONA_RUNNER), which runs them in a disposable
#   Daytona sandbox instead of docker on this host. When the sandbox cannot start (runner exits 3) the
#   checks run locally and the JSON records "backend":"local-fallback".
#
# Groups are chosen only for what changed:
#   output_apps/enterprise_hub/frontend/**   tsc --noEmit, eslint <changed ts/tsx/js files> (fails only on NEW errors)
#   output_apps/enterprise_hub/** (not fe)   tsc --noEmit, jest --findRelatedTests <changed files>
#   *.py                                     ruff (F821,F822,F823,E9 blocking; rest reported), pytest ONLY on changed
#                                            test files / test_<module>.py next to changed modules, inside
#                                            scripts/**/tests or smartjudge/tests. NEVER src/ or the repo root.
#   *.sh                                     bash -n
# Gate 2 (docker build of every changed image; docs/strategy/FACTORY_V2_2026-10-22.md §3):
#   output_apps/enterprise_hub/** no docs/fe  docker:backend   — docker build --target builder of the backend image
#   output_apps/enterprise_hub/frontend/**    docker:frontend  — docker build --target builder of the frontend image
#   Dockerfile.prod + its COPY sources        docker:app       — docker build --target builder (installs requirements)
#   output_apps/enterprise_hub (backend)      dockerfile:copy-coverage — static: every dir app.module.ts imports is COPYed
# Docker builds get network access and a 15-minute timeout (WB_DOCKER_TIMEOUT); the temp tag is removed afterwards.
# Node groups: node:20-bookworm-slim; python: python:3.12-slim. Worktree mounted read-only at /w. Lint groups mount the
# base versions read-only at /base and fail only on errors that are NOT already present on the base branch.
# Checks run with --network none, --memory 2g, --pids-limit 512, --cap-drop ALL, no-new-privileges, uid 1000, read-only rootfs.
# Dependencies live in named volumes keyed by lockfile hash (rx-nm-<dir>-<hash12>, rx-py-<hash12>), populated once
# by a separate container that is the only one with network (npm ci --ignore-scripts / pip install).
# Timeouts: 8 min per group, 15 min per docker build, 15 min overall (raised when docker builds are selected).
# Gate 3 (opt-in; browser E2E in an isolated sandbox built from the committed HEAD, docs/strategy/FACTORY_V2_2026-10-22.md):
#   --app-e2e or WB_APP_E2E=1, AND a changed file under enterprise_hub/frontend/src/app/app, frontend/src/components/app,
#   modules/data_import, modules/accounting, modules/invoicing or modules/hr (or the E2E tooling itself)  ->  e2e:app
#   runs scripts/infra/e2e/run_app_e2e.sh HEAD: builds backend + frontend images, throwaway postgres/redis, Chromium and
#   WebKit through Playwright. Uncommitted changes are NOT included, so commit first. Needs docker, node and network.
#   Prints `APP_E2E RESULT: PASS|FAIL`; timeout WB_E2E_TIMEOUT (default 2400 s). Off by default because it is slow.
# Env overrides: WB_NODE_IMAGE, WB_PY_IMAGE, WB_GROUP_TIMEOUT, WB_DOCKER_TIMEOUT, WB_E2E_TIMEOUT, WB_TOTAL_TIMEOUT, WB_APP_E2E.
set -euo pipefail

NODE_IMAGE="${WB_NODE_IMAGE:-node:20-bookworm-slim}"
PY_IMAGE="${WB_PY_IMAGE:-python:3.12-slim}"
GROUP_TIMEOUT="${WB_GROUP_TIMEOUT:-480}"
DOCKER_TIMEOUT="${WB_DOCKER_TIMEOUT:-900}"
E2E_TIMEOUT="${WB_E2E_TIMEOUT:-2400}"
APP_E2E="${WB_APP_E2E:-0}"
TOTAL_TIMEOUT="${WB_TOTAL_TIMEOUT:-900}"
HUB_DIR="output_apps/enterprise_hub"
FE_DIR="output_apps/enterprise_hub/frontend"
PYTEST_DIRS_RE='^(scripts/.*/tests/|output_apps/generated_modules/smartjudge/tests/)'
TEST_FILE_RE='(^|/)test_[^/]*\.py$|_test\.py$'
WB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESLINT_DIFF="$WB_DIR/eslint_diff.py"
BACKEND="${WORKBENCH_BACKEND:-local}"
DAYTONA_RUNNER="${WORKBENCH_DAYTONA_RUNNER:-$WB_DIR/daytona_runner.py}"

log() { printf '[workbench] %s\n' "$*" >&2; }
die() { printf '[workbench] ERROR: %s\n' "$*" >&2; exit 2; }

WT="" BASE="origin/main" JSON_OUT="" DRY=0 FILES_FROM="" EMIT_GROUPS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2?--base needs a ref}"; shift ;;
    --json) JSON_OUT="${2?--json needs a path}"; shift ;;
    --dry-run) DRY=1 ;;
    --files-from) FILES_FROM="${2?--files-from needs a path}"; shift ;;
    --emit-groups) EMIT_GROUPS="${2?--emit-groups needs a path}"; shift ;;
    --app-e2e) APP_E2E=1 ;;
    -h | --help) sed -n '2,45p' "$0"; exit 0 ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) [ -z "$WT" ] || die "only one worktree argument"; WT="$1" ;;
  esac
  shift
done
case "$BACKEND" in local | daytona) ;; *) die "WORKBENCH_BACKEND must be local or daytona (got '$BACKEND')" ;; esac
[ -n "$WT" ] || die "usage: workbench.sh <worktree> [--base REF] [--json OUT] [--dry-run]"
[ -d "$WT" ] || die "not a directory: $WT"
WT="$(cd "$WT" && pwd)"
# Repo-relative path of this script's dir, so generated commands work both from $WT (local) and the
# daytona sandbox (same repo layout); falls back to the absolute path when the workbench lives elsewhere.
WB_REL="${WB_DIR#"$WT"/}"; [ "$WB_REL" != "$WB_DIR" ] || WB_REL="$WB_DIR"
[ -z "$FILES_FROM" ] || [ -r "$FILES_FROM" ] || die "cannot read $FILES_FROM"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/workbench.XXXXXX")"
CONTAINERS=() IMAGES=()
cleanup() {
  local c i
  for c in ${CONTAINERS[@]+"${CONTAINERS[@]}"}; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  for i in ${IMAGES[@]+"${IMAGES[@]}"}; do docker image rm -f "$i" >/dev/null 2>&1 || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT

# ---- changed files ----------------------------------------------------------------------------------------
CHANGED=() GIT_ERR=""
if [ -n "$FILES_FROM" ]; then
  while IFS= read -r f; do [ -z "$f" ] || CHANGED+=("$f"); done <"$FILES_FROM"
else
  if { git -c safe.directory="*" -C "$WT" diff --name-only "$BASE...HEAD"; git -c safe.directory="*" -C "$WT" diff --name-only HEAD; \
       git -c safe.directory="*" -C "$WT" ls-files --others --exclude-standard; } 2>"$TMP/giterr" | LC_ALL=C sort -u >"$TMP/changed"; then
    while IFS= read -r f; do [ -z "$f" ] || CHANGED+=("$f"); done <"$TMP/changed"
  else
    GIT_ERR="$(tail -n 5 "$TMP/giterr")"; GIT_ERR="${GIT_ERR:-git failed}"
  fi
fi

# ---- group selection ----------------------------------------------------------------------------------------
# Parallel arrays: one entry per check. KIND = node | py | lint | host | docker ; DIR = package dir / build context.
# Lint groups additionally carry G_LCMD (the eslint prefix) and G_LFILES (newline-joined relative files).
# Docker groups carry G_TAG (the temporary image tag removed after the build).
G_NAME=() G_KIND=() G_DIR=() G_CMD=() G_LCMD=() G_LFILES=() G_TAG=()
DOCKER_N=0
E2E_N=0
add_group() { G_NAME+=("$1"); G_KIND+=("$2"); G_DIR+=("$3"); G_CMD+=("$4"); G_LCMD+=(""); G_LFILES+=(""); G_TAG+=(""); }
add_docker_group() { # name dir tag cmd ; the tag must appear in cmd so `docker image rm` can clean it up
  G_NAME+=("$1"); G_KIND+=("docker"); G_DIR+=("$2"); G_CMD+=("$4")
  G_LCMD+=(""); G_LFILES+=(""); G_TAG+=("$3")
  DOCKER_N=$((DOCKER_N + 1))
}
add_lint_group() { # name dir prefix files...
  local name="$1" dir="$2" prefix="$3"; shift 3
  G_NAME+=("$name"); G_KIND+=("lint"); G_DIR+=("$dir"); G_CMD+=("$prefix $(quote_list "$@")")
  G_LCMD+=("$prefix"); G_LFILES+=("$(printf '%s\n' "$@")"); G_TAG+=("")
}
quote_list() { local o="" x; for x in "$@"; do o+=" $(printf '%q' "$x")"; done; printf '%s' "${o# }"; }
exists() { [ -f "$WT/$1" ]; }

FE_ALL=0 HUB_ALL=0 HUB_DOCKER=0 APP_DOCKER=0 APP_E2E_RELEVANT=0
FE_LINT=() HUB_REL=() PY_FILES=() PY_TESTS=() SH_FILES=() IGNORED=()
for f in ${CHANGED[@]+"${CHANGED[@]}"}; do
  case "$f" in
    "$FE_DIR"/*)
      FE_ALL=1
      case "$f" in *.ts | *.tsx | *.js | *.jsx | *.mjs) exists "$f" && FE_LINT+=("${f#"$FE_DIR"/}") ;; esac ;;
    "$HUB_DIR"/*)
      HUB_ALL=1
      case "$f" in "$HUB_DIR"/docs/*) ;; *) HUB_DOCKER=1 ;; esac
      case "$f" in *.ts | *.tsx | *.js) exists "$f" && HUB_REL+=("${f#"$HUB_DIR"/}") ;; esac ;;
  esac
  # Gate 3 relevance: UI routes/components of the business app and the modules the app E2E exercises.
  case "$f" in
    "$FE_DIR"/src/app/app/* | "$FE_DIR"/src/components/app/* | "$HUB_DIR"/modules/data_import/* | \
      "$HUB_DIR"/modules/accounting/* | "$HUB_DIR"/modules/invoicing/* | "$HUB_DIR"/modules/hr/* | \
      scripts/infra/e2e/* | e2e/app/* | e2e/playwright.app.config.ts)
      APP_E2E_RELEVANT=1 ;;
  esac
  # Dockerfile.prod COPY sources (image inputs): output_apps/, src/, run_unified_server.py and these config files.
  case "$f" in
    Dockerfile.prod | output_apps/* | src/* | run_unified_server.py | config/models.yaml | config/jurisdiction_rules.yaml)
      APP_DOCKER=1 ;;
  esac
  case "$f" in
    *.py)
      exists "$f" || continue
      PY_FILES+=("$f")
      if printf '%s' "$f" | grep -Eq "$TEST_FILE_RE"; then
        if printf '%s' "$f" | grep -Eq "$PYTEST_DIRS_RE"; then PY_TESTS+=("$f")
        else IGNORED+=("$f (test outside allowed tests/ dirs: not run)"); fi
      else
        d="$(dirname "$f")"; stem="$(basename "$f" .py)"; cand="$d/tests/test_$stem.py"
        if exists "$cand" && printf '%s' "$cand" | grep -Eq "$PYTEST_DIRS_RE"; then PY_TESTS+=("$cand"); fi
      fi ;;
    *.sh) exists "$f" && SH_FILES+=("$f") ;;
  esac
done

if [ "$FE_ALL" = 1 ]; then
  add_group "frontend:tsc" node "$FE_DIR" "npx --no-install tsc --noEmit -p ."
  if [ ${#FE_LINT[@]} -gt 0 ]; then
    add_lint_group "frontend:eslint" "$FE_DIR" "npx --no-install eslint" "${FE_LINT[@]}"
  fi
fi
if [ "$HUB_ALL" = 1 ]; then
  add_group "hub:tsc" node "$HUB_DIR" "npx --no-install tsc --noEmit -p ."
  add_group "hub:jest" node "$HUB_DIR" \
    "npx --no-install jest --findRelatedTests$( [ ${#HUB_REL[@]} -gt 0 ] && printf ' %s' "$(quote_list "${HUB_REL[@]}")" ) --passWithNoTests"
fi
if [ ${#PY_FILES[@]} -gt 0 ]; then
  PYL="$(quote_list "${PY_FILES[@]}")"
  add_group "py:ruff-blocking" py "" "ruff check --isolated --no-cache --select F821,F822,F823,E9 $PYL"
  add_group "py:ruff-report" py "" "ruff check --no-cache --exit-zero $PYL"
fi
if [ ${#PY_TESTS[@]} -gt 0 ]; then
  UT=() ; while IFS= read -r t; do UT+=("$t"); done < <(printf '%s\n' "${PY_TESTS[@]}" | LC_ALL=C sort -u)
  add_group "py:pytest" py "" "python -m pytest -q -p no:cacheprovider --timeout 120 $(quote_list "${UT[@]}")"
fi
if [ ${#SH_FILES[@]} -gt 0 ]; then
  add_group "sh:bash-n" host "" "bash -n $(quote_list "${SH_FILES[@]}")"
fi

# Gate 2: docker build every changed image (docs/strategy/FACTORY_V2_2026-10-22.md §3). Backend/frontend build in
# their `builder` stage (the one running `npm run build`); Dockerfile.prod's `builder` stage installs the Python
# requirements, so the heavy runtime stage is never reached.
if [ "$HUB_DOCKER" = 1 ]; then
  add_docker_group "docker:backend" "$HUB_DIR" "rx-wb-be-$$" \
    "docker build --target builder -f $HUB_DIR/Dockerfile -t rx-wb-be-$$ $HUB_DIR"
  add_group "dockerfile:copy-coverage" host "$HUB_DIR" "python3 $WB_REL/dockerfile_copy_coverage.py $HUB_DIR"
fi
if [ "$FE_ALL" = 1 ]; then
  add_docker_group "docker:frontend" "$FE_DIR" "rx-wb-fe-$$" \
    "docker build --target builder -f $FE_DIR/Dockerfile -t rx-wb-fe-$$ $FE_DIR"
fi
if [ "$APP_DOCKER" = 1 ]; then
  add_docker_group "docker:app" "." "rx-wb-app-$$" \
    "docker build --target builder -f Dockerfile.prod -t rx-wb-app-$$ ."
fi

# Gate 3 (opt-in): browser E2E against a sandbox built from HEAD. The script prints `APP_E2E RESULT: PASS|FAIL`.
if [ "$APP_E2E" = 1 ] && [ "$APP_E2E_RELEVANT" = 1 ]; then
  add_group "e2e:app" e2e "." "RX_E2E_REPO=\"\$PWD\" bash ${WB_REL%/server_agents}/e2e/run_app_e2e.sh HEAD"
  E2E_N=$((E2E_N + 1))
fi

# Docker builds get DOCKER_TIMEOUT each; widen the overall budget so one build cannot starve the others, unless
# the caller pinned WB_TOTAL_TIMEOUT.
if [ "$DOCKER_N" -gt 0 ] && [ -z "${WB_TOTAL_TIMEOUT:-}" ]; then
  TOTAL_TIMEOUT=$(( DOCKER_N * DOCKER_TIMEOUT + E2E_N * E2E_TIMEOUT + GROUP_TIMEOUT ))
fi

# ---- group list as JSON (--emit-groups; the daytona backend reuses it) --------------------------------------
# Write the base-branch version of each relative file into a temp dir that mirrors the package layout. Used by
# the lint comparison (mounted read-only at /base locally) and embedded as base_files for the daytona backend.
# Files absent on the base (new files) are simply not written.
build_base() { # $1=outdir $2=package dir $3..=relative files
  local out="$1" dir="$2"; shift 2
  local f
  mkdir -p "$out"
  for f in "$@"; do
    if git -c safe.directory='*' -C "$WT" show "$BASE:$dir/$f" >"$TMP/basefile" 2>/dev/null; then
      mkdir -p "$out/$(dirname "$f")"
      cp "$TMP/basefile" "$out/$f"
    fi
  done
}

emit_groups_json() { # $1=outfile ; machine-readable group list for the daytona runner
  local out="$1" i tmp="$TMP/groups.tsv" base_dir files_us
  : >"$tmp"
  for ((i = 0; i < ${#G_NAME[@]}; i++)); do
    base_dir=""
    if [ "${G_KIND[$i]}" = lint ]; then
      base_dir="$TMP/emitbase.$i"
      local lf=()
      mapfile -t lf < <(printf '%s\n' "${G_LFILES[$i]}")
      build_base "$base_dir" "${G_DIR[$i]}" ${lf[@]+"${lf[@]}"}
    fi
    files_us="$(printf '%s' "${G_LFILES[$i]}" | tr '\n' '\037')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${G_NAME[$i]}" "${G_KIND[$i]}" "${G_DIR[$i]}" \
      "${G_CMD[$i]}" "${G_LCMD[$i]}" "$files_us" "$base_dir" >>"$tmp"
  done
  WB_TSV="$tmp" WB_OUT="$out" WB_GITERR="${GIT_ERR:-}" python3 -c '
import json, os, pathlib
sep = "\x1f"
groups = []
for line in open(os.environ["WB_TSV"], encoding="utf-8"):
    line = line.rstrip("\n")
    if not line:
        continue
    name, kind, d, cmd, lcmd, files, base = (line.split("\t") + [""] * 7)[:7]
    g = {"name": name, "kind": kind, "dir": d, "cmd": cmd, "eslint_prefix": lcmd,
         "files": [f for f in files.split(sep) if f]}
    if kind == "lint" and base:
        g["base_files"] = {f: (pathlib.Path(base) / f).read_text(errors="replace")
                           for f in g["files"] if (pathlib.Path(base) / f).is_file()}
    groups.append(g)
json.dump({"groups": groups, "error": os.environ.get("WB_GITERR") or None},
          open(os.environ["WB_OUT"], "w"))
'
}

if [ -n "$EMIT_GROUPS" ]; then
  emit_groups_json "$EMIT_GROUPS"
  exit 0
fi

# ---- reporting ----------------------------------------------------------------------------------------------
R_FILE="$TMP/results.jsonl"; : >"$R_FILE"
record() { # name cmd status seconds tailfile
  WB_N="$1" WB_C="$2" WB_S="$3" WB_T="$4" WB_F="$5" python3 -c '
import json, os
e = os.environ
tail = ""
if e["WB_F"] and os.path.isfile(e["WB_F"]):
    tail = "\n".join(open(e["WB_F"], errors="replace").read().splitlines()[-60:])
print(json.dumps({"name": e["WB_N"], "cmd": e["WB_C"], "status": e["WB_S"], "seconds": int(e["WB_T"]), "tail": tail}))
' >>"$R_FILE"
}
finish() {
  local ok="$1"
  if [ -n "$JSON_OUT" ]; then
    WB_R="$R_FILE" WB_OK="$ok" WB_BACKEND="${BACKEND:-local}" python3 -c '
import json, os
g = [json.loads(l) for l in open(os.environ["WB_R"]) if l.strip()]
print(json.dumps({"groups": g, "ok": os.environ["WB_OK"] == "1",
                  "backend": os.environ.get("WB_BACKEND", "local")}, indent=1))
' >"$JSON_OUT"
  fi
  WB_R="$R_FILE" WB_OK="$ok" python3 -c '
import json, os
g = [json.loads(l) for l in open(os.environ["WB_R"]) if l.strip()]
print("=== workbench: %s ===" % ("OK" if os.environ["WB_OK"] == "1" else "FAILED"))
for x in g:
    print("%-8s %-18s %4ss  %s" % (x["status"].upper(), x["name"], x["seconds"], x["cmd"][:100]))
if not g:
    print("(no check groups apply to the changed files)")
'
}

if [ -n "$GIT_ERR" ]; then
  printf '%s\n' "$GIT_ERR" >"$TMP/giterr.out"
  record "git:changed-files" "git diff --name-only $BASE...HEAD" fail 0 "$TMP/giterr.out"
  finish 0; exit 0
fi

if [ "$DRY" = 1 ]; then
  echo "changed: ${#CHANGED[@]} file(s)"
  for ((i = 0; i < ${#G_NAME[@]}; i++)); do
    case "${G_KIND[$i]}" in
      node | lint) img="$NODE_IMAGE" ;; py) img="$PY_IMAGE" ;; docker) img="docker" ;; e2e) img="host-e2e" ;; *) img="host" ;;
    esac
    printf 'GROUP %s | image=%s | dir=%s | cmd=%s\n' "${G_NAME[$i]}" "$img" "${G_DIR[$i]:-.}" "${G_CMD[$i]}"
    record "${G_NAME[$i]}" "${G_CMD[$i]}" skip 0 ""
  done
  for x in ${IGNORED[@]+"${IGNORED[@]}"}; do printf 'IGNORED %s\n' "$x"; done
  [ ${#G_NAME[@]} -gt 0 ] || echo "NO GROUPS"
  finish 1; exit 0
fi

# ---- daytona backend ----------------------------------------------------------------------------------------
# Hand the group list to daytona_runner.py, which runs it in a disposable Daytona sandbox. If the sandbox cannot
# start (exit 3) the checks run locally below and the JSON records "backend":"local-fallback".
if [ "$BACKEND" = daytona ]; then
  if [ "$DOCKER_N" -gt 0 ] || [ "$E2E_N" -gt 0 ]; then
    log "Gate 2/3 groups need the local docker daemon; running all checks locally"
    BACKEND=local
  elif [ ${#G_NAME[@]} -eq 0 ]; then
    log "no check groups apply; not starting a daytona sandbox"
    BACKEND=local
  elif [ -f "$DAYTONA_RUNNER" ]; then
    emit_groups_json "$TMP/groups.json"
    DAY_ARGS=(--worktree "$WT" --groups "$TMP/groups.json")
    [ -z "$BASE" ] || DAY_ARGS+=(--base "$BASE")
    [ -z "$JSON_OUT" ] || DAY_ARGS+=(--json "$JSON_OUT")
    [ -z "$FILES_FROM" ] || DAY_ARGS+=(--files-from "$FILES_FROM")
    log "daytona backend: $DAYTONA_RUNNER (groups: $TMP/groups.json)"
    if python3 "$DAYTONA_RUNNER" "${DAY_ARGS[@]}"; then
      exit 0
    else
      log "daytona backend did not start (exit $?); falling back to local"
      BACKEND=local-fallback
    fi
  else
    log "daytona backend requested but $DAYTONA_RUNNER is missing; falling back to local"
    BACKEND=local-fallback
  fi
fi

# ---- execution ----------------------------------------------------------------------------------------------
TO="$(command -v timeout || command -v gtimeout || true)"
START=$SECONDS
OK=1
SEQ=0
hash12() { { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1"; } | cut -c1-12; }

HARDEN=(--rm --network none --memory 2g --memory-swap 2g --pids-limit 512 --cap-drop ALL
  --security-opt no-new-privileges --read-only --user 1000:1000 --tmpfs /tmp:rw,exec,nosuid,size=256m,mode=1777
  -e HOME=/tmp)

ensure_image() { docker image inspect "$1" >/dev/null 2>&1 || docker pull -q "$1" >/dev/null; }

# Populate a dependency volume once. $1=volume $2=image $3=script (runs as root in a throwaway container WITH network,
# with only the CHOWN capability; must write into /cache). On any failure the half-filled volume is removed.
populate() {
  local vol="$1" img="$2" script="$3" name="rx-wb-pop-$$-$RANDOM"
  CONTAINERS+=("$name")
  if ! "$TO" -k 10 "$GROUP_TIMEOUT" docker run --name "$name" --rm --memory 3g --pids-limit 512 --cap-drop ALL --cap-add CHOWN \
    --security-opt no-new-privileges -e HOME=/tmp --tmpfs /tmp:rw,exec,size=512m -v "$vol:/cache" \
    -v "$WT:/w:ro" "$img" bash -c "set -e; $script; touch /cache/.ok; chown -R 1000:1000 /cache" >"$TMP/populate.log" 2>&1; then
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker volume rm -f "$vol" >/dev/null 2>&1 || true
    return 1
  fi
}
vol_ready() { # $1 vol; a volume is usable only when its .ok marker exists
  docker volume inspect "$1" >/dev/null 2>&1 && docker run --rm --network none --cap-drop ALL -v "$1:/cache:ro" \
    "$2" test -f /cache/.ok >/dev/null 2>&1
}

NM_VOL_FOR="" NM_FAIL=""
ensure_nm() { # $1=dir -> sets NM_VOL (or returns 1 with NM_FAIL text)
  local dir="$1" lock="$WT/$1/package-lock.json" slug vol
  slug="$(basename "$dir")"
  [ -f "$lock" ] && [ -f "$WT/$dir/package.json" ] || { NM_FAIL="skip:no package.json/package-lock.json in $dir"; return 1; }
  vol="rx-nm-$slug-$(hash12 "$lock")"
  NM_VOL="$vol"
  if vol_ready "$vol" "$NODE_IMAGE"; then return 0; fi
  log "populating $vol (npm ci, network on, scripts ignored)"
  if ! populate "$vol" "$NODE_IMAGE" "mkdir /cache/b && cp /w/$dir/package.json /w/$dir/package-lock.json /cache/b/ && cd /cache/b \
&& npm ci --ignore-scripts --no-audit --no-fund && mv node_modules /cache/node_modules && cd / && rm -rf /cache/b"; then
    NM_FAIL="fail:npm ci failed for $dir"; return 1
  fi
}
ensure_py() { # sets PY_VOL
  local req="$WT/ci/requirements-test.txt"
  [ -f "$req" ] || { NM_FAIL="skip:ci/requirements-test.txt missing"; return 1; }
  PY_VOL="rx-py-$(hash12 "$req")"
  if vol_ready "$PY_VOL" "$PY_IMAGE"; then return 0; fi
  log "populating $PY_VOL (pip install, network on)"
  if ! populate "$PY_VOL" "$PY_IMAGE" "python -m venv /cache/venv && /cache/venv/bin/pip install -q --no-cache-dir -r /w/ci/requirements-test.txt ruff"; then
    NM_FAIL="fail:pip install failed"; return 1
  fi
}

run_group() { # index
  local i="$1" name="${G_NAME[$1]}" kind="${G_KIND[$1]}" dir="${G_DIR[$1]}" cmd="${G_CMD[$1]}"
  local t0=$SECONDS left lim cname rc=0 out="$TMP/out.$i" status gto
  : >"$out"
  left=$((TOTAL_TIMEOUT - (SECONDS - START)))
  if [ "$left" -le 0 ]; then echo "overall timeout (${TOTAL_TIMEOUT}s) reached before this group" >"$out"; record "$name" "$cmd" skip 0 "$out"; return; fi
  gto="$GROUP_TIMEOUT"; [ "$kind" != docker ] || gto="$DOCKER_TIMEOUT"; [ "$kind" != e2e ] || gto="$E2E_TIMEOUT"
  lim=$gto; [ "$left" -ge "$lim" ] || lim=$left
  if [ -z "$TO" ]; then echo "timeout(1) not found" >"$out"; record "$name" "$cmd" fail 0 "$out"; OK=0; return; fi
  cname="rx-wb-$$-$i"; CONTAINERS+=("$cname")
  case "$kind" in
    host)
      (cd "$WT" && "$TO" -k 5 "$lim" bash -c "$cmd") >"$out" 2>&1 || rc=$? ;;
    e2e)
      command -v docker >/dev/null 2>&1 || { echo "docker unavailable" >"$out"; record "$name" "$cmd" fail 0 "$out"; OK=0; return; }
      (cd "$WT" && "$TO" -k 30 "$lim" bash -c "$cmd") >"$out" 2>&1 || rc=$?
      # The sandbox removes itself on exit; after a failure or timeout kill make sure nothing is left behind.
      if [ "$rc" != 0 ]; then (cd "$WT" && bash "${WB_REL%/server_agents}/e2e/sandbox_down.sh") >/dev/null 2>&1 || true; fi ;;
    docker)
      command -v docker >/dev/null 2>&1 || { echo "docker unavailable" >"$out"; record "$name" "$cmd" fail 0 "$out"; OK=0; return; }
      local tag="${G_TAG[$i]}"; [ -z "$tag" ] || IMAGES+=("$tag")
      (cd "$WT" && "$TO" -k 10 "$lim" bash -c "$cmd") >"$out" 2>&1 || rc=$?
      [ -z "$tag" ] || docker image rm -f "$tag" >/dev/null 2>&1 || true ;;
    node)
      command -v docker >/dev/null 2>&1 || { echo "docker unavailable" >"$out"; record "$name" "$cmd" fail 0 "$out"; OK=0; return; }
      if ! { ensure_image "$NODE_IMAGE" && ensure_nm "$dir"; } 2>>"$out"; then
        { echo "${NM_FAIL:-setup failed}"; tail -n 40 "$TMP/populate.log" 2>/dev/null || true; } >>"$out"
        case "$NM_FAIL" in skip:*) status=skip ;; *) status=fail; OK=0 ;; esac
        record "$name" "$cmd" "${status:-fail}" $((SECONDS - t0)) "$out"; return
      fi
      local excl="--exclude=./node_modules"; [ "$dir" != "$HUB_DIR" ] || excl+=" --exclude=./frontend"
      "$TO" -k 10 "$lim" docker run --name "$cname" "${HARDEN[@]}" --tmpfs /work:rw,exec,nosuid,size=512m,uid=1000,gid=1000 \
        -v "$WT:/w:ro" -v "$NM_VOL:/cache:ro" -w /work -e NODE_OPTIONS=--max-old-space-size=1536 \
        -e NEXT_TELEMETRY_DISABLED=1 -e CI=1 "$NODE_IMAGE" bash -c \
        "set -e; tar -C /w/$dir $excl -cf - . | tar -C /work -xf -; ln -s /cache/node_modules /work/node_modules; $cmd" \
        >"$out" 2>&1 || rc=$? ;;
    lint)
      command -v docker >/dev/null 2>&1 || { echo "docker unavailable" >"$out"; record "$name" "$cmd" fail 0 "$out"; OK=0; return; }
      if ! { ensure_image "$NODE_IMAGE" && ensure_nm "$dir"; } 2>>"$out"; then
        { echo "${NM_FAIL:-setup failed}"; tail -n 40 "$TMP/populate.log" 2>/dev/null || true; } >>"$out"
        case "$NM_FAIL" in skip:*) status=skip ;; *) status=fail; OK=0 ;; esac
        record "$name" "$cmd" "${status:-fail}" $((SECONDS - t0)) "$out"; return
      fi
      local outdir="$TMP/lint.$i" basedir="$TMP/base.$i" lf=() bf="" f
      mkdir -p "$outdir"; chmod 777 "$outdir" 2>/dev/null || true
      mapfile -t lf < <(printf '%s\n' "${G_LFILES[$i]}")
      build_base "$basedir" "$dir" ${lf[@]+"${lf[@]}"}
      for f in ${lf[@]+"${lf[@]}"}; do if [ -f "$basedir/$f" ]; then bf+=" $(printf '%q' "$f")"; fi; done
      local excl="--exclude=./node_modules"; [ "$dir" != "$HUB_DIR" ] || excl+=" --exclude=./frontend"
      local lcmd="${G_LCMD[$i]}" fargs; fargs="$(quote_list ${lf[@]+"${lf[@]}"})"
      local script="set -e; tar -C /w/$dir $excl -cf - . | tar -C /work -xf -; ln -s /cache/node_modules /work/node_modules; "
      script+="$lcmd --format json $fargs > /lintout/current.json || true; "
      if [ -n "$bf" ]; then
        script+="for f in$bf; do cp -f \"/base/\$f\" \"/work/\$f\" 2>/dev/null || true; done; $lcmd --format json$bf > /lintout/base.json || true;"
      else
        script+='echo "[]" > /lintout/base.json;'
      fi
      "$TO" -k 10 "$lim" docker run --name "$cname" "${HARDEN[@]}" --tmpfs /work:rw,exec,nosuid,size=512m,uid=1000,gid=1000 \
        -v "$WT:/w:ro" -v "$NM_VOL:/cache:ro" -v "$basedir:/base:ro" -v "$outdir:/lintout:rw" -w /work \
        -e NODE_OPTIONS=--max-old-space-size=1536 -e NEXT_TELEMETRY_DISABLED=1 -e CI=1 "$NODE_IMAGE" bash -c "$script" \
        >"$out" 2>&1 || rc=$?
      if [ "$rc" = 0 ]; then
        local cmp_out
        if cmp_out="$(python3 "$ESLINT_DIFF" "$outdir/current.json" "$outdir/base.json" 2>&1)"; then
          status=pass
        else
          status=fail; OK=0
        fi
        printf '%s\n' "$cmp_out" >>"$out"
      elif [ "$rc" = 124 ] || [ "$rc" = 137 ]; then status=timeout; OK=0; docker rm -f "$cname" >/dev/null 2>&1 || true
      else status=fail; OK=0; fi
      record "$name" "$cmd" "$status" $((SECONDS - t0)) "$out"; return ;;
    py)
      command -v docker >/dev/null 2>&1 || { echo "docker unavailable" >"$out"; record "$name" "$cmd" fail 0 "$out"; OK=0; return; }
      if ! { ensure_image "$PY_IMAGE" && ensure_py; } 2>>"$out"; then
        { echo "${NM_FAIL:-setup failed}"; tail -n 40 "$TMP/populate.log" 2>/dev/null || true; } >>"$out"
        case "$NM_FAIL" in skip:*) status=skip ;; *) status=fail; OK=0 ;; esac
        record "$name" "$cmd" "${status:-fail}" $((SECONDS - t0)) "$out"; return
      fi
      "$TO" -k 10 "$lim" docker run --name "$cname" "${HARDEN[@]}" -v "$WT:/w:ro" -v "$PY_VOL:/cache:ro" -w /w \
        -e PATH=/cache/venv/bin:/usr/local/bin:/usr/bin:/bin -e PYTHONPATH=/w -e PYTHONDONTWRITEBYTECODE=1 \
        "$PY_IMAGE" bash -c "$cmd" >"$out" 2>&1 || rc=$? ;;
  esac
  if [ "$rc" = 0 ]; then status=pass
  elif [ "$rc" = 124 ] || [ "$rc" = 137 ]; then status=timeout; OK=0; docker rm -f "$cname" >/dev/null 2>&1 || true
  else status=fail; OK=0; fi
  record "$name" "$cmd" "$status" $((SECONDS - t0)) "$out"
}

for ((i = 0; i < ${#G_NAME[@]}; i++)); do
  log "group ${G_NAME[$i]}: ${G_CMD[$i]}"
  run_group "$i" || { OK=0; log "group ${G_NAME[$i]} crashed"; }
done
finish "$OK"
exit 0
