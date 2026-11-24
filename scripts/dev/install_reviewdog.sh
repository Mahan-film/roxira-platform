#!/usr/bin/env bash
# Download the official reviewdog release archive (MIT CLI binary) for the pinned version,
# verify its SHA-256, extract it and print the binary path on stdout.
# Usage: REVIEWDOG=$(bash scripts/dev/install_reviewdog.sh [install-dir])
# Used by .github/workflows/ci.yml and local CI checks.
# To bump: change REVIEWDOG_VERSION and the three checksums together; take them from
# reviewdog_<version>_checksums.txt on the GitHub release page.
set -euo pipefail

REVIEWDOG_VERSION="0.21.3"
SHA_LINUX_X64="7029c2faf54e1237454cae8f1adf876c965b3d13d054f1a392206459091af4a1"
SHA_DARWIN_ARM64="c2a393e438e1d6dfe64e4a5ee103f1f1e839fff605f26686d6a7083770cd0afd"
SHA_DARWIN_X64="ca114007f4562062b4b54b422d8d2d21317b548ec64b7848e7e2aea52e490abd"

dir="${1:-${HOME}/.cache/roxira/reviewdog-${REVIEWDOG_VERSION}}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="reviewdog_${REVIEWDOG_VERSION}_Linux_x86_64.tar.gz"; want="$SHA_LINUX_X64" ;;
  Darwin-arm64) asset="reviewdog_${REVIEWDOG_VERSION}_Darwin_arm64.tar.gz"; want="$SHA_DARWIN_ARM64" ;;
  Darwin-x86_64) asset="reviewdog_${REVIEWDOG_VERSION}_Darwin_x86_64.tar.gz"; want="$SHA_DARWIN_X64" ;;
  *) echo "no pinned reviewdog checksum for $(uname -s)-$(uname -m); install reviewdog ${REVIEWDOG_VERSION} yourself" >&2; exit 2 ;;
esac

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

mkdir -p "$dir"
bin="$dir/reviewdog"
# The marker records the archive checksum that produced $bin.
if [ ! -x "$bin" ] || [ "$(cat "$dir/.sha256" 2>/dev/null)" != "$want" ]; then
  curl -sSfL --retry 5 --retry-all-errors --retry-delay 5 -o "$dir/$asset.tmp" \
    "https://github.com/reviewdog/reviewdog/releases/download/v${REVIEWDOG_VERSION}/${asset}"
  got="$(sha "$dir/$asset.tmp")"
  if [ "$got" != "$want" ]; then
    rm -f "$dir/$asset.tmp"
    echo "reviewdog checksum mismatch for $asset: expected $want, got $got" >&2
    exit 1
  fi
  tar -xzf "$dir/$asset.tmp" -C "$dir" reviewdog
  rm -f "$dir/$asset.tmp"
  chmod +x "$bin"
  printf '%s' "$want" > "$dir/.sha256"
fi
echo "reviewdog ${REVIEWDOG_VERSION} verified" >&2
echo "$bin"
