#!/bin/sh
# 装修账本 · 备份（主容器内 cron 每天 03:00 调用；手动触发：
#   docker exec renovation /app/backup.sh）
# 打包 /app/data 到 /app/backups，保留最近 KEEP 份（默认 30）
set -e
KEEP="${KEEP:-30}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="/app/backups/reno-$STAMP.tar.gz"

echo "[$(date '+%F %T')] 开始备份 -> $OUT"
tar czf "$OUT" -C /app/data .
SIZE=$(du -h "$OUT" | cut -f1)
echo "[$(date '+%F %T')] 完成: $OUT ($SIZE)"

ls -1t /app/backups/reno-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
  rm -f "$f"
  echo "[$(date '+%F %T')] 清理旧备份: $f"
done
