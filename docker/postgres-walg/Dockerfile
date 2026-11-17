# Postgres 17 + WAL-G, for continuous WAL archiving and base backups (row T204).
# PREPARED, NOT ENABLED. See docs/ops/WALG.md.
#
# Why built from source instead of the release binary: the production image is Alpine (musl), the official
# WAL-G release binaries are built for Ubuntu (glibc) and do not run on Alpine. Switching to a Debian
# postgres image is NOT an option: glibc and musl sort text differently, so the existing data directory's
# text indexes would be silently wrong.
#
# Supply chain: the source tarball of tag v3.0.9 is checked against a pinned SHA-256 and the tag's commit
# is recorded below; Go modules are verified by WAL-G's own go.sum.
#   release   : v3.0.9 (2026-08-20, Apache-2.0)
#   tag commit: 3e493188db28335fb93a45bd680c6ff8fc3028c1
#   tarball   : codeload.github.com/wal-g/wal-g/tar.gz/refs/tags/v3.0.9
#
# KEEP PG_IMAGE IDENTICAL to the postgres_prod image in docker-compose.prod.yml
# (scripts/ops/walg/test_walg.sh checks this).
ARG PG_IMAGE=postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
ARG GO_IMAGE=golang:1.25-alpine

FROM ${GO_IMAGE} AS build
ARG WALG_VERSION=v3.0.9
ARG WALG_SRC_SHA256=b06bc26c4865c07d0c269101910f63c7eedd03790b7c054a7da0980a7a9cc31d
ENV GOTOOLCHAIN=auto CGO_ENABLED=1
RUN apk add --no-cache build-base libsodium-dev curl
WORKDIR /src
RUN curl -fsSL -o walg.tgz "https://codeload.github.com/wal-g/wal-g/tar.gz/refs/tags/${WALG_VERSION}" \
 && echo "${WALG_SRC_SHA256}  walg.tgz" | sha256sum -c - \
 && tar -xzf walg.tgz --strip-components=1 \
 && rm walg.tgz
# libsodium tag = native WAL-G encryption (WALG_LIBSODIUM_KEY). No brotli/lzo: not needed (lz4/zstd are pure Go).
RUN cd main/pg && go build -tags libsodium -trimpath \
      -ldflags "-X github.com/wal-g/wal-g/cmd/pg.walgVersion=${WALG_VERSION#v}" \
      -o /out/wal-g . \
 && /out/wal-g --version

FROM ${PG_IMAGE}
RUN apk add --no-cache libsodium
COPY --from=build /out/wal-g /usr/local/bin/wal-g
COPY walg-archive.sh /usr/local/bin/walg-archive
RUN chmod 0755 /usr/local/bin/walg-archive /usr/local/bin/wal-g
