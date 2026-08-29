#!/bin/sh
set -e
# root 启动：修正挂载目录属主 → 注册每日备份定时任务（备份在主容器内完成）→ 降权运行应用
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data 2>/dev/null || true
  chown -R node:node /app/backups 2>/dev/null || true
  echo '0 3 * * * node /app/backup.sh run' > /etc/cron.d/backup
  chmod 0644 /etc/cron.d/backup
  cron
fi
exec "$@"
