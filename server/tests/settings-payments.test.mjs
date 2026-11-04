// 零测试面端点补覆盖（I4/I5）：预算目标唯一写入端点 PUT /settings 与付款金额
// 修正路径 PUT /payments/:id。两者都是金额/校验路径，坏值静默落库会污染
// 预算目标、项目实际、板块小计、by_month/by_day 与导出口径且无测试兜底。
// 补覆盖性质：现状行为正确，用例写完即绿，价值在防回归。
// 隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5232;
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-settings-pay-test-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  console.log('== I4 PUT /settings ==');
  let r = await req('PUT', '/settings', { total_budget: 160000 });
  check('有效值写入 200', r.status === 200 && r.json?.ok === true, `status=${r.status} ${JSON.stringify(r.json)}`);
  r = await req('GET', '/settings');
  check('GET 回读一致', r.json?.total_budget === 160000, JSON.stringify(r.json));

  r = await req('PUT', '/settings', { total_budget: 180000.5 });
  check('覆盖写入 200', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/settings');
  check('upsert 生效（第二次覆盖第一次，非静默丢写）', r.json?.total_budget === 180000.5, JSON.stringify(r.json));

  r = await req('PUT', '/settings', { total_budget: -1 });
  check('负数 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', '/settings', { total_budget: 'abc' });
  check('非数字 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', '/settings', {});
  check('缺字段 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', '/settings', { total_budget: 0 });
  check('0 是合法非负值', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/settings');
  check('坏值被拒后目标未被污染', r.json?.total_budget === 0, JSON.stringify(r.json));

  console.log('== I5 PUT /payments/:id ==');
  const sec = await req('POST', '/sections', { name: '补覆盖板块' });
  const item = await req('POST', `/sections/${sec.json.id}/items`, { name: '补覆盖项目', quantity: 1, unit_price: 1000 });
  const order = await req('POST', '/orders', { title: '补覆盖订单', item_id: item.json.id, total_amount: 500 });
  const pay = await req('POST', `/orders/${order.json.id}/payments`, { amount: 100, pay_date: '2026-11-01', method: '微信', note: '定金' });
  check('造数：付款已建', pay.status === 200 && !!pay.json?.id, JSON.stringify(pay.json));

  r = await req('PUT', `/payments/${pay.json.id}`, { amount: 80 });
  check('修正金额生效', r.status === 200 && r.json?.amount === 80, `status=${r.status} ${JSON.stringify(r.json)}`);
  r = await req('GET', `/orders/${order.json.id}`);
  check('订单已付联动（paid = 80）', r.json?.paid === 80, JSON.stringify({ paid: r.json?.paid }));

  r = await req('PUT', `/payments/${pay.json.id}`, { note: '定金改尾款' });
  check('部分更新：只改 note，金额/日期/方式保留',
    r.json?.amount === 80 && r.json?.pay_date === '2026-11-01' && r.json?.method === '微信' && r.json?.note === '定金改尾款',
    JSON.stringify(r.json));

  r = await req('PUT', `/payments/${pay.json.id}`, { amount: -30, note: '部分退款' });
  check('负数金额合法（退款语义）', r.status === 200 && r.json?.amount === -30, `status=${r.status}`);

  r = await req('PUT', `/payments/${pay.json.id}`, { amount: 0 });
  check('金额 0 拒绝 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', `/payments/${pay.json.id}`, { pay_date: '2026-99-99' });
  check('非真实日期拒绝 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', `/payments/${pay.json.id}`, { amount: 'abc' });
  check('非数字金额拒绝 400', r.status === 400, `status=${r.status}`);

  const order2 = await req('POST', '/orders', { title: '将被软删的订单', total_amount: 50 });
  const pay2 = await req('POST', `/orders/${order2.json.id}/payments`, { amount: 10, pay_date: '2026-11-02' });
  await req('DELETE', `/orders/${order2.json.id}`);
  r = await req('PUT', `/payments/${pay2.json.id}`, { amount: 20 });
  check('软删订单的付款 404', r.status === 404, `status=${r.status}`);
  r = await req('PUT', '/payments/999999', { amount: 1 });
  check('不存在的付款 404', r.status === 404, `status=${r.status}`);

  console.log('== M4 订单 item_id 非法值 ==');
  r = await req('POST', '/orders', { title: '非法挂接', total_amount: 10, item_id: 'abc' });
  check('POST item_id 非数字 400（不再误导为「项目不存在」）', r.status === 400, `status=${r.status} ${JSON.stringify(r.json)}`);
  r = await req('PUT', `/orders/${order.json.id}`, { item_id: 'abc' });
  check('PUT item_id 非数字 400', r.status === 400, `status=${r.status}`);
  r = await req('GET', `/orders/${order.json.id}`);
  check('非法值未落库（挂接不变）', r.json?.item_id === item.json.id, JSON.stringify({ item_id: r.json?.item_id }));

  console.log('== I4 付款近重复守卫（超时重试防双记） ==');
  const dupOrder = await req('POST', '/orders', { title: '重复付款订单', total_amount: 500 });
  const firstPay = await req('POST', `/orders/${dupOrder.json.id}/payments`, { amount: 200, pay_date: '2026-11-04' });
  check('造数：首笔付款 200', firstPay.status === 200, `status=${firstPay.status}`);
  r = await req('POST', `/orders/${dupOrder.json.id}/payments`, { amount: 200, pay_date: '2026-11-04' });
  check('同订单同金额同日期 → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.json)}`);
  check('返回 needForce 标志', r.json?.needForce === true, JSON.stringify(r.json));
  check('拦截时未落库（仍一笔）', (await req('GET', `/orders/${dupOrder.json.id}`)).json.paid === 200);
  r = await req('POST', `/orders/${dupOrder.json.id}/payments`, { amount: 200, pay_date: '2026-11-04', force: true });
  check('force（真实两笔同日同额）→ 放行', r.status === 200, `status=${r.status}`);
  check('此时合计 400（两笔）', (await req('GET', `/orders/${dupOrder.json.id}`)).json.paid === 400);
  r = await req('POST', `/orders/${dupOrder.json.id}/payments`, { amount: 200, pay_date: '2026-11-05' });
  check('同金额不同日期放行（真实分期）', r.status === 200, `status=${r.status}`);
  r = await req('POST', `/orders/${dupOrder.json.id}/payments`, { amount: 100, pay_date: '2026-11-04' });
  check('同日期不同金额放行', r.status === 200, `status=${r.status}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
