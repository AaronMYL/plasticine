#!/bin/sh
# install.sh 装成 /usr/local/bin/plasticine：日常几件事不用记长命令（docs/install-packages.md）。
#   plasticine status | update | rollback | logs | restart | password | setup-link
# password：重设主人密码（输两遍、不回显；脚本里 plasticine password --stdin 读一行）。
# setup-link：还没建账号时再拿一条一次性建账号链接。这两条要动库，以 plasticine 用户跑；不是 root 先 sudo。
set -eu

APP="/opt/plasticine"
DATA="/var/lib/plasticine"
NODE="$APP/node/bin/node"
UPDATER="$APP/current/scripts/packages/update.ts"
RESTART="systemctl restart plasticine.service"
SERVICE_USER="plasticine"

# 自更新读 /etc/plasticine/plasticine.env 里的端口和发布点；手动跑时也带上。
if [ -r /etc/plasticine/plasticine.env ]; then
  set -a
  . /etc/plasticine/plasticine.env
  set +a
fi

# 以 plasticine 用户跑本体自带的一条命令（库归它）；调用前已经是 root。
as_service_user() {
  script="$APP/current/agent/src/app/$1"
  shift
  if command -v runuser >/dev/null 2>&1; then
    exec runuser -u "$SERVICE_USER" -- env PLASTICINE_STATE="$DATA/state" PLASTICINE_PORT="${PLASTICINE_PORT:-8790}" \
      "$NODE" "$script" "$@"
  fi
  exec sudo -u "$SERVICE_USER" -- env PLASTICINE_STATE="$DATA/state" PLASTICINE_PORT="${PLASTICINE_PORT:-8790}" \
    "$NODE" "$script" "$@"
}

case "${1:-status}" in
  status) exec "$NODE" "$UPDATER" status --root "$APP" ;;
  update) exec "$NODE" "$UPDATER" update --root "$APP" --restart-command "$RESTART" ;;
  rollback) exec "$NODE" "$UPDATER" rollback --root "$APP" --restart-command "$RESTART" ;;
  logs) exec journalctl -u plasticine -n 200 --no-pager ;;
  restart) exec systemctl restart plasticine.service ;;
  password)
    shift
    [ "$(id -u)" = "0" ] || exec sudo "$0" password "$@"
    as_service_user password-cli.ts "$@"
    ;;
  setup-link)
    [ "$(id -u)" = "0" ] || exec sudo "$0" setup-link
    as_service_user setup-link-cli.ts
    ;;
  *)
    echo "用法：plasticine status|update|rollback|logs|restart|password|setup-link" >&2
    exit 2
    ;;
esac
