#!/usr/bin/env bash
# Run ONE routine coding task on the server with a cheap/free model (OpenCode), in an isolated git worktree.
# Hub usage:  ssh roxira-prod '/opt/roxira_platform/scripts/infra/server_agents/run_task.sh --model groq-strong \
#                --task-file /tmp/t.md --scope docs/ops/ --push'
#
#   run_task.sh (--task TEXT | --task-file FILE) [--model ALIAS] [--scope PATH]... [--public] [--push]
#               [--timeout SECS] [--slug WORD] [--cleanup] [--dry-run] [--gateway] [--tier light|strong|best]
#               [--no-checks]   skip the post-run workbench checks (workbench.sh: docker-isolated tsc/eslint/jest/ruff/pytest)
#   --gateway   route through the key-pool gateway: --tier strong (default) -> group agent-strong-free,
#               --tier light -> agent-light-free. URL from $AGENT_GATEWAY_URL (default
#               http://127.0.0.1:4000/v1, key KEYPOOL_MASTER_KEY). Free providers may log: needs --public.
#   run_task.sh --smoke [--model ALIAS]      verification run (throwaway worktree, nothing pushed)
#   run_task.sh --list                       agent/* branches known to the agents' clone
#
# Aliases (from /etc/roxira/agent-aliases.tsv, rendered from config/models.yaml by setup.sh):
#   groq-fast, groq-strong, ds-flash, free-public.   :free models need --public (public code only).
# Flow: fetch origin/main -> new worktree + branch agent/<date>-<slug> under /var/lib/roxira-agents/worktrees
#       -> opencode run (own config, hard timeout, secrets/data denied, edit limited to --scope)
#       -> the RUNNER commits (the agent may not) -> scope/secret check -> stat + diff -> optional push of
#       agent/* only (never main, never force) -> one JSON result line (last line of stdout).
# Exit code: 0 only when the run finished, stayed in scope and (for --smoke) the check passed.
# Env overrides (tests): ROXIRA_ETC_DIR, ROXIRA_AGENTS_HOME, ROXIRA_AGENT_USER, OPENCODE_BIN.
set -euo pipefail

ETC_DIR="${ROXIRA_ETC_DIR:-/etc/roxira}"
STATE="${ROXIRA_AGENTS_HOME:-/var/lib/roxira-agents}"
AGENT_USER="${ROXIRA_AGENT_USER-roxira-agent}"
OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
CONFIG="$ETC_DIR/opencode-agents.json"
ALIASES="$ETC_DIR/agent-aliases.tsv"
ENV_FILE="$ETC_DIR/agents.env"
BARE="$STATE/repo.git"
BASE_REF="refs/remotes/origin/main"

TASK="" TASK_FILE="" MODEL_ALIAS="" TIMEOUT=900 SLUG="" PUSH=0 PUBLIC=0 CLEANUP=0 DRY=0 SMOKE=0 LIST=0
SCOPES=()
NO_FALLBACK=0 GATEWAY=0 TIER="" NO_CHECKS=0
AGENT_GATEWAY_URL="${AGENT_GATEWAY_URL:-http://127.0.0.1:4000/v1}"
REPO_ENV="${ROXIRA_REPO_ENV:-/opt/roxira_platform/.env}"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '[agent-run] %s\n' "$*" >&2; }
die() { printf '[agent-run] ERROR: %s\n' "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="${2?--task needs text}"; shift ;;
    --task-file) TASK_FILE="${2?--task-file needs a path}"; shift ;;
    --model) MODEL_ALIAS="${2?--model needs an alias}"; shift ;;
    --scope) SCOPES+=("${2?--scope needs a path}"); shift ;;
    --timeout) TIMEOUT="${2?--timeout needs seconds}"; shift ;;
    --slug) SLUG="${2?--slug needs a word}"; shift ;;
    --public) PUBLIC=1 ;;
    --push) PUSH=1 ;;
    --cleanup) CLEANUP=1 ;;
    --dry-run) DRY=1 ;;
    --smoke) SMOKE=1 ;;
    --list) LIST=1 ;;
    --no-checks) NO_CHECKS=1 ;;
    --no-fallback) NO_FALLBACK=1 ;;
    --gateway) GATEWAY=1 ;;
    --tier) TIER="${2?--tier needs light, strong or best}"; shift ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

as_agent() { if [ -n "$AGENT_USER" ]; then runuser -u "$AGENT_USER" -- "$@"; else "$@"; fi; }
ag_git() { as_agent git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c safe.directory='*' \
  -c user.name=roxira-agent -c user.email=agent@roxira.local "$@"; }

if [ "$LIST" = 1 ]; then
  [ -d "$BARE" ] || die "$BARE missing: run setup.sh first"
  git --git-dir="$BARE" for-each-ref --sort=-committerdate \
    --format='%(refname:short)  %(committerdate:iso8601)  %(subject)' 'refs/heads/agent/'
  exit 0
fi

# ---- inputs -----------------------------------------------------------------
if [ "$SMOKE" = 1 ]; then
  [ "$PUSH" = 0 ] || die "--smoke never pushes"
  MODEL_ALIAS="${MODEL_ALIAS:-groq-fast}"
  SLUG="smoke"; CLEANUP=1; SCOPES=("docs/agents/")
  [ -n "$TASK$TASK_FILE" ] || TASK="Create the file docs/agents/SMOKE.md containing exactly one line of plain text: 'agent smoke test ok'. Create no other file and change nothing else."
fi
MODEL_ALIAS="${MODEL_ALIAS:-groq-strong}"
if [ -n "$TASK_FILE" ]; then
  [ -r "$TASK_FILE" ] || die "cannot read $TASK_FILE"
  TASK="$(cat "$TASK_FILE")"
fi
[ -n "${TASK//[[:space:]]/}" ] || die "give --task TEXT or --task-file FILE"
case "$TIMEOUT" in '' | *[!0-9]*) die "--timeout must be whole seconds" ;; esac

# ---- alias -> model ---------------------------------------------------------
MODEL_REF="" PUBLIC_ONLY=0 KEYVAR=""
resolve_alias() { # alias -> MODEL_REF PUBLIC_ONLY KEYVAR (empty MODEL_REF when unknown)
  MODEL_REF="" PUBLIC_ONLY=0 KEYVAR=""
  if [ -r "$ALIASES" ]; then
    local a ref pub kv
    while IFS=$'\t' read -r a ref pub kv; do
      case "$a" in '#'* | '') continue ;; esac
      if [ "$a" = "$1" ]; then MODEL_REF="$ref" PUBLIC_ONLY="$pub" KEYVAR="$kv"; fi
    done <"$ALIASES"
  else
    case "$1" in   # fallback = same defaults setup.sh renders
      groq-strong) MODEL_REF="groq/openai/gpt-oss-120b" KEYVAR=GROQ_API_KEY ;;
      groq-fast) MODEL_REF="groq/openai/gpt-oss-20b" KEYVAR=GROQ_API_KEY ;;
      ds-flash) MODEL_REF="openrouter/deepseek/deepseek-v4.1-flash" KEYVAR=OPENROUTER_API_KEY_AGENTS ;;
      free-public) MODEL_REF="openrouter/qwen/qwen3.8-27b:free" PUBLIC_ONLY=1 KEYVAR=OPENROUTER_API_KEY_AGENTS ;;
    esac
  fi
  case "$MODEL_REF" in *:free | openrouter/free) PUBLIC_ONLY=1 ;; esac
}
resolve_alias "$MODEL_ALIAS"
case "$TIER" in '' | light | strong | best) ;; *) die "--tier must be light, strong or best" ;; esac
if [ "$GATEWAY" = 1 ] || [ -n "$TIER" ]; then   # key-pool gateway; --tier picks the model tier group
  GATEWAY=1
  case "$TIER" in
    light) MODEL_REF="keypool/agent-light-free" ;;
    best) MODEL_REF="keypool/best-all" ;;   # quality ladder over ALL keys (Gemini x4, Groq x3, Mistral x4, SambaNova)
    *) MODEL_REF="keypool/agent-strong-free" ;;   # default, and --tier strong
  esac
  MODEL_ALIAS=gateway PUBLIC_ONLY=1 KEYVAR=KEYPOOL_MASTER_KEY
fi
[ -n "$MODEL_REF" ] || die "unknown model alias '$MODEL_ALIAS' (groq-fast, groq-strong, ds-flash, free-public)"
if [ "$PUBLIC_ONLY" = 1 ] && [ "$PUBLIC" != 1 ]; then
  die "$MODEL_ALIAS is a :free-tier model (providers may log/train on prompts). Public code only: pass --public to confirm."
fi

# ---- scope ------------------------------------------------------------------
DENY_GLOBS=('.env' '.env*' '**/.env*' '**/*.env' 'data/**' 'database_snapshots/**' '**/*.sql' '**/*.pem' '**/*.key'
  '**/*.tar.gz' '**/*.snapshot' 'repomix-output.xml' '**/id_rsa*' '**/id_ed25519*' 'secrets/**' 'opencode.json' '.opencode/**')
DENY_RE='(^|/)\.env|\.env$|^data/|^database_snapshots/|\.sql$|\.pem$|\.key$|\.tar\.gz$|\.snapshot$|^repomix-output\.xml$|(^|/)id_(rsa|ed25519)|^secrets/|^opencode\.json$|^\.opencode/|^\.git/'
SCOPE_ARGS=()
for s in ${SCOPES[@]+"${SCOPES[@]}"}; do
  case "$s" in /* | *..* | '') die "scope '$s' must be a repo-relative path without .." ;; esac
  if printf '%s' "$s" | grep -Eq "$DENY_RE"; then die "scope '$s' touches a denied path (secrets/data)"; fi
  SCOPE_ARGS+=("$s")
done

in_scope() { # file -> 0 when allowed by --scope (no scope = anywhere not denied)
  local f="$1" s
  if printf '%s' "$f" | grep -Eq "$DENY_RE"; then return 1; fi
  [ ${#SCOPE_ARGS[@]} -gt 0 ] || return 0
  for s in "${SCOPE_ARGS[@]}"; do
    case "$s" in */) case "$f" in "$s"*) return 0 ;; esac ;; *) if [ "$f" = "$s" ]; then return 0; fi; case "$f" in "$s"/*) return 0 ;; esac ;; esac
  done
  return 1
}

# ---- names ------------------------------------------------------------------
if [ -z "$SLUG" ]; then
  SLUG="$(printf '%s' "$TASK" | head -n1 | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//' | cut -c1-28)"
fi
SLUG="$(printf '%s' "${SLUG:-task}" | tr -c 'a-z0-9-' '-' | cut -c1-28)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BRANCH="agent/$STAMP-$SLUG"
git check-ref-format "refs/heads/$BRANCH" || die "bad branch name $BRANCH"
case "$BRANCH" in agent/*) ;; *) die "branch must be agent/*" ;; esac
WT="$STATE/worktrees/${BRANCH#agent/}"
LOG="$STATE/logs/${BRANCH#agent/}.log"

# ---- permission/config overlay ---------------------------------------------
make_overlay() { # prints the JSON handed to OPENCODE_CONFIG_CONTENT
  OV_CONFIG="$CONFIG" OV_MODEL="$MODEL_REF" OV_SCOPES="$(printf '%s\n' ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"})" \
    OV_DENY="$(printf '%s\n' "${DENY_GLOBS[@]}")" OV_WT="$WT" OV_GW="$GATEWAY" OV_GW_URL="$AGENT_GATEWAY_URL" python3 - <<'PY'
import json, os
cfg = {}
p = os.environ["OV_CONFIG"]
if os.path.isfile(p):
    cfg = json.load(open(p))
scopes = [s for s in os.environ["OV_SCOPES"].split("\n") if s]
deny = [d for d in os.environ["OV_DENY"].split("\n") if d]
def scope_glob(s):
    return s + "**" if s.endswith("/") else s
edit = {"*": "deny" if scopes else "allow"}
for s in scopes:
    edit[scope_glob(s)] = "allow"
    if not s.endswith("/"):
        edit[s + "/**"] = "allow"
for d in deny:
    edit[d] = "deny"
read = {"*": "allow"}
for d in deny:
    read[d] = "deny"
bash = {"*": "deny"}
for c in ["ls", "ls *", "pwd", "git status*", "git diff*", "git log*", "git show*", "grep *", "rg *", "head *",
          "tail *", "wc *", "sed -n *", "cat *", "find *", "python3 -m py_compile *", "bash -n *", "ruff check *", "ruff format --check *"]:
    bash[c] = "allow"
for c in ["cat *.env*", "cat /*", "cat ~*", "cat *../*", "head /*", "tail /*", "grep * /*", "rg * /*", "find /*",
          "find * -exec *", "find * -delete*", "ls /*", "ls ~*", "*printenv*", "* /etc/*", "* /opt/*", "* /root/*", "* /var/*",
          "* ~/*", "*curl *", "*wget *", "*ssh *", "*scp *", "*nc *", "*git commit*", "*git push*", "*git checkout*",
          "*git reset*", "*git clean*", "*git remote*", "*git config*", "*rm *", "*sudo *", "*chmod *", "*chown *"]:
    bash[c] = "deny"
if os.environ["OV_GW"] == "1":   # key-pool gateway as one OpenAI-compatible provider; key via env, never inline
    cfg.setdefault("provider", {})["keypool"] = {
        "npm": "@ai-sdk/openai-compatible", "name": "keypool",
        "options": {"baseURL": os.environ["OV_GW_URL"], "apiKey": "{env:KEYPOOL_MASTER_KEY}"},
        "models": {
            "agent-free": {"name": "agent-free"},
            "agent-strong-free": {"name": "agent-strong-free"},
            "agent-light-free": {"name": "agent-light-free"},
            "gemini-best": {"name": "gemini-best"},
            "best-all": {"name": "best-all"},
        }}
    ep = cfg.get("enabled_providers")
    if isinstance(ep, list) and "keypool" not in ep:   # base config whitelists providers; add the gateway
        cfg["enabled_providers"] = ep + ["keypool"]
cfg["model"] = os.environ["OV_MODEL"]
cfg["small_model"] = os.environ["OV_MODEL"]   # titles etc. must not go to a different (default) provider
cfg["permission"] = {"edit": edit, "read": read, "bash": bash, "webfetch": "deny", "websearch": "deny",
                     "external_directory": "deny", "doom_loop": "deny"}
print(json.dumps(cfg))
PY
}

PROMPT="You are an automated coding agent in an isolated git worktree of the Roxira repository (cwd).
Rules: edit only files under: ${SCOPE_ARGS[*]:-the repository (but never secrets, .env or data/)}.
Do NOT run git commit/push/checkout; the runner commits for you. No network access. Never read or write
secrets, .env files, data/ or customer files. Keep the change minimal and consistent with the surrounding code.
When finished, reply with a two-line summary of what you changed.

TASK:
$TASK"

if [ "$DRY" = 1 ]; then
  log "[dry-run] model alias=$MODEL_ALIAS ref=$MODEL_REF public_only=$PUBLIC_ONLY key_var=$KEYVAR timeout=${TIMEOUT}s"
  log "[dry-run] branch=$BRANCH worktree=$WT push=$PUSH scope=${SCOPE_ARGS[*]:-<whole repo minus denied paths>}"
  log "[dry-run] would: fetch origin main into $BARE; git worktree add; opencode run; commit; diff; push=$PUSH (agent/* only)"
  make_overlay | python3 -c 'import json,sys; c=json.load(sys.stdin); c.pop("provider",None); print(json.dumps(c, indent=1))' >&2
  exit 0
fi

# ---- preflight --------------------------------------------------------------
[ -d "$BARE" ] || die "$BARE missing: run scripts/infra/server_agents/setup.sh first"
command -v timeout >/dev/null || die "timeout (coreutils) is required"
command -v "$OPENCODE_BIN" >/dev/null || die "$OPENCODE_BIN not found"
# Keys: parsed (never sourced), whitelisted NAMES only, never printed. Sources, first value wins:
# the environment, then /etc/roxira/agents.env, then the server .env (GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 set by
# scripts/ops/set_server_env.sh). The prod OPENROUTER_API_KEY is deliberately NOT read.
KEY_NAMES=(GROQ_API_KEY GROQ_API_KEY_2 GROQ_API_KEY_3 OPENROUTER_API_KEY_AGENTS KEYPOOL_MASTER_KEY)
for f in "$ENV_FILE" "$REPO_ENV"; do
  [ -r "$f" ] || continue
  while IFS= read -r line; do
    n="${line%%=*}"
    for k in "${KEY_NAMES[@]}"; do
      if [ "$n" = "$k" ] && [ -z "${!k:-}" ] && [ -n "${line#*=}" ]; then
        v="${line#*=}"; v="${v%\"}"; v="${v#\"}"; printf -v "$k" '%s' "$v"
      fi
    done
  done <"$f"
done
GKEYS=()
for k in GROQ_API_KEY GROQ_API_KEY_2 GROQ_API_KEY_3; do [ -z "${!k:-}" ] || GKEYS+=("${!k}"); done
if [ "$KEYVAR" = GROQ_API_KEY ]; then
  [ ${#GKEYS[@]} -gt 0 ] || die "no GROQ_API_KEY found (env, $ENV_FILE or $REPO_ENV): store it with scripts/ops/set_server_env.sh"
else
  [ -n "${!KEYVAR:-}" ] || die "$KEYVAR is empty: run setup.sh to store it in $ENV_FILE"
fi
unset GROQ_API_KEY   # exported again per attempt, one key at a time; spare keys are never exported
export OPENROUTER_API_KEY_AGENTS="${OPENROUTER_API_KEY_AGENTS:-}"
if [ "$GATEWAY" = 1 ]; then export KEYPOOL_MASTER_KEY; else unset KEYPOOL_MASTER_KEY; fi
[ -r "$CONFIG" ] || die "$CONFIG missing: run setup.sh"

START=$SECONDS
mkdir -p "$STATE/worktrees" "$STATE/logs"
# the agent user must own its work areas even if a root run created them first
if [ "$(id -u)" = 0 ] && id "$AGENT_USER" >/dev/null 2>&1; then chown "$AGENT_USER" "$STATE/worktrees" "$STATE/logs"; fi
git --git-dir="$BARE" -c safe.directory='*' fetch --quiet origin "+refs/heads/main:$BASE_REF" || die "fetch of origin/main failed"
if [ -n "$AGENT_USER" ]; then chown -R "$AGENT_USER" "$BARE"; fi
ag_git --git-dir="$BARE" worktree add --no-checkout -b "$BRANCH" "$WT" "$BASE_REF" >/dev/null 2>&1 || die "worktree add failed"
cd "$WT"
# keep secrets/data and the repo's own opencode config out of the checkout entirely
ag_git sparse-checkout set --no-cone '/*' '!/data/' '!/database_snapshots/' '!/secrets/' '!/.claude/' '!/.opencode/' \
  '!/opencode.json' '!/opencode.jsonc' '!/repomix-output.xml' '!.env*' '!*.sql' '!*.tar.gz' '!*.snapshot' >/dev/null 2>&1
ag_git read-tree -mu HEAD
log "worktree $WT on $BRANCH (base $(ag_git rev-parse --short "$BASE_REF")), model $MODEL_REF, timeout ${TIMEOUT}s"

export HOME="$STATE/home" XDG_CONFIG_HOME="$STATE/xdg/config" XDG_DATA_HOME="$STATE/xdg/data" \
  XDG_CACHE_HOME="$STATE/xdg/cache" XDG_STATE_HOME="$STATE/xdg/state"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_PROJECT_CONFIG=1
export OPENCODE_CONFIG="$CONFIG"
: >"$LOG"; if [ -n "$AGENT_USER" ]; then chown "$AGENT_USER" "$LOG"; fi
RUNNER=()
if [ -n "$AGENT_USER" ]; then RUNNER=(runuser -u "$AGENT_USER" --); fi

EXIT=0
KEY_I=0 RATE_RETRIED=0 FALLBACK_DONE=0 RATE_LIMITED=false
EVENTS=()
RATE_BACKOFF="${ROXIRA_RATE_BACKOFF:-30}"
CUR="$LOG.cur"

run_opencode() {
  OPENCODE_CONFIG_CONTENT="$(make_overlay)"; export OPENCODE_CONFIG_CONTENT
  if [ "$KEYVAR" = GROQ_API_KEY ]; then export GROQ_API_KEY="${GKEYS[$KEY_I]}"; else unset GROQ_API_KEY; fi
  EXIT=0
  : >"$CUR"; if [ -n "$AGENT_USER" ]; then chown "$AGENT_USER" "$CUR"; fi
  timeout --kill-after=15 "$TIMEOUT" ${RUNNER[@]+"${RUNNER[@]}"} "$OPENCODE_BIN" run -m "$MODEL_REF" "$PROMPT" \
    </dev/null >"$CUR" 2>&1 || EXIT=$?
  cat "$CUR" >>"$LOG"
  unset GROQ_API_KEY
}
classify() { # auth | rate | other ; only when the attempt failed or changed nothing
  local changed
  changed="$(ag_git status --porcelain || true)"  # full output: head -c1 + pipefail = SIGPIPE false negatives
  if [ "$EXIT" = 0 ] && [ -n "$changed" ]; then echo other; return; fi
  if tail -n 60 "$CUR" | grep -Eqi 'unauthorized|invalid[ _-]*api[ _-]*key|incorrect api key|authentication|forbidden|(^|[^0-9])(401|403)([^0-9]|$)'; then echo auth
  elif tail -n 60 "$CUR" | grep -Eqi 'rate[ _-]*limit|too many requests|quota|(^|[^0-9])429([^0-9]|$)'; then echo rate
  else echo other; fi
}

while :; do
  run_opencode
  [ "$EXIT" != 124 ] || { log "TIMEOUT after ${TIMEOUT}s (partial changes are kept for review)"; break; }
  case "$(classify)" in
    auth)
      # Failover ONLY for an auth error (bad/revoked key). Never used to dodge rate limits.
      if [ "$KEYVAR" = GROQ_API_KEY ] && [ $((KEY_I + 1)) -lt ${#GKEYS[@]} ]; then
        MSG="auth error on groq key $((KEY_I + 1)) -> key $((KEY_I + 2))"; EVENTS+=("$MSG"); log "$MSG"
        KEY_I=$((KEY_I + 1)); continue
      fi
      EVENTS+=("auth error, no further key"); break ;;
    rate)
      RATE_LIMITED=true
      if [ "$RATE_RETRIED" = 0 ]; then
        RATE_RETRIED=1; MSG="rate limited (429): backoff ${RATE_BACKOFF}s, same key"; EVENTS+=("$MSG"); log "$MSG"
        sleep "$RATE_BACKOFF"; continue
      fi
      if [ "$FALLBACK_DONE" = 0 ] && [ "$NO_FALLBACK" = 0 ] && [ "$PUBLIC_ONLY" = 0 ] && [ "$MODEL_ALIAS" != ds-flash ] \
        && [ -n "${OPENROUTER_API_KEY_AGENTS:-}" ]; then
        FALLBACK_DONE=1; RATE_RETRIED=0
        resolve_alias ds-flash
        [ -n "$MODEL_REF" ] || { EVENTS+=("rate limited; ds-flash alias missing"); break; }
        MSG="rate limited again: falling back to ds-flash ($MODEL_REF)"; EVENTS+=("$MSG"); log "$MSG"
        MODEL_ALIAS=ds-flash; continue
      fi
      EVENTS+=("rate limited, no fallback"); break ;;
    *) break ;;
  esac
done
log "opencode exit=$EXIT (log: $LOG; not printed here, it can echo prompts)"

# ---- collect (the runner commits; the agent could not) -----------------------------------------------
ag_git add -A >/dev/null 2>&1 || true   # fails (harmlessly) when the agent wrote into a sparse-excluded path
FILES=()
while IFS= read -r f; do [ -z "$f" ] || FILES+=("$f"); done < <(ag_git diff --cached --name-only)
VIOLATIONS=()
while IFS= read -r f; do [ -z "$f" ] || VIOLATIONS+=("$f (not staged)"); done \
  < <(ag_git status --porcelain --untracked-files=all | sed -n 's/^?? //p')
for f in ${FILES[@]+"${FILES[@]}"}; do in_scope "$f" || VIOLATIONS+=("$f"); done
if [ ${#FILES[@]} -gt 0 ]; then
  ag_git commit -q -m "agent: $SLUG" -m "model: $MODEL_REF
runner: scripts/infra/server_agents/run_task.sh (exit=$EXIT)
Review before merge; never merged automatically." >/dev/null
fi
OK=1
[ "$EXIT" = 0 ] || OK=0
[ ${#VIOLATIONS[@]} -eq 0 ] || { OK=0; log "OUT OF SCOPE / DENIED files changed: ${VIOLATIONS[*]} -> will NOT push"; }

echo "=== diff stat ($BRANCH vs origin/main) ==="
ag_git diff --stat "$BASE_REF...$BRANCH"
echo "=== diff (first 600 lines) ==="
ag_git diff "$BASE_REF...$BRANCH" | head -n 600

PUSHED=false
if [ "$PUSH" = 1 ]; then
  if [ "$OK" != 1 ]; then log "not pushing: run was not clean"
  elif [ ${#FILES[@]} -eq 0 ]; then log "not pushing: no changes"
  else
    case "$BRANCH" in
      agent/*) git --git-dir="$BARE" -c safe.directory='*' push --quiet origin "refs/heads/$BRANCH:refs/heads/$BRANCH" \
        && PUSHED=true; [ "$PUSHED" = true ] || { OK=0; log "push failed"; } ;;
      *) die "refusing to push a non agent/* branch" ;;
    esac
  fi
fi

SMOKE_OK=""
if [ "$SMOKE" = 1 ]; then
  SMOKE_OK=false
  if [ "$OK" = 1 ] && [ ${#FILES[@]} -eq 1 ] && [ "${FILES[0]}" = "docs/agents/SMOKE.md" ] \
    && [ "$(grep -c '[^[:space:]]' "$WT/docs/agents/SMOKE.md" 2>/dev/null || echo 0)" = 1 ]; then
    SMOKE_OK=true
  fi
  [ "$SMOKE_OK" = true ] && echo "SMOKE PASS: $MODEL_ALIAS created exactly docs/agents/SMOKE.md (one line)" \
    || echo "SMOKE FAIL: see $LOG (files: ${FILES[*]:-none}, exit $EXIT)"
  [ "$SMOKE_OK" = true ] || OK=0
fi

# ---- workbench checks (best effort: never changes the exit behaviour of this script) ---------------------
CHECKS_JSON="" CHECKS_OK="" CHECKS_NOTE=""
if [ "$NO_CHECKS" = 0 ] && [ "$SMOKE" = 0 ] && [ ${#FILES[@]} -gt 0 ] && [ -x "$HERE/workbench.sh" ] && [ -d "$WT" ]; then
  CHECKS_JSON="${LOG%.log}.checks.json"
  log "workbench: checking $WT (json: $CHECKS_JSON)"
  { timeout --kill-after=30 960 "$HERE/workbench.sh" "$WT" --base "$BASE_REF" --json "$CHECKS_JSON" >&2; } 2>&1 || true
  if [ -s "$CHECKS_JSON" ]; then
    CHECKS_OK="$(python3 -c 'import json,sys; print("true" if json.load(open(sys.argv[1])).get("ok") else "false")' "$CHECKS_JSON" 2>/dev/null || true)"
    CHECKS_NOTE="$(python3 -c '
import json, sys
g = json.load(open(sys.argv[1])).get("groups", [])
bad = [x["name"] for x in g if x["status"] in ("fail", "timeout")]
print("checks=" + ("FAIL(" + ",".join(bad) + ")" if bad else "ok(%d)" % len(g)))' "$CHECKS_JSON" 2>/dev/null || true)"
  else
    CHECKS_JSON="" ; log "workbench produced no result (ignored)"
  fi
fi

DURATION=$((SECONDS - START))
RESULT="$(R_CHECKS_OK=$CHECKS_OK R_CHECKS=$CHECKS_JSON R_OK=$OK R_BRANCH=$BRANCH R_WT=$WT R_EXIT=$EXIT R_ALIAS=$MODEL_ALIAS R_MODEL=$MODEL_REF R_DUR=$DURATION \
  R_PUSHED=$PUSHED R_LOG=$LOG R_SMOKE=$SMOKE_OK R_FILES="$(printf '%s\n' ${FILES[@]+"${FILES[@]}"})" \
  R_RL=$RATE_LIMITED R_KEY=$((KEY_I + 1)) R_EVENTS="$(printf '%s\n' ${EVENTS[@]+"${EVENTS[@]}"})" \
  R_VIOL="$(printf '%s\n' ${VIOLATIONS[@]+"${VIOLATIONS[@]}"})" python3 - <<'PY'
import json, os
e = os.environ
files = [f for f in e["R_FILES"].split("\n") if f]
viol = [f for f in e["R_VIOL"].split("\n") if f]
r = {"ok": e["R_OK"] == "1", "branch": e["R_BRANCH"], "worktree": e["R_WT"], "files_changed": len(files),
     "files": files, "exit_code": int(e["R_EXIT"]), "model": e["R_MODEL"], "alias": e["R_ALIAS"],
     "duration_s": int(e["R_DUR"]), "pushed": e["R_PUSHED"] == "true", "violations": viol, "log": e["R_LOG"],
     "rate_limited": e["R_RL"] == "true", "groq_key_index": int(e["R_KEY"]),
     "events": [x for x in e["R_EVENTS"].split("\n") if x]}
if e["R_CHECKS_OK"]:
    r["checks_ok"] = e["R_CHECKS_OK"] == "true"
    r["checks"] = e["R_CHECKS"]
if e["R_SMOKE"]:
    r["smoke_ok"] = e["R_SMOKE"] == "true"
print(json.dumps(r))
PY
)"
rm -f "$CUR"
printf '%s\n' "$RESULT" >>"$STATE/logs/results.jsonl"

# only this run's own worktree/branch; a run that changed nothing leaves nothing behind
if [ "$CLEANUP" = 1 ] || { [ ${#FILES[@]} -eq 0 ] && [ ${#VIOLATIONS[@]} -eq 0 ]; }; then
  cd "$STATE"
  ag_git --git-dir="$BARE" worktree remove --force "$WT" >/dev/null 2>&1 || true
  if [ "$SMOKE" = 1 ] || [ ${#FILES[@]} -eq 0 ]; then
    ag_git --git-dir="$BARE" branch -D "$BRANCH" >/dev/null 2>&1 || true
  fi
fi
# Best effort: tell the owner's bot how the run ended (never changes the exit code).
if [ -f "$HERE/../../ops/notify/notify.py" ]; then
  python3 "$HERE/../../ops/notify/notify.py" \
    "ایجنت $SLUG: ok=$OK، ${#FILES[@]} فایل، ${DURATION}s${CHECKS_NOTE:+، $CHECKS_NOTE}" >/dev/null 2>&1 || true
fi
printf '%s\n' "$RESULT"
[ "$OK" = 1 ]
