#!/usr/bin/env bash
# Isolated, short-lived compose previews. Run from any directory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
dry_run=0
args=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then dry_run=1; else args+=("$arg"); fi
done
set -- "${args[@]}"

fail() { printf "preview: %s\n" "$*" >&2; exit 2; }
usage() { fail "usage: $0 [--dry-run] up <slug> <compose-file> | down <slug> | gc"; }
validate_slug() {
  python3 -c 'from factory_pipeline.preview_gate import validate_slug; import sys; print(validate_slug(sys.argv[1]))' "$1" 2>/dev/null \
    || fail "invalid preview slug"
}
safe_compose() {
  [[ -f "$1" ]] || fail "compose file not found: $1"
  grep -Eqi "(/var/run/docker\\.sock|network_mode:[[:space:]]*host|privileged:[[:space:]]*true|^[[:space:]]*(secrets|env_file):|external:|name:.*(prod|production)|^[[:space:]]*-[[:space:]]*['\\\"]?/[^:]*:|source:[[:space:]]*/|secret|password|token|api[_-]?key)" "$1" \
    && fail "compose file has a forbidden host, external, or secret attachment"
  grep -Eq 'roxira\.preview.*PREVIEW_LABEL' "$1" && grep -Eq 'roxira\.preview\.created.*PREVIEW_CREATED_EPOCH' "$1" \
    || fail "compose file must declare roxira.preview and roxira.preview.created labels"
}
limits() {
  python3 -c 'from factory_pipeline.preview_gate import compose_limits, host_port_for; import sys; l=compose_limits(); print(l["cpus"], l["mem_limit"], host_port_for(sys.argv[1]))' "$1"
}

case "${1:-}" in
  up)
    [[ $# -eq 3 ]] || usage
    slug="$(validate_slug "$2")"; compose_file="$3"; safe_compose "$compose_file"
    read -r PREVIEW_CPUS PREVIEW_MEM PREVIEW_PORT <<< "$(limits "$slug")"
    PREVIEW_CREATED_EPOCH="$(date +%s)"
    command="PREVIEW_MEM=$PREVIEW_MEM PREVIEW_CPUS=$PREVIEW_CPUS PREVIEW_PORT=$PREVIEW_PORT PREVIEW_LABEL=1 PREVIEW_CREATED_EPOCH=$PREVIEW_CREATED_EPOCH docker compose -p preview-$slug -f $compose_file up -d --build"
    if (( dry_run )); then printf '%s\n' "$command"; exit 0; fi
    existing="$(docker ps -a --filter label=roxira.preview=1 --format '{{.Label "com.docker.compose.project"}}={{.Label "roxira.preview.created"}}')"
    action="$(printf '%s\n' "$existing" | python3 -c 'from factory_pipeline.preview_gate import plan_action; import sys,time; existing={line.split("=", 1)[0].removeprefix("preview-"): time.time() for line in sys.stdin if "=" in line}; print(plan_action(existing, sys.argv[1], time.time())["action"])' "$slug")"
    [[ "$action" != reject ]] || fail "preview limit reached (maximum two)"
    PREVIEW_MEM="$PREVIEW_MEM" PREVIEW_CPUS="$PREVIEW_CPUS" PREVIEW_PORT="$PREVIEW_PORT" PREVIEW_LABEL=1 PREVIEW_CREATED_EPOCH="$PREVIEW_CREATED_EPOCH" docker compose -p "preview-$slug" -f "$compose_file" up -d --build
    ;;
  down)
    [[ $# -eq 2 ]] || usage; slug="$(validate_slug "$2")"
    command="docker compose -p preview-$slug down -v"
    if (( dry_run )); then printf '%s\n' "$command"; else docker compose -p "preview-$slug" down -v; fi
    ;;
  gc)
    [[ $# -eq 1 ]] || usage
    if (( dry_run )); then printf '%s\n' "docker ps -a --filter label=roxira.preview=1 --format '{{.Label \"com.docker.compose.project\"}} {{.Label \"roxira.preview.created\"}}'"; exit 0; fi
    typeset -A seen
    while read -r project created; do
      [[ -n "$project" && -z "${seen[$project]-}" ]] || continue; seen[$project]=1
      python3 -c 'from factory_pipeline.preview_gate import is_expired; import sys,time; raise SystemExit(0 if is_expired(float(sys.argv[1]), time.time()) else 1)' "$created" \
        && docker compose -p "$project" down -v
    done < <(docker ps -a --filter label=roxira.preview=1 --format '{{.Label "com.docker.compose.project"}} {{.Label "roxira.preview.created"}}')
    ;;
  *) usage ;;
esac
