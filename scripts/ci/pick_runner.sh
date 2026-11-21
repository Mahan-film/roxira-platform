#!/usr/bin/env bash
# Pick the runner for each CI slot (#949 T228, #1024 R20-8). Runs on a hosted `ubuntu-slim`
# job before every other CI job and prints GitHub step outputs:
#   light=<JSON runs-on>   lint, unit tests, scanners (no Docker)
#   docker=<JSON runs-on>  service containers, compose, builds, Playwright
#   where=<one line>       human summary for the step summary
#
# Inputs (environment, all optional; the workflow passes repo variables and the event):
#   EVENT        github.event_name
#   HEAD_REPO    github.event.pull_request.head.repo.full_name (pull_request only)
#   REPO         github.repository
#   INPUT        workflow_dispatch input `runner`: default|auto|hosted|box
#   MODE         repo variable CI_RUNNER_MODE: hosted (default) | auto | box
#   HEARTBEAT    repo variable CI_BOX_HEARTBEAT, written by the box every ~2 min:
#                "<unix-epoch> <light-online> <docker-online>"
#   BOX_LIGHT    repo variable CI_BOX_LABELS_LIGHT  (JSON array, default ["self-hosted","hp"])
#   BOX_DOCKER   repo variable CI_BOX_LABELS_DOCKER (JSON array, default ["self-hosted","hp"])
#   HOSTED       repo variable CI_HOSTED_RUNNER (JSON, default "ubuntu-latest")
#   MAX_AGE      heartbeat freshness in seconds (default 300)
#   NOW          override the clock (tests)
#
# Rules:
#   - Only trusted events can reach the box: push, schedule, workflow_dispatch, merge_group and
#     pull_request from a branch of this repo. A fork pull request always gets the hosted runner
#     (the fork-PR guard from docs/ops/LINUX_CI_BOX.md).
#   - MODE hosted (the default, so nothing changes until the hub sets the variable): hosted.
#   - MODE box: the box labels; jobs queue while the box is busy or offline.
#   - MODE auto: per slot, the box when the heartbeat is fresh and that slot has an online runner,
#     otherwise hosted. A busy runner still counts as online: the job queues on the box. Falling
#     back on "busy" would spend the private-repo allowance on every overlap (R20 snippet #5).
#   - Anything unparsable falls back to hosted. The job is continue-on-error in ci.yml and every
#     consumer has `|| '"ubuntu-latest"'`, so a broken picker can never skip required checks.
set -u

hosted="${HOSTED:-}"
[ -n "$hosted" ] || hosted='"ubuntu-latest"'
box_light="${BOX_LIGHT:-}"
[ -n "$box_light" ] || box_light='["self-hosted","hp"]'
box_docker="${BOX_DOCKER:-}"
[ -n "$box_docker" ] || box_docker='["self-hosted","hp"]'
max_age="${MAX_AGE:-300}"
now="${NOW:-$(date +%s)}"

valid_box() {
  # A JSON array of plain label strings that includes "self-hosted"; nothing else is accepted.
  printf '%s' "$1" | grep -Eq '^\[("[A-Za-z0-9._-]+",)*"[A-Za-z0-9._-]+"\]$' \
    && printf '%s' "$1" | grep -q '"self-hosted"'
}
valid_hosted() {
  printf '%s' "$1" | grep -Eq '^"ubuntu-[a-z0-9.-]+"$'
}
valid_hosted "$hosted" || hosted='"ubuntu-latest"'
valid_box "$box_light" || box_light=""
valid_box "$box_docker" || box_docker=""

emit() {
  # emit <light> <docker> <why>
  printf 'light=%s\n' "$1"
  printf 'docker=%s\n' "$2"
  printf 'where=%s\n' "$3"
}

trusted=0
case "${EVENT:-}" in
  push|schedule|workflow_dispatch|merge_group) trusted=1 ;;
  pull_request)
    if [ -n "${HEAD_REPO:-}" ] && [ "${HEAD_REPO:-}" = "${REPO:-}" ]; then trusted=1; fi ;;
esac
if [ "$trusted" != 1 ]; then
  emit "$hosted" "$hosted" "hosted (event ${EVENT:-none} from ${HEAD_REPO:-unknown} never reaches the box)"
  exit 0
fi

mode="${MODE:-hosted}"
case "${INPUT:-}" in
  auto|hosted|box) mode="$INPUT" ;;
esac

case "$mode" in
  box)
    emit "${box_light:-$hosted}" "${box_docker:-$hosted}" "box (mode box; jobs queue while the box is busy or offline)"
    exit 0 ;;
  auto) ;;
  *)
    emit "$hosted" "$hosted" "hosted (mode ${mode})"
    exit 0 ;;
esac

# auto: read the heartbeat "<epoch> <light-online> <docker-online>".
read -r hb_ts hb_light hb_docker _ <<EOF
${HEARTBEAT:-}
EOF
is_int() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
if ! is_int "${hb_ts:-}" || ! is_int "${hb_light:-}" || ! is_int "${hb_docker:-}"; then
  emit "$hosted" "$hosted" "hosted (auto: no box heartbeat)"
  exit 0
fi
age=$(( now - hb_ts ))
# A heartbeat from the future (clock skew) of more than a minute is not trusted either.
if [ "$age" -gt "$max_age" ] || [ "$age" -lt -60 ]; then
  emit "$hosted" "$hosted" "hosted (auto: box heartbeat ${age}s old)"
  exit 0
fi
light="$hosted"; docker="$hosted"
[ "$hb_light" -gt 0 ] && [ -n "$box_light" ] && light="$box_light"
[ "$hb_docker" -gt 0 ] && [ -n "$box_docker" ] && docker="$box_docker"
emit "$light" "$docker" "auto (heartbeat ${age}s, light online ${hb_light}, docker online ${hb_docker})"
