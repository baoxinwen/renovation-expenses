# syntax=docker/dockerfile:1

# ============ 构建阶段：全量依赖 + 前端构建 ============
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# better-sqlite3 原生模块的兜底编译工具链（有预编译包时不会用到，仅拖慢 builder 层）
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY client/ client/
COPY server/ server/
COPY vite.config.ts ./
# build = tsc 类型检查 + vite 产物（输出 dist/）
RUN npm run build
# 裁掉 devDependencies，只留运行时依赖给最终镜像
RUN npm prune --omit=dev

# ============ 运行阶段：精简运行时 ============
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=5174
# 可选：放行额外的 Host（逗号分隔主机名），见 README
# ENV EXTRA_ALLOWED_HOSTS=nas.local

# gosu：entrypoint 降权；cron：容器内每日自动备份（每天 03:00 以 node 用户执行）
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu cron \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# 备份脚本打进镜像：backup sidecar 直接复用本镜像执行，无需挂载宿主脚本
COPY docker/backup.sh /app/backup.sh
# Windows 检出的脚本无可执行位，显式 chmod（双保险：ENTRYPOINT 用 sh 执行不依赖权限位）
RUN chmod +x /usr/local/bin/entrypoint.sh /app/backup.sh

# 数据卷：SQLite 库 + 票据 + 日志（compose 里 bind mount 到宿主 ./data）
VOLUME /app/data
# 备份卷：裸 docker run（不经 compose）升级容器时备份不随容器可写层丢失
VOLUME /app/backups
# 以 root 进入 entrypoint（自动修正数据目录属主后降权 node 运行，见 entrypoint.sh）
EXPOSE 5174

# 健康检查：node 22 内置 fetch，无需 curl/wget
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5174)+'/api/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server/index.js"]
