#!/usr/bin/env bash
# Pick the runner for each CI slot (#949 T228, #1024 R20-8). Runs on a hosted `ubuntu-slim`
# job before every other CI job and prints GitHub step outputs:
#   light=<JSON runs-on>        lint, unit tests, scanners (no Docker)
#   docker=<JSON runs-on>       service containers, compose, builds, Playwright
#   image_registry=<prefix>     container image registry prefix for service containers
#   where=<one line>            human summary for the step summary
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
#   MAX_WAIT     longest wait between the event and this job for which the event time is used
#                as the reference (default 5400); after that the clock is used (see below)
#   GITHUB_EVENT_PATH  the event payload (set by the runner); read for the event time
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
#   - Heartbeat age is measured at the event time, not now: `vars` are read when the run is
#     created, and a main run can wait 30+ min in the concurrency queue before this job starts
#     (run 45118378279 saw a 2213 s old heartbeat while the box was writing one every 2 min).
#     Event time: push repository.pushed_at or head_commit.timestamp, merge_group
#     head_commit.timestamp, pull_request updated_at. schedule and workflow_dispatch carry none
#     and use the clock. If the job starts more than MAX_WAIT after the event, the clock is used
#     again, so a box that died while the run waited still falls back to hosted.
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
max_wait="${MAX_WAIT:-5400}"
now="${NOW:-$(date +%s)}"

valid_box() {
  # A JSON array of plain label strings that includes "self-hosted"; nothing else is accepted.
  printf '%s' "$1" | grep -Eq '^\[("[A-Za-z0-9._-]+",)*"[A-Za-z0-9._-]+"\]$' \
    && printf '%s' "$1" | grep -q '"self-hosted"'
}
valid_hosted() {
  printf '%s' "$1" | grep -Eq '^"ubuntu-[a-z0-9.-]+"$'
}
valid_registry() {
  printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9.-]*(/[a-z0-9._-]+)*$'
}
valid_hosted "$hosted" || hosted='"ubuntu-latest"'
valid_box "$box_light" || box_light=""
valid_box "$box_docker" || box_docker=""
custom_registry="${IMAGE_REGISTRY:-}"
valid_registry "$custom_registry" || custom_registry=""

emit() {
  # emit <light> <docker> <why>
  local reg="$custom_registry"
  if [ -z "$reg" ]; then
    case "$2" in
      *'"self-hosted"'*) reg="public.ecr.aws/docker/library" ;;
      *) reg="mirror.gcr.io/library" ;;
    esac
  fi
  printf 'light=%s\n' "$1"
  printf 'docker=%s\n' "$2"
  printf 'image_registry=%s\n' "$reg"
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

event_time() {
  # prints "<epoch> <field>" for the event, or nothing
  local f="${GITHUB_EVENT_PATH:-}"
  [ -n "$f" ] && [ -r "$f" ] || return 0
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$f" "${EVENT:-}" <<'PYEOF' 2>/dev/null && return 0
import json, sys
from datetime import datetime
ev = json.load(open(sys.argv[1]))
fields = {
    "push": [("repository", "pushed_at"), ("head_commit", "timestamp")],
    "merge_group": [("merge_group", "head_commit", "timestamp")],
    "pull_request": [("pull_request", "updated_at")],
}.get(sys.argv[2], [])
for path in fields:
    v = ev
    for k in path:
        v = v.get(k) if isinstance(v, dict) else None
    t = None
    if isinstance(v, int) and not isinstance(v, bool) and v > 0:
        t = v
    elif isinstance(v, str) and v:
        try:
            t = int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp())
        except ValueError:
            t = None
    if t:
        print(t, ".".join(path))
        break
PYEOF
  fi
  # No python3: push payloads carry repository.pushed_at as a plain integer.
  if [ "${EVENT:-}" = push ]; then
    local t
    t="$(grep -o '"pushed_at": *[0-9][0-9]*' "$f" 2>/dev/null | head -1 | grep -o '[0-9][0-9]*$')"
    is_int "$t" && echo "$t repository.pushed_at"
  fi
  return 0
}
ref="$now"; ref_src="clock"
read -r ev_ts ev_src _ <<EOF
$(event_time)
EOF
if is_int "${ev_ts:-}" && [ "$ev_ts" -le $(( now + 60 )) ] && [ $(( now - ev_ts )) -le "$max_wait" ]; then
  ref="$ev_ts"; ref_src="event $ev_src, $(( now - ev_ts ))s ago"
fi

if ! is_int "${hb_ts:-}" || ! is_int "${hb_light:-}" || ! is_int "${hb_docker:-}"; then
  emit "$hosted" "$hosted" "hosted (auto: no box heartbeat)"
  exit 0
fi
age=$(( ref - hb_ts ))
# A heartbeat from the future (clock skew) of more than a minute is not trusted either.
if [ "$age" -gt "$max_age" ] || [ "$age" -lt -60 ]; then
  emit "$hosted" "$hosted" "hosted (auto: box heartbeat ${age}s old at ${ref_src})"
  exit 0
fi
light="$hosted"; docker="$hosted"
[ "$hb_light" -gt 0 ] && [ -n "$box_light" ] && light="$box_light"
[ "$hb_docker" -gt 0 ] && [ -n "$box_docker" ] && docker="$box_docker"
emit "$light" "$docker" "auto (heartbeat ${age}s at ${ref_src}, light online ${hb_light}, docker online ${hb_docker})"
