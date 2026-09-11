// 元测试：测试基建 spawn-server 助手的就绪判定必须校验响应者身份。
// 场景 1（干净端口）：就绪标记必须出现——防止退化成只探测 HTTP（评审 I8 的根因）。
// 场景 2（端口被会对 /api/settings 返回 200 的外部服务占用，如上次被强杀的残留实例）：
//   子进程 EADDRINUSE 退出 → 必须报告未就绪并快速失败，而非把外部实例当被测对象。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('== 场景 1：干净端口正常就绪 ==');
const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-spawn-ok-'));
{
  const { child, ready } = await startTestServer({ port: 5216, dataDir: tmp1 });
  const cleanup = () => cleanupTestServer(child, tmp1);
  process.on('exit', cleanup);
  try {
    check('正常启动报告 ready=true（就绪标记生效）', ready === true);
    check('子进程存活', child.exitCode === null);
  } finally {
    cleanup();
  }
}

console.log('== 场景 2：端口被外部服务占用 ==');
const occupier = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ total_budget: 0 }));
});
// 与子进程同形绑定 0.0.0.0：必然冲突。Windows 对通配/具体地址的共存很宽容
//（:: 与 0.0.0.0、127.0.0.1 与 0.0.0.0 都可能同时绑定成功），同形绑定才能稳定复现占用
await new Promise((resolve) => occupier.listen(5217, '0.0.0.0', resolve));

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-spawn-clash-'));
{
  const t0 = Date.now();
  const { child, ready } = await startTestServer({ port: 5217, dataDir: tmp2 });
  const cleanup = () => cleanupTestServer(child, tmp2);
  process.on('exit', cleanup);
  try {
    check('不得把外部实例当被测对象（ready=false）', ready === false);
    check('子进程因端口占用退出（exitCode=1）', child.exitCode === 1, `exitCode=${child.exitCode}`);
    check('快速失败（<15s，而非等满轮询窗口）', Date.now() - t0 < 15000, `ms=${Date.now() - t0}`);
    check('外部占用服务未被误伤仍在监听', occupier.listening);
  } finally {
    cleanup();
    occupier.close();
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
