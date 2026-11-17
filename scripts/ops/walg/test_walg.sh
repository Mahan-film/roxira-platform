#!/usr/bin/env bash
# Offline checks for the WAL-G files (row T204). No docker, no network, no secrets. Run: bash scripts/ops/walg/test_walg.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. The WAL-G image must be built on the very same postgres image as production.
prod="$(grep -E '^\s+image: postgres:17-alpine@sha256:' docker-compose.prod.yml | head -1 | sed 's/.*image: //')"
walg="$(grep -E '^ARG PG_IMAGE=' docker/postgres-walg/Dockerfile | sed 's/ARG PG_IMAGE=//')"
[ -n "$prod" ] && [ "$prod" = "$walg" ] || fail "PG_IMAGE in docker/postgres-walg/Dockerfile differs from docker-compose.prod.yml ($walg vs $prod)"

# 2. The pinned source hash is the documented one and the build verifies it.
grep -q 'sha256sum -c' docker/postgres-walg/Dockerfile || fail "Dockerfile does not verify the WAL-G tarball hash"
grep -Eq 'WALG_SRC_SHA256=[0-9a-f]{64}' docker/postgres-walg/Dockerfile || fail "no 64-hex WALG_SRC_SHA256 pin"

# 3. archive_timeout and archive_mode are set in the overlay; the overlay is not merged into prod.
grep -q 'archive_timeout=60' docker-compose.walg.yml || fail "archive_timeout=60 missing"
grep -q 'archive_mode=on' docker-compose.walg.yml || fail "archive_mode=on missing"
grep -q 'walg' docker-compose.prod.yml && fail "docker-compose.prod.yml must not reference WAL-G until enabled"

# 4. The env example holds names only.
if grep -Eq '^(AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|WALG_LIBSODIUM_KEY)=.+' deploy/backup/walg.env.example; then
  fail "walg.env.example must not contain values for secret names"
fi

# 5. Dry runs work without docker or an env file.
export DRY_RUN=1 WALG_ENV_FILE=/nonexistent
bash scripts/ops/walg/walg_status.sh --dry-run >/dev/null 2>&1 || fail "walg_status.sh --dry-run"
bash scripts/ops/walg/walg_nightly.sh --dry-run >/dev/null 2>&1 || fail "walg_nightly.sh --dry-run"
out="$(bash scripts/ops/walg/restore_to_time.sh --dry-run --target-time '2026-11-17 09:30:00+00' 2>&1)" || fail "restore dry-run"
echo "$out" | grep -q "recovery_target_time = '2026-11-17 09:30:00+00'" || fail "restore dry-run lacks the target time"
echo "$out" | grep -q "archive_mode = off" || fail "restore must disable archiving"
bash scripts/ops/walg/restore_to_time.sh --dry-run --target-time "x'; drop" >/dev/null 2>&1 && fail "bad target time accepted"
bash scripts/ops/walg/restore_to_time.sh --dry-run --latest --port 5432 >/dev/null 2>&1 && fail "reserved port accepted"

# 6. Archive wrapper: over the cap in drop mode it exits 0 and flags the broken chain; wal-g is never called.
tmp="$(mktemp -d "${TMPDIR:-/tmp}/walgtest.XXXXXX")"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/data/pg_wal" "$tmp/state" "$tmp/bin"
dd if=/dev/zero of="$tmp/data/pg_wal/seg" bs=1048576 count=3 2>/dev/null
printf '#!/bin/sh\necho CALLED >"%s/called"\nexit 1\n' "$tmp" >"$tmp/bin/wal-g"; chmod +x "$tmp/bin/wal-g"
PATH="$tmp/bin:$PATH" PGDATA="$tmp/data" WALG_STATE_DIR="$tmp/state" WALG_SPOOL_MAX_MB=2 \
  sh docker/postgres-walg/walg-archive.sh /x/000000010000000000000001 2>/dev/null || fail "drop mode must exit 0"
[ -s "$tmp/state/CHAIN_BROKEN" ] && [ -e "$tmp/state/SPOOL_OVER" ] || fail "overflow flags not written"
[ ! -e "$tmp/called" ] || fail "wal-g called although over the cap"
# fail mode: still tries to push; a failing wal-g makes the wrapper fail
if PATH="$tmp/bin:$PATH" PGDATA="$tmp/data" WALG_STATE_DIR="$tmp/state" WALG_SPOOL_MAX_MB=2 WALG_SPOOL_ON_OVERFLOW=fail \
  sh docker/postgres-walg/walg-archive.sh /x/000000010000000000000002 2>/dev/null; then fail "fail mode must exit non-zero when wal-g fails"; fi
echo "walg tests passed"
