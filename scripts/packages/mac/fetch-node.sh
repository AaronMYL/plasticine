#!/bin/bash
# 给 Mac App 准备要带的 Node（docs/install-packages.md）：下载 nodejs.org 的 darwin-arm64 和 darwin-x64，按
# SHASUMS256.txt 核对，用 lipo 合成一个通用二进制（Apple 芯片和 Intel 的 Mac 都能跑）。只在 macOS 上跑（要 lipo）。
#   bash scripts/packages/mac/fetch-node.sh <版本，如 24.22.1> <输出文件>
set -euo pipefail

VERSION="${1:?用法：fetch-node.sh <版本> <输出文件>}"
OUT="${2:?用法：fetch-node.sh <版本> <输出文件>}"
MIRROR="${PLASTICINE_NODE_MIRROR:-https://nodejs.org/dist}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/plasticine-node.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL --retry 3 -o "$WORK/SHASUMS256.txt" "$MIRROR/v$VERSION/SHASUMS256.txt"
for arch in arm64 x64; do
  name="node-v$VERSION-darwin-$arch"
  curl -fsSL --retry 3 -o "$WORK/$name.tar.gz" "$MIRROR/v$VERSION/$name.tar.gz"
  want="$(grep " $name.tar.gz\$" "$WORK/SHASUMS256.txt" | cut -d ' ' -f 1)"
  have="$(shasum -a 256 "$WORK/$name.tar.gz" | cut -d ' ' -f 1)"
  if [[ -z "$want" || "$want" != "$have" ]]; then
    echo "$name.tar.gz 的 SHA-256 对不上" >&2
    exit 1
  fi
  tar -xzf "$WORK/$name.tar.gz" -C "$WORK" "$name/bin/node"
done
mkdir -p "$(dirname "$OUT")"
lipo -create -output "$OUT" "$WORK/node-v$VERSION-darwin-arm64/bin/node" "$WORK/node-v$VERSION-darwin-x64/bin/node"
chmod +x "$OUT"
lipo -info "$OUT"
"$OUT" -v
