# Qdrant 1.19.0 → 1.20.2 Upgrade Runbook

Tracks #1388 (R36 digest #1387). Upgrades `qdrant_prod` in `docker-compose.prod.yml`
from `v1.19.0` to `v1.20.2` (rustls-webpki fix, BM25 text index).

## 1. Verified Image Digests

Verified with `docker buildx imagetools inspect qdrant/qdrant:v1.20.2` and `docker manifest inspect qdrant/qdrant:v1.20.2`:

| Artifact | Digest |
|---|---|
| `qdrant/qdrant:v1.20.2` (multi-arch OCI index) | `sha256:d277592721d2e3b73f9b797b53cf05e6a5bb2134f6d13fdbda4ca51782afbcac` |
| `linux/amd64` manifest | `sha256:c5e32ee251293d2e1f4dd34890ad75eeee5a4f3821a121d6d8b7e4323448b386` |
| `linux/arm64` manifest | `sha256:6903f528e2fa95782f950675e0f862b17f3c761e09f33a6322ce46e8e9951b99` |
| Previous `qdrant/qdrant:v1.19.0` (multi-arch index) | `sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc` |

## 2. Pre-Upgrade Snapshot (Mandatory)

Take a snapshot of every Qdrant collection before stopping `qdrant_prod`:

```bash
# List collections on the running v1.19.0 instance
curl -fsS http://127.0.0.1:6333/collections

# For each collection (e.g. roxira_legal_v3):
COLL="roxira_legal_v3"
SNAP=$(curl -fsS -X POST "http://127.0.0.1:6333/collections/${COLL}/snapshots" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["name"])')
curl -fsS "http://127.0.0.1:6333/collections/${COLL}/snapshots/${SNAP}" -o "/root/deploy-state/qdrant-${COLL}-${SNAP}"
```

Also record the volume backup or filesystem snapshot if available.

## 3. Stop / Start Order

Run during an owner-approved maintenance window (after the `docker-compose.prod.yml` PR is merged with owner approval):

```bash
cd /opt/roxira_platform
docker compose -f docker-compose.prod.yml pull qdrant_prod
docker compose -f docker-compose.prod.yml stop enterprise_app
docker compose -f docker-compose.prod.yml up -d qdrant_prod
# Wait until qdrant_prod is healthy:
docker inspect --format '{{.State.Health.Status}}' roxira_qdrant_prod
curl -fsS http://127.0.0.1:6333/collections
docker compose -f docker-compose.prod.yml up -d enterprise_app
```

## 4. Rollback to `v1.19.0`

If `qdrant_prod` fails healthcheck, collections fail to load, or search regresses:

1. Revert `docker-compose.prod.yml` line for `qdrant_prod` to the previous pinned digest:
   `qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`
2. Recreate `qdrant_prod`:
   ```bash
   docker compose -f docker-compose.prod.yml stop enterprise_app
   docker compose -f docker-compose.prod.yml up -d qdrant_prod
   ```
3. If the on-disk storage format was touched and `v1.19.0` cannot open it, restore the pre-upgrade `.snapshot` files via `POST /collections/<coll>/snapshots/upload` into a clean `qdrant_data` volume, then start `enterprise_app`.

## 5. Local Snapshot Restore & Search Verification

Verified locally with Docker on `127.0.0.1:16333` (non-reserved port):
1. Started `qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`, created collection `upgrade_test` (4-dim Cosine), upserted 2 points, took snapshot via `POST /collections/upgrade_test/snapshots`, downloaded `.snapshot`.
2. Stopped `v1.19.0`, started `qdrant/qdrant:v1.20.2@sha256:d277592721d2e3b73f9b797b53cf05e6a5bb2134f6d13fdbda4ca51782afbcac` with a fresh storage directory.
3. Restored snapshot via `POST /collections/upgrade_test/snapshots/upload?wait=true` and ran `POST /collections/upgrade_test/points/search`; verified top hit `id=1` with expected payload and score.
