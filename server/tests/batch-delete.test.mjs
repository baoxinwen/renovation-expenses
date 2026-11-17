// 批量软删/恢复（清单项目 + 订单）：事务内整批生效、needForce 整批确认、
// 连带恢复父板块。隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const PORT = 5255;
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-batch-del-test-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  console.log('== 参数与计数 ==');
  let r = await req('POST', '/items/batch-delete', { ids: [] });
  check('items 空 ids 400', r.status === 400, `status=${r.status}`);
  r = await req('POST', '/orders/batch-delete', { ids: [] });
  check('orders 空 ids 400', r.status === 400, `status=${r.status}`);

  const sec = await req('POST', '/sections', { name: '批量删除测试板块' });
  const secId = sec.json.id;
  const it1 = await req('POST', `/sections/${secId}/items`, { name: '批量项1', quantity: 1, unit_price: 100 });
  const it2 = await req('POST', `/sections/${secId}/items`, { name: '批量项2', quantity: 2, unit_price: 50 });
  r = await req('POST', '/items/batch-delete', { ids: [it1.json.id, it2.json.id, 999999] });
  check('含无效 id 只删存在的并回报计数', r.status === 200 && r.json?.deleted === 2,
    `status=${r.status} json=${JSON.stringify(r.json)}`);
  let plan = await req('GET', '/plan');
  let secItems = plan.json.sections.find((s) => s.id === secId)?.items ?? [];
  check('批量删后项目从清单消失', secItems.length === 0, JSON.stringify(secItems.map((i) => i.name)));

  console.log('== items 批量恢复（含 needForce 整批确认）==');
  r = await req('POST', '/items/batch-restore', { ids: [it1.json.id, it2.json.id] });
  check('无风险批量恢复成功', r.status === 200 && r.json?.restored === 2, `status=${r.status} json=${JSON.stringify(r.json)}`);
  plan = await req('GET', '/plan');
  secItems = plan.json.sections.find((s) => s.id === secId)?.items ?? [];
  check('批量恢复后项目回到清单', secItems.length === 2, JSON.stringify(secItems.map((i) => i.name)));

  // it2 勾已买 + 挂一笔订单付款 → 批量恢复（含 it2）触发整批 needForce
  await req('PUT', `/items/${it2.json.id}`, { bought: true, paid_amount: 90, bought_date: '2026-11-17' });
  // 挂单到已买项目被既有单条守卫拦截（正是要构造的双算形态）——造数显式 force
  const order = await req('POST', '/orders', { title: '批量恢复守卫订单', item_id: it2.json.id, total_amount: 60, force: true });
  check('造数：挂单订单', order.status === 200, `status=${order.status}`);
  // 记付款同样被付款守卫拦截（已买项目+付款=双算）——造数显式 force
  const pay = await req('POST', `/orders/${order.json.id}/payments`, { amount: 60, pay_date: '2026-11-17', force: true });
  check('造数：订单付款', pay.status === 200, `status=${pay.status}`);
  r = await req('DELETE', `/items/${it1.json.id}`);
  r = await req('DELETE', `/items/${it2.json.id}`);
  check('造数：两项目已批量软删', r.status === 200);
  r = await req('POST', '/items/batch-restore', { ids: [it1.json.id, it2.json.id] });
  check('含已买+挂单项的批量恢复 409 needForce',
    r.status === 409 && r.json?.needForce === true, `status=${r.status} json=${JSON.stringify(r.json)}`);
  plan = await req('GET', '/plan');
  secItems = plan.json.sections.find((s) => s.id === secId)?.items ?? [];
  check('409 时整批不落库（仍处于删除态）', secItems.length === 0, JSON.stringify(secItems.map((i) => i.name)));
  r = await req('POST', '/items/batch-restore', { ids: [it1.json.id, it2.json.id], force: true });
  check('force 整批恢复成功', r.status === 200 && r.json?.restored === 2, `status=${r.status} json=${JSON.stringify(r.json)}`);
  plan = await req('GET', '/plan');
  secItems = plan.json.sections.find((s) => s.id === secId)?.items ?? [];
  check('force 后两项目都回来', secItems.length === 2, JSON.stringify(secItems.map((i) => i.name)));

  console.log('== 批量恢复连带复活父板块 ==');
  const sec2 = await req('POST', '/sections', { name: '连带恢复板块' });
  const it3 = await req('POST', `/sections/${sec2.json.id}/items`, { name: '连带项', quantity: 1, unit_price: 10 });
  await req('DELETE', `/sections/${sec2.json.id}`); // 板块连带软删 it3
  r = await req('POST', '/items/batch-restore', { ids: [it3.json.id] });
  check('批量恢复项目成功', r.status === 200, `status=${r.status}`);
  plan = await req('GET', '/plan');
  const revivedSec = plan.json.sections.find((s) => s.id === sec2.json.id);
  check('父板块连带复活且项目可见', !!revivedSec && (revivedSec.items ?? []).some((i) => i.id === it3.json.id),
    JSON.stringify(plan.json.sections.map((s) => s.name)));

  console.log('== orders 批量删/恢复（含 needForce）==');
  const o1 = await req('POST', '/orders', { title: '批量订单1', total_amount: 100 });
  const o2 = await req('POST', '/orders', { title: '批量订单2', total_amount: 200 });
  check('造数：两笔订单', o1.status === 200 && o2.status === 200);
  r = await req('POST', '/orders/batch-delete', { ids: [o1.json.id, o2.json.id] });
  check('orders 批量删计数正确', r.status === 200 && r.json?.deleted === 2, `status=${r.status} json=${JSON.stringify(r.json)}`);
  let orders = await req('GET', '/orders');
  check('批量删后订单从列表消失', !orders.json.some((o) => [o1.json.id, o2.json.id].includes(o.id)),
    JSON.stringify(orders.json.map((o) => o.title)));
  r = await req('POST', '/orders/batch-restore', { ids: [o1.json.id, o2.json.id] });
  check('orders 无风险批量恢复成功', r.status === 200 && r.json?.restored === 2, `status=${r.status} json=${JSON.stringify(r.json)}`);
  orders = await req('GET', '/orders');
  check('批量恢复后订单回到列表', orders.json.some((o) => o.id === o1.json.id) && orders.json.some((o) => o.id === o2.json.id));

  // 订单删除期间项目被勾「已买」→ 批量恢复 needForce（对照单条 orders 恢复守卫）
  const o3 = await req('POST', '/orders', { title: '守卫用订单', item_id: it3.json.id, total_amount: 500 });
  check('造数：挂到未买项目的订单', o3.status === 200, `status=${o3.status}`);
  await req('POST', `/orders/${o3.json.id}/payments`, { amount: 500, pay_date: '2026-11-17' });
  await req('DELETE', `/orders/${o3.json.id}`);
  await req('PUT', `/items/${it3.json.id}`, { bought: true, paid_amount: 8, bought_date: '2026-11-17' });
  r = await req('POST', '/orders/batch-restore', { ids: [o3.json.id] });
  check('删除期间项目被勾已买 → 批量恢复 409 needForce',
    r.status === 409 && r.json?.needForce === true, `status=${r.status} json=${JSON.stringify(r.json)}`);
  r = await req('POST', '/orders/batch-restore', { ids: [o3.json.id], force: true });
  check('force 后订单恢复成功', r.status === 200, `status=${r.status} json=${JSON.stringify(r.json)}`);
  orders = await req('GET', '/orders');
  check('force 后订单可见', orders.json.some((o) => o.id === o3.json.id));
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
