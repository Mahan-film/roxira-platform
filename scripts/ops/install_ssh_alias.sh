#!/usr/bin/env bash
# Append the roxira-prod / roxira-old blocks from ssh_config.example to ~/.ssh/config
# if the alias is not already present. Dry-run by default; pass --apply to write.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE="$HERE/ssh_config.example"
CONF="${SSH_CONFIG_FILE:-$HOME/.ssh/config}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Print the stanza for one Host alias from the example file.
block() { awk -v h="$1" '$1=="Host"{p=($2==h)} p' "$EXAMPLE"; }

for alias in roxira-prod roxira-old; do
  if [ -f "$CONF" ] && grep -Eq "^[[:space:]]*Host[[:space:]]+(.*[[:space:]])?${alias}([[:space:]]|$)" "$CONF"; then
    echo "skip   $alias (already in $CONF)"
    continue
  fi
  if [ "$APPLY" = 1 ]; then
    mkdir -p "$(dirname "$CONF")"; chmod 700 "$(dirname "$CONF")" 2>/dev/null || true
    { [ -s "$CONF" ] && echo; block "$alias"; } >> "$CONF"
    chmod 600 "$CONF"
    echo "added  $alias -> $CONF"
  else
    echo "would add $alias to $CONF:"; block "$alias" | sed 's/^/    /'
  fi
done
[ "$APPLY" = 1 ] || echo "(dry-run; re-run with --apply to write)"
