// V2 场景测试（隔离运行）：自带临时数据库 + 自建 Excel fixture，绝不触碰生产库
// 用法：node server/test-api-v2.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5199;
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

// ---------- 自建 Excel fixture（结构与《家庭装修全案预算评估表》一致） ----------
async function buildFixture(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('预算评估表');
  ws.addRow(['家庭装修全案预算评估表（测试 fixture）']);
  ws.addRow(['使用说明']);
  const H = ['序号', '项目名称', '规格 / 品牌参考', '单位', '数量', '单价（元）', '总价（元）', '备注'];
  ws.addRow(H);
  // 板块一：硬装 100000
  ws.addRow(['【板块一】硬装施工类（装修公司整包报价）']);
  ws.addRow([1, '硬装施工总价', '由装修公司整包报价，此处只记录总价', '项', 1, 100000, 100000]);
  // 板块二：电器 37296.99，其中三件已买（合计 25849.79）
  ws.addRow(['【板块二】全屋电器类']);
  ws.addRow([2, '冰箱', '米家冰箱pro 法式508L（已买）', '台', 1, 3684.02, 3684.02, 5099]);
  ws.addRow([3, '洗衣机', '米家洗衣机pro（已买）', '台', 1, 2166.77, 2166.77, 2999]);
  ws.addRow([4, '空调', '米家中央空调（已买）', '台', 1, 19999, 19999, 22999]);
  ws.addRow([5, '抽油烟机', '小米智能净烟机3pro', '台', 1, 2447.2, 2447.2, 3119]);
  ws.addRow([6, '晾衣架', '米家智能隐形晾衣架', '', '', '', '', '']);   // 空数量/单价
  ws.addRow(['板块小计']);
  // 板块三：智能 2580（数量>1 场景）
  ws.addRow(['【板块三】全屋智能类']);
  ws.addRow([7, '智能开关面板', '小米智能开关', '个', 20, 129, 2580, '全屋灯光']);
  // 板块四：家具 5158.8（数量 2）
  ws.addRow(['【板块四】家具软装类']);
  ws.addRow([8, '床', '', '张', 2, 2579.4, 5158.8]);
  // 板块五：杂项（全空价格）
  ws.addRow(['【板块五】其他杂费类']);
  ws.addRow([9, '垃圾清运费', '', '车', 1, '', '']);
  // 目标对比
  ws.addRow(['预算目标（元）', '', '', 160000, '输入总预算上限']);
  await wb.xlsx.writeFile(file);
}

const PLAN_TOTAL = 100000 + 3684.02 + 2166.77 + 19999 + 2447.2 + 0 + 2580 + 5158.8 + 0; // 145035.79
const BOUGHT = 3684.02 + 2166.77 + 19999; // 25849.79

// ---------- 启动隔离服务 ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reno-test-'));
const fixturePath = path.join(tmpDir, 'fixture.xlsx');
await buildFixture(fixturePath);

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

// 等待就绪
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(`${BASE}/settings`);
    if (r.ok) { ready = true; break; }
  } catch { /* 尚未启动 */ }
  await new Promise((r) => setTimeout(r, 300));
}
if (!ready) {
  console.error('隔离测试服务启动失败');
  cleanup();
  process.exit(1);
}

let r;
try {
  console.log('== 1. 导入 fixture ==');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(fixturePath)]), 'fixture.xlsx');
  const res = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: fd });
  r = await res.json();
  check('导入成功', res.status === 200, JSON.stringify(r));
  check('5 个板块', r.sections === 5, `sections=${r.sections}`);
  check('目标 16 万', r.target === 160000, `target=${r.target}`);
  check('9 个项目', r.items === 9, `items=${r.items}`);

  console.log('== 2. 清单聚合 ==');
  r = (await req('GET', '/plan')).json;
  check(`清单总计 = ${PLAN_TOTAL.toFixed(2)}`, Math.abs(r.plan_total - PLAN_TOTAL) < 0.5, `plan_total=${r.plan_total}`);
  const sec1 = r.sections.find((s) => s.name.includes('硬装'));
  check('硬装板块小计 10 万', Math.abs(sec1.budget_subtotal - 100000) < 1, `=${sec1.budget_subtotal}`);
  const sec2 = r.sections.find((s) => s.name.includes('电器'));
  check('电器板块小计 28296.99', Math.abs(sec2.budget_subtotal - 28296.99) < 0.5, `=${sec2.budget_subtotal}`);
  const iceBox = sec2.items.find((i) => i.name === '冰箱');
  check('冰箱已买勾选', iceBox?.bought === 1);
  const lamp = sec2.items.find((i) => i.name === '晾衣架');
  check('空数量/单价 → 1 和 0（不再变成 0 数量）', lamp.quantity === 1 && lamp.unit_price === 0, `${lamp.quantity}/${lamp.unit_price}`);
  const switches = r.sections.flatMap((s) => s.items).find((i) => i.name === '智能开关面板');
  check('数量 20 × 129 = 2580', switches.budget_amount === 2580, `=${switches.budget_amount}`);
  check(`实际合计 = 已买三件 ${BOUGHT.toFixed(2)}`, Math.abs(r.actual_total - BOUGHT) < 0.5, `actual_total=${r.actual_total}`);

  console.log('== 3. 手工增改项目 ==');
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '水电改造增项', unit: '项', quantity: 1, unit_price: 3000 });
  check('新增项目', r.status === 200 && r.json.budget_amount === 3000);
  const newItemId = r.json.id;
  r = await req('PUT', `/items/${newItemId}`, { quantity: 2, unit_price: 1500 });
  check('改数量×单价 → 总价仍 3000', r.json.budget_amount === 3000);
  r = await req('PUT', `/items/${newItemId}`, { quantity: -1 });
  check('负数量被拒绝', r.status === 400);
  r = await req('PUT', `/items/${newItemId}`, { bought: true });
  check('勾选已买 → 实际 = 3000', r.json.actual_amount === 3000);
  r = await req('PUT', `/items/${newItemId}`, { bought: false });
  check('取消已买 → 实际归 0', r.json.actual_amount === 0);
  r = await req('DELETE', `/items/${newItemId}`);
  check('删除项目', r.status === 200);

  console.log('== 4. 订单挂项目 ==');
  r = (await req('GET', '/plan')).json;
  const tile = r.sections.flatMap((s) => s.items).find((i) => i.name === '硬装施工总价');
  r = await req('POST', '/orders', { title: '装修公司首期款', vendor: 'XX装饰', item_id: tile.id, total_amount: 100000 });
  check('创建挂项目的订单', r.status === 200 && r.json.item_name === '硬装施工总价');
  const orderId = r.json.id;
  r = await req('POST', `/orders/${orderId}/payments`, { amount: 30000, pay_date: '2026-08-25', method: '银行卡', note: '首期款' });
  check('记付款 3 万', r.status === 200);
  r = await req('POST', `/orders/${orderId}/payments`, { amount: 100, pay_date: '2026-99-99' });
  check('非法日期 2026-99-99 被拒绝', r.status === 400);
  r = (await req('GET', '/plan')).json;
  const tileAfter = r.sections.flatMap((s) => s.items).find((i) => i.name === '硬装施工总价');
  check('订单付款计入项目实际 = 30000', Math.abs(tileAfter.actual_amount - 30000) < 0.5);
  check('order_count / order_paid 反映有效订单', tileAfter.order_count === 1 && Math.abs(tileAfter.order_paid - 30000) < 0.5,
    `${tileAfter.order_count}/${tileAfter.order_paid}`);
  check('实际合计同步', Math.abs(r.actual_total - (BOUGHT + 30000)) < 0.5, `=${r.actual_total}`);
  r = await req('GET', `/orders?item_id=${tile.id}`);
  check('按项目筛选订单', r.json.length === 1 && r.json[0].id === orderId);

  console.log('== 5. 统计与图表 ==');
  r = (await req('GET', '/stats/summary')).json;
  check('summary 板块数 5', r.sections.length === 5);
  check('清单/实际一致', Math.abs(r.plan_total - PLAN_TOTAL) < 0.5 && Math.abs(r.actual_total - (BOUGHT + 30000)) < 0.5);
  r = (await req('GET', '/stats/charts')).json;
  check('板块数据', r.by_section.length === 5 && r.by_section[0].budget > 0);
  check('月度趋势 2026-08 = 30000', r.by_month.some((m) => m.month === '2026-08' && m.amount === 30000));
  check('最近付款含项目名', r.recent_payments[0]?.item_name === '硬装施工总价');

  console.log('== 5b. 一次付清（快速购买） ==');
  const hood0 = (await req('GET', '/plan')).json.sections.flatMap((s) => s.items).find((i) => i.name === '抽油烟机');
  r = await req('POST', '/orders', {
    title: '买抽油烟机', item_id: hood0.id, total_amount: 2447.2,
    paid_now: { amount: 2447.2, pay_date: '2026-08-26', method: '微信' },
  });
  check('一次付清创建成功且自动结清', r.status === 200 && r.json.status === 'closed' && Math.abs(r.json.paid - 2447.2) < 0.01, JSON.stringify(r.json?.status));
  check('返回含首笔付款（前端据此传票据）', r.json.payments?.length === 1 && r.json.payments[0].method === '微信' && r.json.payments[0].note === '一次付清');
  let r5 = (await req('GET', '/plan')).json;
  check('项目实际已计入', Math.abs(r5.sections.flatMap((s) => s.items).find((i) => i.name === '抽油烟机').actual_amount - 2447.2) < 0.5);
  await req('DELETE', `/orders/${r.json.id}`);

  const sw = (await req('GET', '/plan')).json.sections.flatMap((s) => s.items).find((i) => i.name === '智能开关面板');
  r = await req('POST', '/orders', {
    title: '开关面板定金', item_id: sw.id, total_amount: 2580,
    paid_now: { amount: 1000, pay_date: '2026-08-26' },
  });
  check('部分付款（金额<总额）保持进行中', r.status === 200 && r.json.status === 'open' && Math.abs(r.json.paid - 1000) < 0.01, JSON.stringify(r.json?.status));
  await req('DELETE', `/orders/${r.json.id}`);
  r = await req('POST', '/orders', { title: 'x', total_amount: 100, paid_now: { amount: 0, pay_date: '2026-08-26' } });
  check('一次付清零金额被拒绝', r.status === 400);
  r = await req('POST', '/orders', { title: 'x', total_amount: 100, paid_now: { amount: 50, pay_date: '2026-13-01' } });
  check('一次付清非法日期被拒绝', r.status === 400);

  console.log('== 6. 导出 ==');
  const ex = await fetch(`${BASE}/export/excel`);
  const buf = Buffer.from(await ex.arrayBuffer());
  check('导出 xlsx（PK 魔数）', ex.status === 200 && buf.slice(0, 2).toString() === 'PK');

  console.log('== 7. 订单软删/恢复（含 #1 口径修复验证） ==');
  r = await req('DELETE', `/orders/${orderId}`);
  check('软删订单', r.status === 200 && r.json.deleted === true);
  r = (await req('GET', '/orders')).json;
  check('订单列表不再显示', r.length === 0);
  r = (await req('GET', '/plan')).json;
  const tileDel = r.sections.flatMap((s) => s.items).find((i) => i.name === '硬装施工总价');
  check('软删后 order_count=0 / order_paid=0（#1 修复）', tileDel.order_count === 0 && tileDel.order_paid === 0,
    `${tileDel.order_count}/${tileDel.order_paid}`);
  check('软删后实际恢复', Math.abs(r.actual_total - BOUGHT) < 0.5, `=${r.actual_total}`);
  r = await req('POST', `/orders/${orderId}/payments`, { amount: 1, pay_date: '2026-08-25' });
  check('软删订单拒绝再加付款（#10）', r.status === 404);
  r = await req('POST', `/orders/${orderId}/restore`);
  check('恢复订单', r.status === 200 && r.json.paid === 30000);
  r = (await req('GET', '/plan')).json;
  check('恢复后实际回来', Math.abs(r.actual_total - (BOUGHT + 30000)) < 0.5);
  await req('DELETE', `/orders/${orderId}`);

  console.log('== 8. 项目软删/恢复 ==');
  r = (await req('GET', '/plan')).json;
  const hood = r.sections.flatMap((s) => s.items).find((i) => i.name === '抽油烟机');
  r = await req('DELETE', `/items/${hood.id}`);
  check('软删项目', r.status === 200 && r.json.deleted === true);
  r = (await req('GET', '/plan')).json;
  check(`清单总计减少 2447.2`, Math.abs(r.plan_total - (PLAN_TOTAL - 2447.2)) < 1, `=${r.plan_total}`);
  r = await req('POST', `/items/${hood.id}/restore`);
  check('恢复项目', r.status === 200 && r.json.name === '抽油烟机');

  console.log('== 9. 板块软删/恢复（#3） ==');
  r = (await req('GET', '/plan')).json;
  const furn = r.sections.find((s) => s.name.includes('家具'));
  const furnItemCount = furn.items.length;
  r = await req('DELETE', `/sections/${furn.id}`);
  check('软删板块', r.status === 200 && r.json.deleted === true);
  r = (await req('GET', '/plan')).json;
  check('板块从清单消失（4 个）', r.sections.length === 4, `=${r.sections.length}`);
  check(`清单总计减少 5158.8`, Math.abs(r.plan_total - (PLAN_TOTAL - 5158.8)) < 1, `=${r.plan_total}`);
  check('同名板块可新建（UNIQUE 不被占用）', (await req('POST', '/sections', { name: '家具软装类' })).status === 200);
  r = await req('POST', `/sections/${furn.id}/restore`);
  check('恢复板块（名称冲突时加后缀）', r.status === 200 && r.json.deleted === 0 && r.json.name.includes('恢复'));
  r = (await req('GET', '/plan')).json;
  check('板块与项目全部回来（含新建同名 = 6 个）', r.sections.length === 6, `=${r.sections.length}`);
  check('恢复后床的行还在', r.sections.some((s) => s.items?.some((i) => i.name === '床')));

  console.log('== 10. 请求防护（#4） ==');
  let res4 = await fetch(`${BASE}/settings`, { headers: { Origin: 'https://evil.example.com' } });
  check('恶意 Origin 被拒', res4.status === 403, `status=${res4.status}`);
  res4 = await fetch(`${BASE}/settings`, { headers: { Origin: `http://127.0.0.1:${PORT}` } });
  check('本机 Origin 放行', res4.status === 200);
  // fetch 不允许覆盖 Host 头，用原生 http 测 Host 校验
  const hostStatus = await new Promise((resolve) => {
    const hr = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/settings', method: 'GET', headers: { Host: 'evil.example.com' } },
      (res) => { res.resume(); resolve(res.statusCode); },
    );
    hr.on('error', () => resolve(-1));
    hr.end();
  });
  check('非法 Host 被拒', hostStatus === 403, `status=${hostStatus}`);
  const v6Status = await new Promise((resolve) => {
    const hr = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/settings', method: 'GET', headers: { Host: '[fe80::1]:5199' } },
      (res) => { res.resume(); resolve(res.statusCode); },
    );
    hr.on('error', () => resolve(-1));
    hr.end();
  });
  check('IPv6 链路本地 Host 放行', v6Status === 200, `status=${v6Status}`);
  const v6Bad = await new Promise((resolve) => {
    const hr = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/settings', method: 'GET', headers: { Host: '[2600::1]:5199' } },
      (res) => { res.resume(); resolve(res.statusCode); },
    );
    hr.on('error', () => resolve(-1));
    hr.end();
  });
  check('公网 IPv6 Host 仍被拒', v6Bad === 403, `status=${v6Bad}`);
} catch (e) {
  failed++;
  console.error('测试执行异常:', e);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
cleanup();
process.exit(failed ? 1 : 0);
