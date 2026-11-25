#!/bin/sh
#   plasticine status | update | rollback | logs | restart | password | setup-link | export | import
set -eu

APP="/opt/plasticine"
DATA="/var/lib/plasticine"
NODE="$APP/node/bin/node"
UPDATER="$APP/current/scripts/packages/update.ts"
RESTART="systemctl restart plasticine.service"
SERVICE_USER="plasticine"

if [ -r /etc/plasticine/plasticine.env ]; then
  set -a
  . /etc/plasticine/plasticine.env
  set +a
fi

as_service_user() {
  script="$APP/current/agent/src/app/$1"
  shift
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- env PLASTICINE_STATE="$DATA/state" PLASTICINE_PORT="${PLASTICINE_PORT:-8790}" \
      "$NODE" "$script" "$@"
    return
  fi
  sudo -u "$SERVICE_USER" -- env PLASTICINE_STATE="$DATA/state" PLASTICINE_PORT="${PLASTICINE_PORT:-8790}" \
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
    shift
    [ "$(id -u)" = "0" ] || exec sudo "$0" setup-link "$@"
    code=0
    as_service_user setup-link-cli.ts "$@" || code=$?
    if [ "$code" = "10" ]; then
      $RESTART
      code=0
    fi
    exit "$code"
    ;;
  export)
    shift
    [ "$(id -u)" = "0" ] || exec sudo "$0" export "$@"
    as_service_user migration-cli.ts export "$@"
    ;;
  import)
    shift
    [ "$(id -u)" = "0" ] || exec sudo "$0" import "$@"
    as_service_user migration-cli.ts import "$@"
    $RESTART
    ;;
  *)
    echo "用法：plasticine status|update|rollback|logs|restart|password|setup-link|export|import" >&2
    exit 2
    ;;
esac
