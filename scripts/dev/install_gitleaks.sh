#!/usr/bin/env bash
# Download the official gitleaks release archive (MIT CLI binary, NOT gitleaks-action) for the
# pinned version, verify its SHA-256, extract it and print the binary path on stdout.
# Usage: GITLEAKS=$(bash scripts/dev/install_gitleaks.sh [install-dir])
# Used by .github/workflows/ci.yml, scripts/dev/pre_push_gitleaks.sh and scripts/dev/local_ci.sh.
# To bump: change GITLEAKS_VERSION and the three checksums together; take them from
# gitleaks_<version>_checksums.txt on the release page (linux_x64, darwin_arm64, darwin_x64).
set -euo pipefail

GITLEAKS_VERSION="8.30.1"
SHA_LINUX_X64="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
SHA_DARWIN_ARM64="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
SHA_DARWIN_X64="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"

dir="${1:-${HOME}/.cache/roxira/gitleaks-${GITLEAKS_VERSION}}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"; want="$SHA_LINUX_X64" ;;
  Darwin-arm64) asset="gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz"; want="$SHA_DARWIN_ARM64" ;;
  Darwin-x86_64) asset="gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz"; want="$SHA_DARWIN_X64" ;;
  *) echo "no pinned gitleaks checksum for $(uname -s)-$(uname -m); install gitleaks ${GITLEAKS_VERSION} yourself" >&2; exit 2 ;;
esac

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

mkdir -p "$dir"
bin="$dir/gitleaks"
# The marker records the archive checksum that produced $bin.
if [ ! -x "$bin" ] || [ "$(cat "$dir/.sha256" 2>/dev/null)" != "$want" ]; then
  curl -sSfL --retry 5 --retry-all-errors --retry-delay 5 -o "$dir/$asset.tmp" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}"
  got="$(sha "$dir/$asset.tmp")"
  if [ "$got" != "$want" ]; then
    rm -f "$dir/$asset.tmp"
    echo "gitleaks checksum mismatch for $asset: expected $want, got $got" >&2
    exit 1
  fi
  tar -xzf "$dir/$asset.tmp" -C "$dir" gitleaks
  rm -f "$dir/$asset.tmp"
  chmod +x "$bin"
  printf '%s' "$want" > "$dir/.sha256"
fi
echo "gitleaks ${GITLEAKS_VERSION} verified" >&2
echo "$bin"
