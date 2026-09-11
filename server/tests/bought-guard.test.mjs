// 回归测试：建单挂「已买」项目的双算守卫（API 级，与 PUT /items 的 needForce 模式一致）。
// 未带 force → 409 + needForce；确认后带 force → 放行；未买项目不受影响。
// 隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-bought-guard-test-'));
// 就绪判定凭就绪标记 + 子进程存活（端口被外部实例占用时快速失败，不误测外部实例）
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  console.log('== 建单双算守卫 ==');
  const sec = await req('POST', '/sections', { name: '测试板块' });
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

  console.log('== 已买项目的普通编辑不被守卫误伤（I2） ==');
  // boughtItem 已处于「已买=1 且有挂单付款」状态（守卫设计的显式双算场景）
  r = await req('PUT', `/items/${boughtItem.json.id}`, { note: '改备注' });
  check('已买+有付款的项目改备注 → 200（守卫只拦 0→1 跃迁）', r.status === 200, `status=${r.status} ${JSON.stringify(r.json)}`);
  r = await req('PUT', `/items/${boughtItem.json.id}`, { name: '已买项目改名', unit_price: 600 });
  check('改名称/单价同样放行', r.status === 200 && r.json?.name === '已买项目改名', `status=${r.status}`);

  console.log('== 编辑订单换绑已买项目的守卫（I3） ==');
  // 未挂项目的散单换绑到已买项目：与 POST /orders 同款守卫
  const plainOrder = await req('POST', '/orders', {
    title: '散单', total_amount: 50, paid_now: { amount: 20, pay_date: '2026-09-02' },
  });
  const oid = plainOrder.json.id;
  r = await req('PUT', `/orders/${oid}`, { item_id: boughtItem.json.id });
  check('PUT 换绑到已买项目未带 force → 409', r.status === 409 && r.json?.needForce === true, `status=${r.status}`);
  check('409 时未落库', (await req('GET', `/orders/${oid}`)).json.item_id === null);
  r = await req('PUT', `/orders/${oid}`, { item_id: boughtItem.json.id, force: true });
  check('force 后放行', r.status === 200 && r.json.item_id === boughtItem.json.id, `status=${r.status}`);
  // 订单本就挂在该项目上时改标题：不是换绑跃迁，不需要 force
  r = await req('PUT', `/orders/${oid}`, { title: '散单改名', item_id: boughtItem.json.id });
  check('同项目编辑不触发守卫', r.status === 200, `status=${r.status} ${JSON.stringify(r.json)}`);
  // 换绑到未买项目不受影响
  r = await req('PUT', `/orders/${oid}`, { item_id: normalItem.json.id });
  check('换绑到未买项目放行', r.status === 200 && r.json.item_id === normalItem.json.id, `status=${r.status}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
