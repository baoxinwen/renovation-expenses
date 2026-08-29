#!/bin/sh
set -e
# root 启动时：先把数据目录属主修正为运行用户（node），再降权执行应用。
# 解决 NAS bind mount 场景：宿主目录属主是 NAS 登录用户（uid 任意），
# 容器内固定 uid 1000 无权写入导致的 EACCES。
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data 2>/dev/null || true
  exec gosu node:node "$@"
fi
exec "$@"
