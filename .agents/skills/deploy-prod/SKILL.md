---
name: deploy-prod
description: Deploy merged main to the Roxira production server. Use only when the owner asks to deploy, roll out or apply a merged PR on the server. Never start it on your own.
---

**Ask the owner before any production restart or file change, and wait for a clear yes in the current chat.** A yes from an earlier session does not count.

Follow `docs/STRATEGY.md` section 7 exactly. The host alias and the repo path on the server are in `CLAUDE.md`.

1. On the server: `git status` must be clean, then `git pull --ff-only origin main`.
2. `docker compose -f docker-compose.prod.yml config -q` must pass.
3. Run the dry import from `docs/STRATEGY.md` §7. Stop if the `LOAD-FAIL` list grew since the last deploy.
4. Show the owner which services will be recreated. After their yes, recreate only those services with `--no-deps`.
5. Reload nginx, then run the checks in `docs/STRATEGY.md` §7 and report the results to the owner.
