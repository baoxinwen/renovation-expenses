// 测试共用：启动隔离服务并等待就绪。
// 就绪判定以 RENOVATION_READY_FILE 就绪标记为准（index.js 监听成功后写入），
// 同时每轮轮询都检查子进程是否已退出：端口被残留实例等外部服务占用时，
// 子进程会因 EADDRINUSE 立即退出（stdio ignore 下不可见）——若只看 /api/settings
// 探测响应，就会把外部实例当被测对象，最坏对其执行 mode=replace 导入破坏真实数据。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'index.js');

/**
 * 启动隔离服务。dataDir 必须已存在（就绪标记写在其下）。
 * @returns {{ child: import('node:child_process').ChildProcess, ready: boolean, base: string }}
 */
export async function startTestServer({ port, dataDir, extraEnv = {} }) {
  const readyFile = path.join(dataDir, '.test-ready');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      RENOVATION_DATA_DIR: dataDir,
      RENOVATION_READY_FILE: readyFile,
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api`;
  // 100ms × 300 = 30s 上限；子进程退出立即失败，不浪费轮询窗口
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return { child, ready: false, base };
    if (fs.existsSync(readyFile)) return { child, ready: true, base };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, ready: false, base };
}

export function cleanupTestServer(child, dataDir) {
  try { child?.kill(); } catch { /* 已退出 */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows 文件占用时忽略 */ }
}
