#!/usr/bin/env bash
# Run on the Mac, from anywhere: merge the P0 PRs and bring srv1 back to a clean, deployable tree.
# Safe to stop at any failure: srv1's edits stay in branch srv1-snapshot-2026-10-30 and in a named stash.
# After a failure, restart deploys with: ssh roxira-prod systemctl start roxira-autodeploy.timer
set -euo pipefail

REPO=Mahan-film/roxira-platform
HOST=roxira-prod
ENV_FILE="$HOME/Secrets/roxira/roxira.env"

echo "== 1/6 pause deploys, set the JWT secret, copy cluster keys"
ssh "$HOST" 'set -e; systemctl stop roxira-autodeploy.timer; cd /opt/roxira_platform; cp -p .env /root/.env.bak.20261030
  grep -q "^SANDBOX_JWT_SECRET=" .env || printf "\nSANDBOX_JWT_SECRET=%s\n" "$(openssl rand -hex 32)" >> .env'
grep -E '^(ZILLIZ_(ENDPOINT|TOKEN)_[1-9]|QDRANT_CLOUD_(URL|API_KEY)_[2-9])=' "$ENV_FILE" | ssh "$HOST" \
  'cd /opt/roxira_platform; while IFS= read -r line; do grep -q "^${line%%=*}=" .env || printf "%s\n" "$line" >> .env; done'

echo "== 2/6 merge"
gh pr ready 884 --repo "$REPO" >/dev/null 2>&1 || true
gh pr ready 883 --repo "$REPO" >/dev/null 2>&1 || true
for pr in 885 884 871 883; do
  gh pr merge "$pr" --repo "$REPO" --squash --admin
  sleep 5
done

echo "== 3/6 clean srv1, keeping its edits in a stash"
ssh "$HOST" 'set -e; cd /opt/roxira_platform; git fetch -q origin main
  git diff --stat origin/main | tail -1
  git stash push -q -u -m srv1-pre-merge-2026-10-30
  test -z "$(git status --porcelain)" && echo clean'

echo "== 4/6 resume deploys"
ssh "$HOST" 'systemctl start roxira-autodeploy.timer; systemctl start --no-block roxira-autodeploy.service'

echo "== 5/6 wait for the deploy (up to 20 minutes)"
target="$(git ls-remote "https://github.com/$REPO" refs/heads/main 2>/dev/null | cut -c1-8)"
[ -n "$target" ] || target="$(gh api "repos/$REPO/commits/main" --jq .sha | cut -c1-8)"
for _ in $(seq 1 40); do
  head="$(ssh "$HOST" 'git -C /opt/roxira_platform rev-parse --short=8 HEAD')"
  [ "$head" = "$target" ] && ! ssh "$HOST" 'systemctl is-active -q roxira-autodeploy.service' && break
  sleep 30
done
echo "server at $head, main at $target"

echo "== 6/6 enable the daily cluster ping and report"
ssh "$HOST" 'cd /opt/roxira_platform/scripts/ops; install -m 0644 roxira-cluster-ping.service roxira-cluster-ping.timer /etc/systemd/system/
  systemctl daemon-reload; systemctl enable -q --now roxira-cluster-ping.timer; systemctl start roxira-cluster-ping.service
  journalctl -u roxira-cluster-ping --since "-2min" --no-pager -o cat | grep -E "^clusters:"
  docker exec roxira_enterprise_frontend sh -c "[ -n \"\$SANDBOX_JWT_SECRET\" ] && echo jwt-set || echo jwt-MISSING"
  for u in roxira.net roxira.ir ghazihoushmand.ir; do curl -s -o /dev/null -m 20 -w "$u %{http_code} %{time_total}s\n" "https://$u/"; done
  git -C /opt/roxira_platform status --short | wc -l'
