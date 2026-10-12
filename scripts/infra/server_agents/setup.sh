#!/usr/bin/env bash
# Owner-run, once, ON THE SERVER (or: ssh -t 5.75.200.67 /opt/roxira_platform/scripts/infra/server_agents/setup.sh).
# Prepares the low-cost server-side agent runner (docs/ops/SERVER_AGENTS.md). Idempotent; --dry-run changes nothing.
#
#   setup.sh [--dry-run] [--skip-keys] [--replace-keys] [--no-clone] [--no-verify]
#            [--repo-dir DIR] [--agent-user NAME]
#
# What it does (each step is skipped when already in place):
#   1  system user "roxira-agent" (no login, no ssh keys, cannot read the server .env)
#   2  /etc/roxira (0700) and /var/lib/roxira-agents/{worktrees,home,xdg,logs}
#   3  bare clone /var/lib/roxira-agents/repo.git of the repo's origin (agents never touch /opt/roxira_platform)
#   4  renders /etc/roxira/opencode-agents.json + /etc/roxira/agent-aliases.tsv from config/models.yaml
#      (role agent_runner / agent_runner_public). The global /root/.config/opencode is NOT touched or read.
#   5  Groq keys (GROQ_API_KEY, _2, _3) are read from the server .env where set_server_env.sh put them: setup only
#      counts them (names/lengths). Optional hidden prompt for OPENROUTER_API_KEY_AGENTS -> /etc/roxira/agents.env (0600)
#   6  read-only checks: Groq model ids exist, OpenRouter ids are in the catalogue, agent user cannot read .env
#
# Env overrides (tests): ROXIRA_ETC_DIR, ROXIRA_AGENTS_HOME. Never prints a secret value.
set -euo pipefail

DRY_RUN=0 SKIP_KEYS=0 REPLACE_KEYS=0 NO_CLONE=0 NO_VERIFY=0
REPO_DIR="${DEPLOY_REMOTE_DIR:-/opt/roxira_platform}"
AGENT_USER="${ROXIRA_AGENT_USER-roxira-agent}"
ETC_DIR="${ROXIRA_ETC_DIR:-/etc/roxira}"
STATE="${ROXIRA_AGENTS_HOME:-/var/lib/roxira-agents}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_REPO="$(cd "$SELF_DIR/../../.." && pwd)"

log() { printf '[agents-setup] %s\n' "$*"; }
warn() { printf '[agents-setup] WARNING: %s\n' "$*" >&2; }
die() { printf '[agents-setup] ERROR: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY_RUN" = 1 ]; then log "[dry-run] $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-keys) SKIP_KEYS=1 ;;
    --replace-keys) REPLACE_KEYS=1 ;;
    --no-clone) NO_CLONE=1 ;;
    --no-verify) NO_VERIFY=1 ;;
    --repo-dir) REPO_DIR="${2:?--repo-dir needs a path}"; shift ;;
    --agent-user) AGENT_USER="${2?--agent-user needs a name}"; shift ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" != 0 ] && [ "${ROXIRA_AGENTS_ALLOW_NONROOT:-0}" != 1 ]; then die "run as root (or use --dry-run)"; fi
command -v git >/dev/null || die "git is required"
command -v python3 >/dev/null || die "python3 is required"
command -v "${OPENCODE_BIN:-opencode}" >/dev/null || warn "opencode not found in PATH (expected /usr/bin/opencode)"

CONFIG="$ETC_DIR/opencode-agents.json"
ENV_FILE="$ETC_DIR/agents.env"
MODELS_YAML="$REPO_DIR/config/models.yaml"
[ -f "$MODELS_YAML" ] || MODELS_YAML="$SRC_REPO/config/models.yaml"
log "state=$STATE etc=$ETC_DIR repo=$REPO_DIR agent_user=${AGENT_USER:-<current user>} dry_run=$DRY_RUN"

# ------------------------------------------------------------ 1 user
log "== 1/6 agent user"
if [ -z "$AGENT_USER" ]; then
  log "no agent user (running agents as the current user; tests only)"
elif id "$AGENT_USER" >/dev/null 2>&1; then
  log "user $AGENT_USER exists"
else
  run useradd --system --home-dir "$STATE/home" --no-create-home --shell /usr/sbin/nologin "$AGENT_USER"
fi

# ------------------------------------------------------------ 2 dirs
log "== 2/6 directories"
run install -d -m 0700 "$ETC_DIR"
run install -d -m 0755 "$STATE"
OWN=()
[ -n "$AGENT_USER" ] && { [ "$DRY_RUN" = 1 ] || id "$AGENT_USER" >/dev/null 2>&1; } && OWN=(-o "$AGENT_USER")
for d in worktrees home xdg/config xdg/data xdg/cache xdg/state; do
  run install -d -m 0700 ${OWN[@]+"${OWN[@]}"} "$STATE/$d"
done
run install -d -m 0755 "$STATE/logs"

# ------------------------------------------------------------ 3 bare clone
log "== 3/6 isolated bare clone"
BARE="$STATE/repo.git"
if [ "$NO_CLONE" = 1 ]; then
  log "skipped (--no-clone)"
else
  ORIGIN_URL="${ROXIRA_AGENTS_ORIGIN:-$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)}"
  [ -n "$ORIGIN_URL" ] || die "cannot read origin URL from $REPO_DIR (set ROXIRA_AGENTS_ORIGIN)"
  if [ -d "$BARE" ]; then
    log "$BARE exists; fetching main"
  else
    run git clone --bare "$ORIGIN_URL" "$BARE"
  fi
  run git --git-dir="$BARE" config remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
  run git --git-dir="$BARE" fetch --quiet origin
  [ -z "$AGENT_USER" ] || run chown -R "$AGENT_USER" "$BARE"
fi

# ------------------------------------------------------------ 4 render config
log "== 4/6 render $CONFIG"
RENDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agents-setup.XXXXXX")"
trap 'rm -rf "$RENDER_DIR"' EXIT
python3 - "$MODELS_YAML" "$RENDER_DIR" <<'PY'
import json, sys
yaml_path, out = sys.argv[1], sys.argv[2]
# Built-in defaults mirror config/models.yaml roles agent_runner / agent_runner_public.
entries = [
    {"id": "openai/gpt-oss-120b", "alias": "groq-strong", "provider": "groq", "public": False},
    {"id": "openai/gpt-oss-20b", "alias": "groq-fast", "provider": "groq", "public": False},
    {"id": "deepseek/deepseek-v4.1-flash", "alias": "ds-flash", "provider": "openrouter", "public": False},
    {"id": "qwen/qwen3.8-27b:free", "alias": "free-public", "provider": "openrouter", "public": True},
]
src = "built-in defaults"
try:
    import yaml  # PyYAML is optional on the server
    roles = yaml.safe_load(open(yaml_path, encoding="utf-8"))["roles"]
    got = []
    for role, public in (("agent_runner", False), ("agent_runner_public", True)):
        for e in roles[role]["models"]:
            got.append({"id": e["id"], "alias": e["alias"], "provider": e["provider"],
                        "public": public or bool(e.get("public_code_only"))})
    entries, src = got, yaml_path
except Exception as exc:  # noqa: BLE001
    print(f"[agents-setup] note: using built-in model list ({type(exc).__name__})", file=sys.stderr)

providers = {
    "groq": {
        # OpenCode's built-in Groq provider (bundled SDK: no npm install at run time); models are listed
        # explicitly so the run does not depend on the models.dev catalogue being reachable.
        "options": {"apiKey": "{env:GROQ_API_KEY}"},
        "models": {},
    },
    "openrouter": {
        "options": {"apiKey": "{env:OPENROUTER_API_KEY_AGENTS}"},
        "models": {},
    },
}
for e in entries:
    name = e["id"] + (" (PUBLIC CODE ONLY)" if e["public"] else "")
    model = {"name": name}
    if e["provider"] == "groq":
        model["limit"] = {"context": 131072, "output": 32768}
    providers[e["provider"]]["models"][e["id"]] = model
cfg = {
    "$schema": "https://opencode.ai/config.json",
    "//": "Rendered by scripts/infra/server_agents/setup.sh from " + src + ". Do not edit by hand; re-run setup.sh. Keys come only from the environment ({env:NAME}). run_task.sh layers a per-task permission block on top via OPENCODE_CONFIG_CONTENT.",
    "enabled_providers": ["groq", "openrouter"],
    "autoupdate": False,
    "share": "disabled",
    "snapshot": False,
    "lsp": False,
    "provider": providers,
}
json.dump(cfg, open(out + "/opencode-agents.json", "w"), indent=2)
open(out + "/opencode-agents.json", "a").write("\n")
with open(out + "/agent-aliases.tsv", "w") as fh:
    fh.write("# alias<TAB>provider/model<TAB>public_only(0|1)<TAB>key env var\n")
    for e in entries:
        keyvar = "GROQ_API_KEY" if e["provider"] == "groq" else "OPENROUTER_API_KEY_AGENTS"
        fh.write(f'{e["alias"]}\t{e["provider"]}/{e["id"]}\t{1 if e["public"] else 0}\t{keyvar}\n')
PY
for f in opencode-agents.json agent-aliases.tsv; do
  if [ -f "$ETC_DIR/$f" ] && cmp -s "$RENDER_DIR/$f" "$ETC_DIR/$f"; then
    log "$f unchanged"
  else
    run install -m 0644 "$RENDER_DIR/$f" "$ETC_DIR/$f"
  fi
done

# ------------------------------------------------------------ 5 keys
log "== 5/6 keys"
REPO_ENV="${ROXIRA_REPO_ENV:-$REPO_DIR/.env}"
env_len() { # file name -> length of the stored value (0 when absent); never prints the value
  [ -f "$1" ] || { echo 0; return; }
  grep -E "^$2=" "$1" | head -n1 | cut -d= -f2- | awk '{print length($0)}' | grep . || echo 0
}
set_kv() { # name value ; atomic, keeps mode 0600
  local tmp
  tmp="$(umask 077; mktemp "$ETC_DIR/.agents.env.XXXXXX")"
  { [ -f "$ENV_FILE" ] && grep -v "^$1=" "$ENV_FILE" || true; printf '%s=%s\n' "$1" "$2"; } >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
# Groq: the owner stores GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 in the server .env beforehand with
# scripts/ops/set_server_env.sh; run_task.sh reads them from there (names only). No prompt, nothing is copied.
gcount=0
for k in GROQ_API_KEY GROQ_API_KEY_2 GROQ_API_KEY_3; do
  if [ "$(env_len "$REPO_ENV" "$k")" != 0 ]; then gcount=$((gcount + 1)); log "$k present in $REPO_ENV"; fi
done
if [ "$gcount" = 0 ]; then
  warn "no GROQ_API_KEY in $REPO_ENV yet: from your Mac run  scripts/ops/set_server_env.sh GROQ_API_KEY  (then _2, _3)"
else
  log "$gcount Groq key(s) found. Failover is auth-error only (401/403); 429 backs off, then falls back to ds-flash."
fi
# OpenRouter for agents: optional, separate key with a spend limit (NOT the prod key). Hidden prompt, stored here.
ask_or_key() {
  local name=OPENROUTER_API_KEY_AGENTS val="" have
  have="$(env_len "$ENV_FILE" "$name")"
  if [ "$have" != 0 ] && [ "$REPLACE_KEYS" != 1 ]; then log "$name already set (length $have); --replace-keys to overwrite"; return; fi
  if [ "$DRY_RUN" = 1 ]; then log "[dry-run] would ask for $name (hidden, optional)"; return; fi
  if [ -n "${!name:-}" ]; then val="${!name}"; log "$name taken from the environment"
  elif (: </dev/tty) 2>/dev/null; then
    printf '%s (hidden, optional, Enter alone = skip; use a SEPARATE key with a spend limit): ' "$name" >/dev/tty
    IFS= read -rs val </dev/tty; printf '\n' >/dev/tty
  else warn "no terminal for the hidden prompt (ssh -t HOST ...); skipped $name"; return; fi
  if [ -z "$val" ]; then log "$name skipped: ds-flash / free-public / 429 fallback stay unavailable"; return; fi
  case "$val" in *$'\n'* | *$'\r'* | *' '*) warn "$name must be one token without spaces: not saved"; return ;; esac
  set_kv "$name" "$val"; log "$name saved (length ${#val})"
}
if [ "$SKIP_KEYS" = 1 ]; then
  log "OpenRouter prompt skipped (--skip-keys)"
else
  [ "$DRY_RUN" = 1 ] || { [ -f "$ENV_FILE" ] || install -m 0600 /dev/null "$ENV_FILE"; }
  ask_or_key
fi

# ------------------------------------------------------------ 6 read-only checks
log "== 6/6 read-only checks"
if [ "$NO_VERIFY" = 1 ] || [ "$DRY_RUN" = 1 ]; then
  log "skipped (dry-run or --no-verify)"
else
  gkey="$(grep -E '^GROQ_API_KEY=' "$REPO_ENV" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  if [ -n "$gkey" ] && command -v curl >/dev/null; then
    # key goes through curl's config on stdin, never argv
    ids="$(printf 'header = "Authorization: Bearer %s"\n' "$gkey" |
      curl -fsS --max-time 20 -K - https://api.groq.com/openai/v1/models 2>/dev/null |
      python3 -c 'import json,sys; print(" ".join(m["id"] for m in json.load(sys.stdin)["data"]))' 2>/dev/null || true)"
    if [ -z "$ids" ]; then
      warn "could not list Groq models (bad key, no network, or Groq blocks this IP)"
    else
      while IFS=$'\t' read -r alias model _ _; do
        case "$alias" in '#'* | '') continue ;; esac
        case "$model" in groq/*) case " $ids " in *" ${model#groq/} "*) log "Groq ok: $alias -> ${model#groq/}" ;; *) warn "Groq does NOT list ${model#groq/} (alias $alias): fix config/models.yaml agent_runner and re-run" ;; esac ;; esac
      done <"$ETC_DIR/agent-aliases.tsv"
    fi
  fi
  if [ -n "$AGENT_USER" ] && id "$AGENT_USER" >/dev/null 2>&1 && command -v runuser >/dev/null; then
    for p in "$REPO_ENV" "$ETC_DIR/agents.env" /root/.ssh/id_ed25519; do
      if [ -e "$p" ] && runuser -u "$AGENT_USER" -- test -r "$p" 2>/dev/null; then
        warn "$AGENT_USER CAN read $p -- tighten its mode (chmod 600, owner root)"
      fi
    done
    log "isolation check done"
  fi
fi

log "done. Next (verification): $SELF_DIR/run_task.sh --smoke"
