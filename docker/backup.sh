#!/bin/sh
# 装修账本 · 备份（主容器内 cron 每天 03:00 调用；手动触发：
#   docker exec renovation-expenses /app/backup.sh）
# 打包 /app/data 到 /app/backups，保留最近 KEEP 份（默认 30）
# 一致性：renovation-expenses.db 先经 SQLite 在线备份 API（better-sqlite3 backup）做快照再打包，
#   不对运行中的库直接 tar（页级撕裂风险）；uploads/logs 为普通文件，直接复制。
# 失败可见：无 MTA，cron 输出无处投递——失败写入 $BACKUP_DIR/backup.log 并非零退出。
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
APP_DIR="${APP_DIR:-/app}"
KEEP="${KEEP:-30}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/renovation-expenses-$STAMP.tar.gz"
LOG="$BACKUP_DIR/backup.log"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM
mkdir -p "$TMP/data" "$BACKUP_DIR"

# set -e 在 if 条件内不生效，函数内部失败必须显式 return 1
backup() {
  # 1) 数据库：在线一致性快照（安全用于运行中的库，WAL/DELETE 皆可）
  if ! ( cd "$APP_DIR" && node -e 'const db = require("better-sqlite3")(process.argv[1], { readonly: true });
    db.backup(process.argv[2]).then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });' \
    "$DATA_DIR/renovation-expenses.db" "$TMP/data/renovation-expenses.db" ); then
    echo "数据库快照失败" >&2
    return 1
  fi
  # 2) 附件/日志等普通文件：直接复制（并发写最多缺尾帧，风险远低于数据库页撕裂）
  for d in uploads logs; do
    if [ -d "$DATA_DIR/$d" ]; then
      cp -r "$DATA_DIR/$d" "$TMP/data/" || return 1
    fi
  done
  # 3) 打包（快照库 + 附件，绝不含运行中库的 -journal/-wal/-shm）。
  #    原子写入：先写 .part 成功后 mv——失败时清理残档，
  #    否则截断的 tar.gz 会以正式备份之名留在目录里参与保留轮换，恢复时才发现损坏
  if tar czf "$OUT.part" -C "$TMP" data; then
    mv "$OUT.part" "$OUT" || return 1
  else
    rm -f "$OUT.part"
    return 1
  fi
}

if backup; then
  log "备份完成 -> $OUT ($(du -h "$OUT" | cut -f1))"
  ls -1t "$BACKUP_DIR"/renovation-expenses-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
    rm -f "$f"
    log "清理旧备份: $f"
  done
else
  log "备份失败（DATA_DIR=$DATA_DIR）——请检查数据库与磁盘状态"
  exit 1
fi
