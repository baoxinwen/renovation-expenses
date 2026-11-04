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

  console.log('== 订单恢复的双算守卫（C2） ==');
  // 评审 C2 的纯 UI 一手路径：误删订单（付款停止计入）→ 给项目勾「已买」
  //（当时付款停计，勾选守卫静默通过）→ 8 秒内点「撤销」恢复订单 → 付款复活，双算落库
  const itemC2 = await req('POST', `/sections/${sec.json.id}/items`,
    { name: '恢复双算项目', quantity: 1, unit_price: 200 });
  const orderC2 = await req('POST', '/orders', {
    title: '恢复双算订单', item_id: itemC2.json.id, total_amount: 80,
    paid_now: { amount: 80, pay_date: '2026-09-03' },
  });
  check('造数：订单已建', orderC2.status === 200, `status=${orderC2.status}`);
  r = await req('DELETE', `/orders/${orderC2.json.id}`);
  check('造数：订单已软删', r.status === 200, `status=${r.status}`);
  // 删除期间付款停计：勾选守卫看到的 orderPaid=0，静默通过（现状即如此，属 C2 入口）
  r = await req('PUT', `/items/${itemC2.json.id}`, { bought: true });
  check('软删订单后勾已买静默通过', r.status === 200, `status=${r.status} ${JSON.stringify(r.json)}`);
  // 恢复订单会让 80 元付款复活并叠加进项目实际（200 + 80 = 280 双算）
  r = await req('POST', `/orders/${orderC2.json.id}/restore`);
  check('恢复挂已买项目的订单未带 force → 409', r.status === 409, `status=${r.status}`);
  check('返回 needForce 标志', r.json?.needForce === true, JSON.stringify(r.json));
  const planC2 = await req('GET', '/plan');
  const itC2 = planC2.json.sections.flatMap((s) => s.items).find((i) => i.id === itemC2.json.id);
  check('409 时未恢复：项目实际仍为 200（无双算）',
    Math.abs(itC2.actual_amount - 200) < 0.01, `actual=${itC2?.actual_amount}`);
  // 未挂项目的订单恢复不受守卫影响（无双算可能）
  const loose = await req('POST', '/orders', {
    title: '散单恢复', total_amount: 20, paid_now: { amount: 20, pay_date: '2026-09-04' },
  });
  await req('DELETE', `/orders/${loose.json.id}`);
  r = await req('POST', `/orders/${loose.json.id}/restore`);
  check('未挂项目的订单恢复放行', r.status === 200, `status=${r.status}`);
  // force（用户确认双算）→ 放行，实际合计变为 280（显式选择）
  r = await req('POST', `/orders/${orderC2.json.id}/restore`, { force: true });
  check('带 force（用户已确认）→ 放行', r.status === 200, `status=${r.status}`);
  const planC2b = await req('GET', '/plan');
  const itC2b = planC2b.json.sections.flatMap((s) => s.items).find((i) => i.id === itemC2.json.id);
  check('force 后项目实际 = 200 + 80（显式双算）',
    Math.abs(itC2b.actual_amount - 280) < 0.01, `actual=${itC2b.actual_amount}`);

  console.log('== 付款入口的双算守卫（r2 C1：先勾已买后付款） ==');
  // 未买项目建订单（付款 0）→ 清单勾「已买」（此刻 orderPaid=0 静默通过）→
  // 之后记首笔付款——POST /payments 若无守卫，双算静默落库（与 restore 同类的时序洞）
  const itemP = await req('POST', `/sections/${sec.json.id}/items`,
    { name: '后付款项目', quantity: 1, unit_price: 300 });
  const orderP = await req('POST', '/orders', {
    title: '后付款订单', item_id: itemP.json.id, total_amount: 120,
  });
  check('造数：未买项目建订单（无付款）', orderP.status === 200, `status=${orderP.status}`);
  r = await req('PUT', `/items/${itemP.json.id}`, { bought: true });
  check('造数：勾已买（付款 0 静默通过）', r.status === 200, `status=${r.status}`);
  r = await req('POST', `/orders/${orderP.json.id}/payments`, { amount: 120, pay_date: '2026-09-05' });
  check('先勾已买后付款 → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.json)}`);
  check('返回 needForce 标志', r.json?.needForce === true, JSON.stringify(r.json));
  check('409 时付款未落库', (await req('GET', `/orders/${orderP.json.id}`)).json.paid === 0);
  r = await req('POST', `/orders/${orderP.json.id}/payments`,
    { amount: 120, pay_date: '2026-09-05', force: true });
  check('force（用户确认双算）→ 放行', r.status === 200, `status=${r.status}`);
  const planP = await req('GET', '/plan');
  const itP = planP.json.sections.flatMap((s) => s.items).find((i) => i.id === itemP.json.id);
  check('显式双算：项目实际 = 300 + 120', Math.abs(itP.actual_amount - 420) < 0.01, `actual=${itP.actual_amount}`);
  // 已买→已买（第二次付款）不受守卫影响：第一次付款已让用户面对过双算
  r = await req('POST', `/orders/${orderP.json.id}/payments`, { amount: 20, pay_date: '2026-09-06', force: true });
  check('后续付款（已处于显式双算态，仍需 force）放行', r.status === 200, `status=${r.status}`);
  // 未买项目的订单付款不受守卫影响
  const itemP2 = await req('POST', `/sections/${sec.json.id}/items`,
    { name: '后付款未买项目', quantity: 1, unit_price: 50 });
  const orderP2 = await req('POST', '/orders', {
    title: '后付款未买订单', item_id: itemP2.json.id, total_amount: 30,
  });
  r = await req('POST', `/orders/${orderP2.json.id}/payments`, { amount: 30, pay_date: '2026-09-06' });
  check('未买项目付款放行', r.status === 200, `status=${r.status}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
