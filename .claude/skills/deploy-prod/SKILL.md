---
name: deploy-prod
description: Deploy merged main to the Roxira production server (`roxira-prod`, 91.107.248.99; old host 5.75.200.67 until decommission). Use when the owner asks to deploy, roll out, or apply a merged PR on the server.
disable-model-invocation: true
---

Follow `docs/STRATEGY.md` section 7 exactly. Show the owner which services will be recreated and get a clear yes before step 4.

1. `ssh roxira-prod`, `cd /opt/roxira_platform`, `git status` must be clean, then `git pull --ff-only origin main`.
2. `docker compose -f docker-compose.prod.yml config -q` must pass.
3. Dry import: `docker exec --env-file .env -w /app roxira_app_prod python3 -c "import run_unified_server"`. Compare the `LOAD-FAIL` list with the previous deploy; stop if it grew.
4. Recreate only changed services: `docker compose -f docker-compose.prod.yml up -d --no-deps <services>`. Never include `roxira_enterprise_frontend` (started with `docker run`).
5. Always `docker exec roxira_nginx_prod nginx -s reload`.
6. Verify `/health`, `POST /api/v1/apps/judge/payments/create-invoice` is not 404, a real chat on https://ghazihoushmand.ir, and from outside that only 22/80/443 answer. Report results to the owner in Persian.
