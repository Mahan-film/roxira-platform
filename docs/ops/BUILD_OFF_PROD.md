# Off-Prod Image Builds (`roxira-ci` -> `registry:2` -> Prod)

> Status: **Design only** (zero production changes).

## 1. Problem & Goal

Production runs on a 7.7 GB RAM host where running `docker compose build` (Node/Next.js + Python/pip) competes with live containers for memory and disk. Moving image builds to `roxira-ci` and serving them over a private-network `registry:2` eliminates build-time CPU/RAM/disk spikes on prod while keeping deploys fast and deterministic.

## 2. Target Architecture

1. **Build on `roxira-ci`:**
   - After `main` is updated, `roxira-ci` builds `enterprise_hub` (backend), `frontend`, and `smartjudge` (`ai_core`) images using its local BuildKit cache.
   - Images are tagged with both `<git-sha>` and `latest` under the private registry prefix (e.g., `<private-registry-ip>:5000/roxira/<service>:<sha>`).
2. **Private `registry:2`:**
   - Runs `registry:2` bound strictly to the private WireGuard/LAN interface (never exposed to the public internet).
   - Garbage-collection cron (`registry garbage-collect`) runs weekly to prune untagged layers while retaining the last N release tags.
3. **Pull & `:prev` Retag on Prod:**
   - Before pulling, `deploy.sh` retags the currently running `:latest` images to `:prev` (preserving the existing `:prev` rollback contract used by `rollback.sh`).
   - Prod runs `docker compose pull` for the new `<git-sha>` / `latest` tags, `docker compose up -d`, and executes the existing smoke check; on failure, `rollback.sh` restores `:prev`.

## 3. Comparison: Kamal (`MIT`) vs Plain Docker Compose Pull

| Criterion | Kamal (`MIT`) | Plain Docker Compose Pull |
|---|---|---|
| **Runtime / Tooling** | Requires Ruby + `kamal` CLI + `kamal-proxy` | Uses existing `docker compose` + `nginx` |
| **Migration Effort** | High: replaces `docker-compose.yml`, `nginx`, `deploy.sh`, `rollback.sh` | Low: swap `build` for `pull` in `deploy.sh` |
| **Rollback (`:prev`)** | Uses `kamal rollback <version>` (container-label based) | Preserves existing `:prev` image tag contract |
| **Failure Surface** | New proxy + SSH orchestration layer | Minimal; keeps battle-tested autodeploy + smoke |

**Recommendation:** **Plain Docker Compose pull** from private `registry:2`. It requires zero new runtime dependencies, preserves our `:prev` rollback tags and `nginx` gateway, and can be adopted incrementally without touching `kamal-proxy`.

## 4. Next Steps (When Scheduled)

- Provision `registry:2` on `roxira-ci` (private interface only, basic auth).
- Add `CI` build-and-push job on `main` push.
- Update `deploy.sh` (with owner approval) to retag `:prev` and `docker compose pull`.
