import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, UPLOAD_DIR } from './db.js';
import settingsRoutes from './routes/settings.js';
import planRoutes from './routes/plan.js';
import orderRoutes from './routes/orders.js';
import statsRoutes from './routes/stats.js';
import exportRoutes from './routes/export.js';
import importRoutes from './routes/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5174);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const LOG_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// pino（Fastify 内置日志器）：控制台 + data/logs 按天轮转（保留 14 天）
const logger = {
  level: 'info',
  transport: {
    targets: [
      { target: 'pino-roll', options: { file: path.join(LOG_DIR, 'app'), frequency: 'daily', limit: { count: 14 }, mkdir: true } },
      { target: 'pino/file', options: { destination: 1 } },
    ],
  },
};

const app = Fastify({ logger });

// 只允许本机/局域网地址：拦截跨站表单（multipart 无预检）与 DNS rebinding（非法 Host）
// IPv6：::1 环回、fe80:: 链路本地、fc00::/7（fc/fd 前缀）ULA 私有段
// Docker/NAS 部署时可用 EXTRA_ALLOWED_HOSTS 追加主机名（逗号分隔，按字面匹配）
const extraHosts = String(process.env.EXTRA_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
  .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const ALLOWED_HOST = new RegExp(
  `^(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|\\[::1\\]|\\[fe80(:[0-9a-f]{0,4})+\\]|\\[f[cd][0-9a-f]{2}(:[0-9a-f]{0,4})+\\]${extraHosts.length ? '|' + extraHosts.join('|') : ''})(:\\d+)?$`,
  'i',
);
app.addHook('onRequest', async (req, reply) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (!ALLOWED_HOST.test(host)) {
    return reply.status(403).send({ message: '拒绝访问：请通过 localhost 或局域网 IP 访问' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const { host: originHost } = new URL(origin);
      if (!ALLOWED_HOST.test(originHost.toLowerCase())) {
        return reply.status(403).send({ message: '拒绝跨站请求' });
      }
    } catch {
      return reply.status(403).send({ message: '拒绝非法 Origin' });
    }
  }
});

// 写操作审计：所有非 GET 的 /api 请求统一留痕（含失败），新路由自动覆盖
app.addHook('onResponse', async (req, reply) => {
  if (req.method === 'GET') return;
  const url = req.raw.url || '';
  if (!url.startsWith('/api/')) return;
  req.log.info({
    audit: true,
    method: req.method,
    route: req.routeOptions?.url ?? url.split('?')[0],
    status: reply.statusCode,
    ms: Math.round(reply.elapsedTime),
  }, '写操作');
});

await app.register(fastifyMultipart, {
  // 全局关闭框架级 413 抛错，改由各端点自判 truncated 给中文提示
  limits: { fileSize: 10 * 1024 * 1024, throwFileSizeLimit: false },
});

// 票据照片静态服务：/uploads/<filename>
await app.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
  decorateReply: false,
});

app.register(settingsRoutes, { prefix: '/api' });
app.register(planRoutes, { prefix: '/api' });
app.register(orderRoutes, { prefix: '/api' });
app.register(statsRoutes, { prefix: '/api' });
app.register(exportRoutes, { prefix: '/api' });
app.register(importRoutes, { prefix: '/api' });

// 托管前端构建产物（npm start / 启动.bat 场景）
if (fs.existsSync(DIST_DIR)) {
  await app.register(fastifyStatic, { root: DIST_DIR, prefix: '/' });
  // SPA 回退：非 API / 非 uploads 的路径一律返回 index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/uploads/')) {
      return reply.status(404).send({ message: '接口不存在' });
    }
    return reply.sendFile('index.html');
  });
}

app.setErrorHandler((err, req, reply) => {
  req.log.error({ err, url: req.raw.url }, '请求处理失败');
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  reply.status(status).send({ message: status === 500 ? '服务器内部错误' : err.message });
});

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info({ port: PORT }, '装修账本已启动');
    console.log('');
    console.log('  装修账本已启动');
    console.log(`  本机访问:   http://localhost:${PORT}`);
    console.log(`  局域网访问: http://<本机IP>:${PORT}（后期手机在同 WiFi 下可用）`);
    console.log(`  运行日志:   ${path.join(LOG_DIR, 'app-YYYY-MM-DD.log')}`);
    console.log('');
  })
  .catch((err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用：账本可能已在运行，请直接访问 http://localhost:${PORT}`);
    } else {
      console.error('启动失败:', err);
    }
    process.exit(1);
  });
