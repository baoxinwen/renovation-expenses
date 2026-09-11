#!/bin/sh
set -e
# root 启动：修正挂载目录属主 → 注册每日备份定时任务（备份在主容器内完成）→ 降权运行应用
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data 2>/dev/null || true
  chown -R node:node /app/backups 2>/dev/null || true
  # Debian cron 作业不继承容器 ENV，默认 PATH=/usr/bin:/bin 找不到 /usr/local/bin/node，
  # 每晚备份会静默失败——必须在作业行之前显式声明 PATH
  {
    echo 'PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin'
    echo '0 3 * * * node /app/backup.sh run'
  } > /etc/cron.d/backup
  chmod 0644 /etc/cron.d/backup
  cron
  # 应用降权为 node 运行（gosu 随镜像安装）；cron 作业本身已按 node 用户执行
  exec gosu node "$@"
fi
exec "$@"
