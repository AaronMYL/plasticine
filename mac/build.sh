#!/bin/bash
set -euo pipefail

PLASTICINE_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLASTICINE_INSTALL=false
# 安装包（docs/install-packages.md）：--server 给服务包（scripts/packages/build-server.ts 出的 tar.gz），--node 给
# Node 可执行文件（scripts/packages/mac/fetch-node.sh 出的通用二进制），App 就自带服务、能选「这台 Mac」。
# 两个都不给就和以前一样，只能连远程服务器。
PLASTICINE_SERVER=""
PLASTICINE_NODE=""
usage() {
  echo '用法：bash build.sh [--install] [--server <服务包.tar.gz> --node <node 可执行文件>]' >&2
  exit 2
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) PLASTICINE_INSTALL=true; shift ;;
    --server) [[ $# -ge 2 ]] || usage; PLASTICINE_SERVER="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --node) [[ $# -ge 2 ]] || usage; PLASTICINE_NODE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    *) usage ;;
  esac
done
if [[ -n "$PLASTICINE_SERVER" && -z "$PLASTICINE_NODE" ]] || [[ -z "$PLASTICINE_SERVER" && -n "$PLASTICINE_NODE" ]]; then
  echo '--server 和 --node 要一起给。' >&2
  exit 2
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo '请在 macOS 14 或更新版本上构建。' >&2
  exit 1
fi

cd "$PLASTICINE_ROOT"
swift build -c release
PLASTICINE_BIN="$(swift build -c release --show-bin-path)"
PLASTICINE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/plasticine-build.XXXXXX")"
trap 'rm -rf "$PLASTICINE_TMP"' EXIT
PLASTICINE_APP="$PLASTICINE_ROOT/build/Plasticine.app"
mkdir -p "$PLASTICINE_APP/Contents/MacOS" "$PLASTICINE_APP/Contents/Resources"
cp "$PLASTICINE_BIN/Plasticine" "$PLASTICINE_APP/Contents/MacOS/Plasticine"
chmod +x "$PLASTICINE_APP/Contents/MacOS/Plasticine"
cp "$PLASTICINE_ROOT/Resources/Info.plist" "$PLASTICINE_APP/Contents/Info.plist"
# 上一次构建带的服务不能留到这一次（这次可能不带）。
rm -rf "$PLASTICINE_APP/Contents/Resources/server" "$PLASTICINE_APP/Contents/MacOS/node"
if [[ -n "$PLASTICINE_SERVER" ]]; then
  PLASTICINE_BUNDLED="$PLASTICINE_APP/Contents/Resources/server"
  mkdir -p "$PLASTICINE_BUNDLED"
  tar -xzf "$PLASTICINE_SERVER" -C "$PLASTICINE_BUNDLED" --strip-components=1
  test -f "$PLASTICINE_BUNDLED/manifest.json" || { echo '服务包里没有 manifest.json。' >&2; exit 1; }
  test -f "$PLASTICINE_BUNDLED/client/dist/index.html" || { echo '服务包里没有客户端构建。' >&2; exit 1; }
  cp "$PLASTICINE_NODE" "$PLASTICINE_APP/Contents/MacOS/node"
  chmod +x "$PLASTICINE_APP/Contents/MacOS/node"
  "$PLASTICINE_APP/Contents/MacOS/node" -v
  # 由内向外签：先签带的 Node，再签整个 App（自更新重签时 --deep 也会顺带签它）。
  codesign --force -s - "$PLASTICINE_APP/Contents/MacOS/node"
  echo "已带上服务 $(/usr/bin/plutil -extract version raw "$PLASTICINE_BUNDLED/manifest.json" 2>/dev/null || true)"
fi
swift "$PLASTICINE_ROOT/scripts/make-icon.swift" "$PLASTICINE_ROOT/../client/public/icon.svg" \
  "$PLASTICINE_TMP/Plasticine.iconset" "$PLASTICINE_APP/Contents/Resources"
iconutil -c icns "$PLASTICINE_TMP/Plasticine.iconset" -o "$PLASTICINE_APP/Contents/Resources/AppIcon.icns"
plutil -lint "$PLASTICINE_APP/Contents/Info.plist"
codesign --force --deep -s - "$PLASTICINE_APP"
codesign --verify --deep --strict "$PLASTICINE_APP"
echo "已构建：$PLASTICINE_APP"
# 设备助手（第 14 条）：给 Electron 壳带上的独立可执行文件，没有窗口和 Dock 图标。原 App 不用它。
PLASTICINE_HELPER="$PLASTICINE_ROOT/build/plasticine-helper"
cp "$PLASTICINE_BIN/plasticine-helper" "$PLASTICINE_HELPER"
chmod +x "$PLASTICINE_HELPER"
codesign --force -s - "$PLASTICINE_HELPER"
echo "已构建：$PLASTICINE_HELPER"

if [[ "$PLASTICINE_INSTALL" == true ]]; then
  PLASTICINE_DEST="$HOME/Applications/Plasticine.app"
  mkdir -p "$HOME/Applications"
  if [[ -e "$PLASTICINE_DEST" ]]; then
    # 旧版不留在「应用程序」里（用户 2026-11-03）；新版启动后会把这份清掉。
    PLASTICINE_PREVIOUS="$HOME/Library/Application Support/Plasticine/上一版"
    mkdir -p "$PLASTICINE_PREVIOUS"
    PLASTICINE_BACKUP="$PLASTICINE_PREVIOUS/Plasticine-$(date +%Y%m%d-%H%M%S).app"
    mv "$PLASTICINE_DEST" "$PLASTICINE_BACKUP"
    echo "原应用保留在：$PLASTICINE_BACKUP"
  fi
  ditto "$PLASTICINE_APP" "$PLASTICINE_DEST"
  echo "已安装：$PLASTICINE_DEST"
fi
