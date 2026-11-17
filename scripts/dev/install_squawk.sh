#!/usr/bin/env bash
# Download the official Squawk release binary for the pinned version and verify its SHA-256.
# Prints the path of the verified binary on stdout (everything else goes to stderr).
# Usage: SQUAWK=$(bash scripts/dev/install_squawk.sh [install-dir])
# Used by .github/workflows/ci.yml (migration-lint) and scripts/dev/local_ci.sh.
# To bump: change SQUAWK_VERSION and the three checksums together
# (shasum -a 256 of the release assets squawk-linux-x64, squawk-darwin-arm64, squawk-darwin-x64).
set -euo pipefail

SQUAWK_VERSION="2.73.0"
SHA_LINUX_X64="9ae3747ca5eafa48b4d5c535fc64b61e0735a763164193644aa6436cc97c4274"
SHA_DARWIN_ARM64="1806b8d16204606c35e6496b3727f76cf13a4d0665439ea5df1dcca579954551"
SHA_DARWIN_X64="e3c99b11a221d714241f3a9edfc844743ab2e098d833e2145b20d06d083c9954"

dir="${1:-${HOME}/.cache/roxira/squawk-${SQUAWK_VERSION}}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="squawk-linux-x64"; want="$SHA_LINUX_X64" ;;
  Darwin-arm64) asset="squawk-darwin-arm64"; want="$SHA_DARWIN_ARM64" ;;
  Darwin-x86_64) asset="squawk-darwin-x64"; want="$SHA_DARWIN_X64" ;;
  *) echo "no pinned Squawk checksum for $(uname -s)-$(uname -m); set \$SQUAWK instead" >&2; exit 2 ;;
esac

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

mkdir -p "$dir"
bin="$dir/squawk"
if [ ! -x "$bin" ] || [ "$(sha "$bin")" != "$want" ]; then
  curl -sSfL --retry 5 --retry-all-errors --retry-delay 5 -o "$bin.tmp" \
    "https://github.com/sbdchd/squawk/releases/download/v${SQUAWK_VERSION}/${asset}"
  got="$(sha "$bin.tmp")"
  if [ "$got" != "$want" ]; then
    rm -f "$bin.tmp"
    echo "Squawk checksum mismatch for $asset: expected $want, got $got" >&2
    exit 1
  fi
  chmod +x "$bin.tmp"
  mv "$bin.tmp" "$bin"
fi
echo "squawk ${SQUAWK_VERSION} verified" >&2
echo "$bin"
