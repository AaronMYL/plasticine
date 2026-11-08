#!/bin/sh
# install.sh 装成 /usr/local/bin/plasticine：日常几件事不用记长命令（docs/install-packages.md）。
#   plasticine status | update | rollback | logs | restart
set -eu

APP="/opt/plasticine"
NODE="$APP/node/bin/node"
UPDATER="$APP/current/scripts/packages/update.ts"
RESTART="systemctl restart plasticine.service"

# 自更新读 /etc/plasticine/plasticine.env 里的端口和发布点；手动跑时也带上。
if [ -r /etc/plasticine/plasticine.env ]; then
  set -a
  . /etc/plasticine/plasticine.env
  set +a
fi

case "${1:-status}" in
  status) exec "$NODE" "$UPDATER" status --root "$APP" ;;
  update) exec "$NODE" "$UPDATER" update --root "$APP" --restart-command "$RESTART" ;;
  rollback) exec "$NODE" "$UPDATER" rollback --root "$APP" --restart-command "$RESTART" ;;
  logs) exec journalctl -u plasticine -n 200 --no-pager ;;
  restart) exec systemctl restart plasticine.service ;;
  *)
    echo "用法：plasticine status|update|rollback|logs|restart" >&2
    exit 2
    ;;
esac
