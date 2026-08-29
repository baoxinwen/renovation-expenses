#!/bin/sh
# 装修账本 · 自动备份脚本（alpine busybox 环境）
# 用法：backup.sh schedule   常驻模式：每天 03:00 备份（容器 entrypoint）
#       backup.sh run        立即备份一次（手动触发/调试）
set -e

KEEP="${KEEP:-30}"   # 保留最近 N 份

do_backup() {
  set +e
  STAMP=$(date +%Y%m%d-%H%M%S)
  OUT="/backups/reno-$STAMP.tar.gz"
  echo "[$(date '+%F %T')] 开始备份 -> $OUT"
  tar czf "$OUT" -C /data .
  SIZE=$(du -h "$OUT" | cut -f1)
  echo "[$(date '+%F %T')] 完成: reno-$STAMP.tar.gz ($SIZE)"
  # 清理超出保留份数的旧备份
  ls -1t /backups/reno-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
    rm -f "$f"
    echo "[$(date '+%F %T')] 清理旧备份: $f"
  done
  set -e
}

case "$1" in
  run)
    do_backup
    ;;
  schedule)
    mkdir -p /backups
    # Debian 原生 cron：cron.d 方式注册定时任务
    echo "0 3 * * * root /app/backup.sh run" > /etc/cron.d/backup
    chmod 0644 /etc/cron.d/backup
    echo "[backup] 定时任务已注册：每天 03:00 备份，保留最近 ${KEEP} 份"
    # 首次启动（尚无任何备份）时尝试补一次；失败不退出——cron 常驻优先
    if ! ls /backups/reno-*.tar.gz >/dev/null 2>&1; then
      do_backup || echo "[backup] 首次备份失败，明天 03:00 将自动重试"
    fi
    echo "[backup] 进入常驻定时模式"
    exec cron -f
    ;;
  *)
    echo "用法: backup.sh [run|schedule]"
    exit 1
    ;;
esac
