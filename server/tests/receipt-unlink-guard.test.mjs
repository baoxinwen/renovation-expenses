// 回归测试：票据文件删除的路径越界防御（纵深防御）。
// removeFiles 的 filename 取自 DB——库文件被篡改或恢复了恶意备份时，filename 可能携带
// ../ 相对穿越或绝对路径，修复前 path.join 后直接 fs.unlink 会删掉上传目录之外的任意文件。
// 断言不变量：DELETE /receipts/:id 与 /payments/:id 只清理上传目录内的文件；
// 越界文件名被跳过（DB 行照常删除），正常票据清理不受影响。
// 隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const PORT = 5216;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-unlink-guard-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

const api = async (method, p) => {
  const res = await fetch(BASE + p, { method });
  return { status: res.status, json: await res.json().catch(() => null) };
};

try {
  // 造一个一次付清订单拿首笔付款
  await fetch(`${BASE}/sections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试板块' }) });
  const order = await fetch(`${BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '守卫订单', total_amount: 10, paid_now: { amount: 10, pay_date: '2026-10-17' } }),
  }).then((r) => r.json());

  const uploadsDir = path.join(tmpDir, 'uploads');
  // 哨兵文件放在上传目录之外（dataDir 根下），恶意 filename 用 ../ 穿越
  const sentinel = path.join(tmpDir, 'sentinel-outside.png');
  fs.writeFileSync(sentinel, 'sentinel');
  const EVIL_NAME = '../sentinel-outside.png';

  console.log('== 越界文件名防御（DELETE /receipts/:id） ==');
  // 直接向隔离库插一条被篡改的票据行（模拟恶意备份恢复后的落库状态）
  const db = new Database(path.join(tmpDir, 'renovation-expenses.db'));
  const ins = db.prepare('INSERT INTO receipts (payment_id, filename, original_name) VALUES (?, ?, ?)');
  const evil1 = ins.run(order.payments[0].id, EVIL_NAME, 'evil.png');
  db.close();
  let r = await api('DELETE', `/receipts/${evil1.lastInsertRowid}`);
  check('越界票据行照常删除（接口可用）', r.status === 200, `status=${r.status}`);
  check('上传目录之外的哨兵文件未被删除', fs.existsSync(sentinel), 'sentinel 已被越界删除');
  check('服务仍存活', (await fetch(`${BASE}/settings`)).ok);

  console.log('== 越界文件名防御（DELETE /payments/:id 连带清理） ==');
  // 两个变体：相对穿越（payments 连带清理路径）与绝对路径注入（path.resolve 对绝对名直接放行原值）
  const sentinel2 = path.join(tmpDir, 'sentinel-outside2.png');
  const sentinel3 = path.join(tmpDir, 'sentinel-outside3.png');
  fs.writeFileSync(sentinel2, 'sentinel2');
  fs.writeFileSync(sentinel3, 'sentinel3');
  const db2 = new Database(path.join(tmpDir, 'renovation-expenses.db'));
  const ins2 = db2.prepare('INSERT INTO receipts (payment_id, filename, original_name) VALUES (?, ?, ?)');
  ins2.run(order.payments[0].id, '../sentinel-outside2.png', 'evil2.png');
  ins2.run(order.payments[0].id, sentinel3, 'evil3.png');
  db2.close();
  r = await api('DELETE', `/payments/${order.payments[0].id}`);
  check('付款连同越界票据行照常删除', r.status === 200, `status=${r.status}`);
  check('连带清理路径：相对穿越文件名被跳过', fs.existsSync(sentinel2), 'sentinel2 已被越界删除');
  check('连带清理路径：绝对路径注入被跳过', fs.existsSync(sentinel3), 'sentinel3 已被越界删除');

  console.log('== 正常票据清理不受防御误伤 ==');
  // 新付款 + 正常上传一张真票据，删除后文件必须真被清理
  const order2 = await fetch(`${BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '正常订单', total_amount: 10, paid_now: { amount: 10, pay_date: '2026-10-17' } }),
  }).then((res) => res.json());
  const fd = new FormData();
  fd.append('files', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'ok.png');
  const up = await fetch(`${BASE}/payments/${order2.payments[0].id}/receipts`, { method: 'POST', body: fd }).then((res) => res.json());
  check('正常上传成功', Array.isArray(up) && up.length === 1, JSON.stringify(up?.message ?? up?.length));
  r = await api('DELETE', `/receipts/${up[0].id}`);
  check('正常票据删除成功', r.status === 200, `status=${r.status}`);
  check('正常票据文件确实被清理', !fs.existsSync(path.join(uploadsDir, up[0].filename)), '文件残留');
} catch (e) {
  failed++;
  console.error('测试执行异常:', e);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
