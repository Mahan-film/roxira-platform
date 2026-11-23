#!/usr/bin/env bash
# Download the official Trivy release binary (Apache-2.0) for the pinned version and verify
# its SHA-256 against Aqua Security's published release checksums.
# Prints the path of the verified binary on stdout (everything else goes to stderr).
# Usage: TRIVY=$(bash scripts/dev/install_trivy.sh [install-dir])
# Used by .github/workflows/ci.yml (trivy-fs job).
# Hardens against supply-chain compromises (e.g. GHSA-69fq-xp46-6x23).
# To bump: change TRIVY_VERSION and the SHA hashes together (trivy_${VERSION}_checksums.txt).
set -euo pipefail

TRIVY_VERSION="0.75.0"
SHA_LINUX_AMD64="c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f"
SHA_LINUX_ARM64="a1ee9f6ffb7d112b64ff726a2a0717c21175c1114361391f4a132956751a13b3"
SHA_DARWIN_ARM64="4a77108cccf8e55c8d6823e1e759939a622277e66cd0daa3c1fc621ed69e4568"
SHA_DARWIN_AMD64="291edaa9778acbe4693d067b5ad60ee11570e5ac68296e85595417528ca641e4"

dir="${1:-${HOME}/.cache/roxira/trivy-${TRIVY_VERSION}}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  asset="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"; want="$SHA_LINUX_AMD64" ;;
  Linux-aarch64) asset="trivy_${TRIVY_VERSION}_Linux-ARM64.tar.gz"; want="$SHA_LINUX_ARM64" ;;
  Darwin-arm64)  asset="trivy_${TRIVY_VERSION}_macOS-ARM64.tar.gz"; want="$SHA_DARWIN_ARM64" ;;
  Darwin-x86_64) asset="trivy_${TRIVY_VERSION}_macOS-64bit.tar.gz"; want="$SHA_DARWIN_AMD64" ;;
  *) echo "no pinned trivy checksum for $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

mkdir -p "$dir"
bin="$dir/trivy"
if [ ! -x "$bin" ]; then
  tarball="$dir/$asset"
  if [ ! -f "$tarball" ] || [ "$(sha "$tarball")" != "$want" ]; then
    curl -sSfL --retry 5 --retry-all-errors --retry-delay 5 -o "$tarball.tmp" \
      "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${asset}"
    got="$(sha "$tarball.tmp")"
    if [ "$got" != "$want" ]; then
      rm -f "$tarball.tmp"
      echo "trivy checksum mismatch for $asset: expected $want, got $got" >&2
      exit 1
    fi
    mv "$tarball.tmp" "$tarball"
  fi
  tar -xz -C "$dir" -f "$tarball" trivy
  chmod +x "$bin"
fi
echo "trivy ${TRIVY_VERSION} verified" >&2
echo "$bin"
