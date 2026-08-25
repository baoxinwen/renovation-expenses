import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPLOAD_DIR } from './db.js';
import settingsRoutes from './routes/settings.js';
import planRoutes from './routes/plan.js';
import orderRoutes from './routes/orders.js';
import statsRoutes from './routes/stats.js';
import exportRoutes from './routes/export.js';
import importRoutes from './routes/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5174);
const DIST_DIR = path.join(__dirname, '..', 'dist');

const app = Fastify({ logger: false });

await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });

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

app.setErrorHandler((err, _req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  reply.status(status).send({ message: status === 500 ? '服务器内部错误' : err.message });
});

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    console.log('');
    console.log('  装修账本已启动');
    console.log(`  本机访问:   http://localhost:${PORT}`);
    console.log(`  局域网访问: http://<本机IP>:${PORT}（后期手机在同 WiFi 下可用）`);
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
