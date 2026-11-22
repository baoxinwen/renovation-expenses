#!/usr/bin/env bash
# Linux ci-smoke：在 node:22 容器内干净复现 CI 测试步（.github/workflows/docker.yml
# 的 npm ci + npm test，ubuntu 同款环境）。发版打 tag 前必须先跑绿本脚本，或等
# main 分支的 CI 绿——Windows 本地全绿不代表 Linux 成立（v1.5.0 教训）。
#
# 用法：bash scripts/ci-smoke.sh
# 说明：node_modules 用匿名卷隔离，容器内 npm ci 不会污染宿主机的 Windows 依赖。
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v cygpath >/dev/null 2>&1; then
  HOST_DIR="$(cygpath -w "$(pwd)")"   # Git Bash 下转 Windows 原生路径（路径含空格也可）
else
  HOST_DIR="$(pwd)"
fi

echo "== Linux ci-smoke：node:22 容器内 npm ci + npm test =="
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
  docker run --rm -v "${HOST_DIR}:/app" -v /app/node_modules -w /app node:22 \
  sh -c 'npm ci && npm test'
