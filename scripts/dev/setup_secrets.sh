#!/usr/bin/env bash
# Create ~/Secrets/roxira/roxira.env (empty KEY= placeholders, names only) and a
# load_secrets.sh helper. Prints no values. Refuses to run inside the repo checkout so
# secrets can never land in the repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
CWD="$(pwd -P)"
case "$CWD/" in
  "$REPO_ROOT"/*)
    echo "Refusing to run inside the repo ($REPO_ROOT). cd elsewhere (e.g. cd ~) and re-run." >&2
    exit 1
    ;;
esac

DEST_DIR="${ROXIRA_SECRETS_DIR:-$HOME/Secrets/roxira}"
case "$DEST_DIR/" in
  "$REPO_ROOT"/*) echo "Refusing: destination is inside the repo." >&2; exit 1 ;;
esac
ENV_FILE="$DEST_DIR/roxira.env"
LOADER="$DEST_DIR/load_secrets.sh"

umask 077
mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"

# Names only: KEY from .env.example lines and ${KEY...} references in the compose file.
names() {
  {
    if [ -f "$REPO_ROOT/.env.example" ]; then
      sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Z][A-Z0-9_]*)=.*/\2/p' "$REPO_ROOT/.env.example"
    fi
    if [ -f "$REPO_ROOT/docker-compose.prod.yml" ]; then
      grep -oE '\$\{[A-Z][A-Z0-9_]*' "$REPO_ROOT/docker-compose.prod.yml" | sed 's/^\${//' || true
    fi
  } | sort -u
}

if [ -e "$ENV_FILE" ]; then
  # Never overwrite existing values; only append names that are missing.
  added=0
  while IFS= read -r n; do
    if ! grep -Eq "^${n}=" "$ENV_FILE"; then
      printf '%s=\n' "$n" >> "$ENV_FILE"
      added=$((added + 1))
    fi
  done < <(names)
  echo "Existing $ENV_FILE kept; appended $added missing placeholder name(s)."
else
  {
    echo "# Roxira secrets. Fill values here, never in the repo. chmod 600."
    names | sed 's/$/=/'
  } > "$ENV_FILE"
  echo "Created $ENV_FILE with $(grep -c '=' "$ENV_FILE") empty placeholder(s)."
fi
chmod 600 "$ENV_FILE"

cat > "$LOADER" <<'LOADER_EOF'
#!/usr/bin/env bash
# Usage: source ~/Secrets/roxira/load_secrets.sh   (exports vars; prints no values)
_roxira_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)"
set -a
# shellcheck disable=SC1091
. "$_roxira_dir/roxira.env"
set +a
unset _roxira_dir
LOADER_EOF
chmod 600 "$LOADER"

echo "Next: edit $ENV_FILE, then in a shell run: source $LOADER"
