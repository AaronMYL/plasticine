#!/bin/sh
# Plasticine Linux 安装（docs/install-packages.md）。在 VPS 上以 root 运行：
#   curl -fsSL <发布点>/install.sh | sudo sh                         安装或升级（也升级 Node）
#   curl -fsSL <发布点>/install.sh | sudo sh -s -- --uninstall       卸载程序，数据留着
#   curl -fsSL <发布点>/install.sh | sudo sh -s -- --uninstall --purge   连数据一起删
# 装 Node 24 到 /opt/plasticine/node，服务包到 /opt/plasticine/versions/<版本>（current 指着在用的），
# 以 plasticine 用户在 systemd 下跑；数据在 /var/lib/plasticine，设置在 /etc/plasticine/plasticine.env。
# 下载的 Node 按 nodejs.org 的 SHASUMS256.txt 核对，服务包按发布清单的 SHA-256 核对，对不上就停。
# PLASTICINE_PREFIX 只给测试用：把所有路径挪到一个临时目录下，不要求 root。
set -eu

# 发布工作流可以把实际的发布点写进这一行。
DEFAULT_RELEASE_URL="https://cyberhunter.top/download"
# 和 scripts/packages/release-manifest.ts 的 PACKAGE_NODE_VERSION 一致（测试核对）。
DEFAULT_NODE_VERSION="24.22.1"

RELEASE_URL="${PLASTICINE_RELEASE_URL:-$DEFAULT_RELEASE_URL}"
NODE_VERSION="${PLASTICINE_NODE_VERSION:-$DEFAULT_NODE_VERSION}"
NODE_MIRROR="${PLASTICINE_NODE_MIRROR:-https://nodejs.org/dist}"
PORT="${PLASTICINE_PORT:-8790}"
PREFIX="${PLASTICINE_PREFIX:-}"

APP="$PREFIX/opt/plasticine"
DATA="$PREFIX/var/lib/plasticine"
CONF="$PREFIX/etc/plasticine"
UNITS="$PREFIX/etc/systemd/system"
BIN="$PREFIX/usr/local/bin"
SERVICE_USER="plasticine"
# 服务启动要开库、补跑重启前的任务；一分钟没答上健康检查就算没起来。
HEALTH_SECONDS="${PLASTICINE_HEALTH_SECONDS:-60}"

say() { printf '%s\n' "$*" >&2; }
die() {
  say "Plasticine 安装没完成：$*"
  exit 1
}

ACTION="install"
PURGE="false"
for arg in "$@"; do
  case "$arg" in
    --uninstall) ACTION="uninstall" ;;
    --purge) PURGE="true" ;;
    *) die "不认识的参数 $arg（可用：--uninstall、--purge）" ;;
  esac
done

if [ -z "$PREFIX" ] && [ "$(id -u)" != "0" ]; then
  die "要用 root 运行：curl -fsSL <发布点>/install.sh | sudo sh"
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

fetch() {
  curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1" || die "下载失败：$1"
}

node_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo "x64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *) die "不支持这种 CPU：$(uname -m)（只有 x86_64 和 arm64）" ;;
  esac
}

# 读发布清单里的一个字段（点分路径）；Node 已经装好了，用它解析 JSON。
manifest_field() {
  "$APP/node/bin/node" -e '
    let value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const key of process.argv[2].split(".")) { value = value?.[key]; }
    if (typeof value !== "string" && typeof value !== "number") { process.exit(3); }
    process.stdout.write(String(value));
  ' "$1" "$2" || die "发布清单里没有 $2"
}

install_node() {
  if [ -x "$APP/node/bin/node" ] && [ "$("$APP/node/bin/node" -v 2>/dev/null || true)" = "v$NODE_VERSION" ]; then
    return 0
  fi
  name="node-v$NODE_VERSION-linux-$(node_arch)"
  say "下载 Node $NODE_VERSION"
  fetch "$NODE_MIRROR/v$NODE_VERSION/$name.tar.gz" "$WORK/node.tar.gz"
  fetch "$NODE_MIRROR/v$NODE_VERSION/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
  want=$(grep " $name.tar.gz\$" "$WORK/SHASUMS256.txt" | cut -d ' ' -f 1)
  [ -n "$want" ] || die "SHASUMS256.txt 里没有 $name.tar.gz"
  [ "$(sha256_of "$WORK/node.tar.gz")" = "$want" ] || die "Node 安装包的 SHA-256 对不上"
  mkdir -p "$WORK/node"
  tar -xzf "$WORK/node.tar.gz" -C "$WORK/node" --strip-components=1 --no-same-owner
  rm -rf "$APP/node.old"
  if [ -d "$APP/node" ]; then mv "$APP/node" "$APP/node.old"; fi
  mv "$WORK/node" "$APP/node"
  rm -rf "$APP/node.old"
}

install_server() {
  fetch "$RELEASE_URL/manifest.json" "$WORK/manifest.json"
  version=$(manifest_field "$WORK/manifest.json" version)
  url=$(manifest_field "$WORK/manifest.json" assets.server.url)
  want=$(manifest_field "$WORK/manifest.json" assets.server.sha256)
  case "$url" in
    https://* | http://127.0.0.1* | file://*) ;;
    *://*) die "服务包地址只能是 https：$url" ;;
    *) url="$RELEASE_URL/$url" ;;
  esac
  if [ "$(readlink "$APP/current" 2>/dev/null || true)" = "versions/$version" ]; then
    say "服务已是 $version"
    return 0
  fi
  say "下载 Plasticine $version"
  fetch "$url" "$WORK/server.tar.gz"
  [ "$(sha256_of "$WORK/server.tar.gz")" = "$want" ] || die "服务包的 SHA-256 和发布清单对不上"
  target="$APP/versions/$version"
  rm -rf "$target.partial"
  mkdir -p "$target.partial"
  tar -xzf "$WORK/server.tar.gz" -C "$target.partial" --strip-components=1 --no-same-owner
  [ "$(manifest_field "$target.partial/manifest.json" version)" = "$version" ] || die "包里的版本和发布清单不一致"
  rm -rf "$target"
  mv "$target.partial" "$target"
  old=$(readlink "$APP/current" 2>/dev/null || true)
  if [ -n "$old" ] && [ "$old" != "versions/$version" ]; then
    ln -sfn "$old" "$APP/previous"
  fi
  ln -sfn "versions/$version" "$APP/current"
}

nologin_shell() {
  for shell in /usr/sbin/nologin /sbin/nologin /bin/false; do
    if [ -x "$shell" ]; then
      echo "$shell"
      return 0
    fi
  done
  echo /bin/false
}

prepare_user_and_data() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/plasticine --no-create-home --shell "$(nologin_shell)" "$SERVICE_USER"
  fi
  mkdir -p "$DATA/state" "$CONF"
  chown "$SERVICE_USER:$SERVICE_USER" "$DATA" "$DATA/state"
  chmod 700 "$DATA" "$DATA/state"
  if [ ! -f "$CONF/plasticine.env" ]; then
    cat > "$CONF/plasticine.env" <<ENV
# Plasticine 实例设置（docs/install-packages.md）。改完运行：systemctl restart plasticine
PLASTICINE_PORT=$PORT
# 换发布点（自更新从这里查）：
# PLASTICINE_RELEASE_URL=$RELEASE_URL
ENV
  fi
  chown "root:$SERVICE_USER" "$CONF/plasticine.env"
  chmod 640 "$CONF/plasticine.env"
}

# 单元文件随服务包走（scripts/packages/linux/）；路径按 PREFIX 挪（正式安装时 PREFIX 为空，原样拷）。
install_units() {
  mkdir -p "$UNITS" "$BIN"
  for unit in plasticine.service plasticine-update.service plasticine-update.timer; do
    sed -e "s#/opt/plasticine#$APP#g" -e "s#/var/lib/plasticine#$DATA#g" -e "s#/etc/plasticine#$CONF#g" \
      "$APP/current/scripts/packages/linux/$unit" > "$UNITS/$unit"
  done
  sed -e "s#/opt/plasticine#$APP#g" -e "s#/etc/plasticine#$CONF#g" -e "s#/var/lib/plasticine#$DATA#g" \
    "$APP/current/scripts/packages/linux/plasticine-ctl.sh" > "$BIN/plasticine"
  chmod 755 "$BIN/plasticine"
  systemctl daemon-reload
  systemctl enable plasticine.service plasticine-update.timer
  systemctl restart plasticine.service
  systemctl start plasticine-update.timer
}

configured_port() {
  port=$(sed -n 's/^PLASTICINE_PORT=//p' "$CONF/plasticine.env" | tail -n 1)
  echo "${port:-$PORT}"
}

wait_healthy() {
  port=$(configured_port)
  tries=0
  while [ "$tries" -lt "$HEALTH_SECONDS" ]; do
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/v2/health" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  die "服务 $HEALTH_SECONDS 秒内没答上健康检查。看日志：journalctl -u plasticine -n 100"
}

# 以 plasticine 用户跑一条命令（库归它）：有 runuser 用它（util-linux，systemd 发行版都有），没有退到 sudo。
as_service_user() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- "$@"
  else
    sudo -u "$SERVICE_USER" -- "$@"
  fi
}

# 2026-11-08《首次使用流程》：还没有主人就打印一次性建账号链接（30 分钟、用一次）；已经有主人它自己说一句。
print_setup_link() {
  port=$1
  link_cli="$APP/current/agent/src/app/setup-link-cli.ts"
  [ -f "$link_cli" ] || return 0
  as_service_user env PLASTICINE_STATE="$DATA/state" PLASTICINE_PORT="$port" "$APP/node/bin/node" "$link_cli" >&2 \
    || say "建账号链接这次没生成出来；稍后运行 sudo plasticine setup-link 再拿一条。"
}

install() {
  command -v curl >/dev/null 2>&1 || die "需要 curl"
  command -v tar >/dev/null 2>&1 || die "需要 tar"
  command -v systemctl >/dev/null 2>&1 || die "需要 systemd"
  mkdir -p "$APP/versions"
  WORK=$(mktemp -d "$APP/.install.XXXXXX")
  trap 'rm -rf "$WORK"' EXIT
  install_node
  install_server
  prepare_user_and_data
  install_units
  wait_healthy
  port=$(configured_port)
  say ""
  say "✓ Plasticine $(readlink "$APP/current" | sed 's#versions/##') 装好了，正在运行（只听 127.0.0.1:${port}）"
  say ""
  print_setup_link "$port"
  say "  这台服务器没有图形界面的话，先在你电脑上运行："
  say "  ssh -L $port:127.0.0.1:$port <用户>@<这台服务器>"
  say ""
  say "以后："
  say "  plasticine password   重设密码"
  say "  plasticine status     看运行状态"
  say "  每天自动更新；手动 sudo plasticine update，回到上一版 sudo plasticine rollback"
}

uninstall() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now plasticine-update.timer plasticine.service >/dev/null 2>&1 || true
  fi
  rm -f "$UNITS/plasticine.service" "$UNITS/plasticine-update.service" "$UNITS/plasticine-update.timer"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
  fi
  rm -rf "$APP"
  rm -f "$BIN/plasticine"
  if [ "$PURGE" = "true" ]; then
    rm -rf "$DATA" "$CONF"
    if id "$SERVICE_USER" >/dev/null 2>&1; then
      userdel "$SERVICE_USER" || say "没删掉 $SERVICE_USER 用户，可以手动 userdel"
    fi
    say "Plasticine 和它的数据都删掉了。"
  else
    say "Plasticine 已卸载。数据留在 ${DATA}，设置在 ${CONF}；连数据一起删：加 --uninstall --purge 再运行一次。"
  fi
}

if [ "$ACTION" = "uninstall" ]; then
  uninstall
else
  install
fi
