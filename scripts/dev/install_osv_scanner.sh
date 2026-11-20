#!/usr/bin/env bash
# Download the official OSV-Scanner release binary (Apache-2.0) for the pinned version and verify
# its SHA-256. Prints the path of the verified binary on stdout (everything else goes to stderr).
# Usage: OSV=$(bash scripts/dev/install_osv_scanner.sh [install-dir])
# Used by .github/workflows/ci.yml (osv-scanner job).
# To bump: change OSV_VERSION and the checksums together (osv-scanner_SHA256SUMS on the release page).
set -euo pipefail

OSV_VERSION="2.7.1"
SHA_LINUX_AMD64="fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8"
SHA_DARWIN_ARM64="b22c02877a811c8f78956e8643efa554932b7378f590d13f8e97d4e9448a29f3"
SHA_DARWIN_AMD64="b8420d5485ba792626315f1bf9a5a2046e971d38eea75bf9090c38852dbc3b1b"

dir="${1:-${HOME}/.cache/roxira/osv-scanner-${OSV_VERSION}}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="osv-scanner_linux_amd64"; want="$SHA_LINUX_AMD64" ;;
  Darwin-arm64) asset="osv-scanner_darwin_arm64"; want="$SHA_DARWIN_ARM64" ;;
  Darwin-x86_64) asset="osv-scanner_darwin_amd64"; want="$SHA_DARWIN_AMD64" ;;
  *) echo "no pinned osv-scanner checksum for $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

mkdir -p "$dir"
bin="$dir/osv-scanner"
if [ ! -x "$bin" ] || [ "$(sha "$bin")" != "$want" ]; then
  curl -sSfL --retry 5 --retry-all-errors --retry-delay 5 -o "$bin.tmp" \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/${asset}"
  got="$(sha "$bin.tmp")"
  if [ "$got" != "$want" ]; then
    rm -f "$bin.tmp"
    echo "osv-scanner checksum mismatch for $asset: expected $want, got $got" >&2
    exit 1
  fi
  chmod +x "$bin.tmp"
  mv "$bin.tmp" "$bin"
fi
echo "osv-scanner ${OSV_VERSION} verified" >&2
echo "$bin"
