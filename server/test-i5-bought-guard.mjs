// I5 回归测试：建单挂「已买」项目的双算守卫（API 级，与 PUT /items 的 needForce 模式一致）。
// 未带 force → 409 + needForce；确认后带 force → 放行；未买项目不受影响。
// 隔离运行：自带临时数据库，不触碰生产库。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5213;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

async function req(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reno-i5-'));
const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT), RENO_DATA_DIR: tmpDir },
  stdio: 'ignore',
});
const cleanup = () => {
  try { child.kill(); } catch { /* 已退出 */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 文件占用时忽略 */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

let ready = false;
for (let i = 0; i < 30; i++) {
  try { if ((await fetch(`${BASE}/settings`)).ok) { ready = true; break; } } catch { /* 尚未启动 */ }
  await new Promise((r) => setTimeout(r, 300));
}
if (!ready) { console.error('隔离测试服务启动失败'); cleanup(); process.exit(1); }

try {
  console.log('== I5 建单双算守卫 ==');
  const sec = await req('POST', '/sections', { name: 'I5板块' });
  const boughtItem = await req('POST', `/sections/${sec.json.id}/items`,
    { name: '已买项目', quantity: 1, unit_price: 500, bought: true });
  const normalItem = await req('POST', `/sections/${sec.json.id}/items`,
    { name: '未买项目', quantity: 1, unit_price: 100 });

  const orderBody = (itemId, extra = {}) => ({
    title: '测试订单', item_id: itemId, total_amount: 30,
    paid_now: { amount: 30, pay_date: '2026-09-01' }, ...extra,
  });

  let r = await req('POST', '/orders', orderBody(boughtItem.json.id));
  check('挂已买项目未带 force → 409', r.status === 409, `status=${r.status}`);
  check('返回 needForce 标志', r.json?.needForce === true, JSON.stringify(r.json));
  check('拒绝时未建订单', (await req('GET', '/orders')).json.length === 0);

  r = await req('POST', '/orders', orderBody(boughtItem.json.id, { force: true }));
  check('带 force（用户已确认）→ 放行', r.status === 200, `status=${r.status}`);

  r = await req('POST', '/orders', orderBody(normalItem.json.id));
  check('未买项目不受守卫影响', r.status === 200, `status=${r.status}`);

  r = await req('GET', '/plan');
  const item = r.json.sections.flatMap((s) => s.items).find((i) => i.id === boughtItem.json.id);
  check('已买项目实际 = 总价 500 + 确认后挂单 30（显式双算）',
    Math.abs(item.actual_amount - 530) < 0.01, `actual=${item?.actual_amount}`);
} finally {
  cleanup();
}

console.log(`\nI5 结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
