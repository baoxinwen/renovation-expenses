// API 场景测试（隔离运行）：自带临时数据库 + 自建 Excel fixture，绝不触碰生产库
// 用法：node server/tests/api.test.mjs
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-api-test-'));
const fixturePath = path.join(tmpDir, 'fixture.xlsx');
await buildFixture(fixturePath);

// 就绪判定凭就绪标记 + 子进程存活（端口被外部实例占用时快速失败，不误测外部实例——
// api.test 含 mode=replace 全量导入，误测外部实例会破坏其真实数据）
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) {
  console.error('隔离测试服务启动失败（端口可能被占用）');
  cleanup();
  process.exit(1);
}

let r;
try {
  console.log('== 0. 空库统计边界 ==');
  r = (await req('GET', '/stats/charts')).json;
  check('空库 by_day 为空数组', Array.isArray(r.by_day) && r.by_day.length === 0, JSON.stringify(r.by_day));

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

  console.log('== 3b. 添加项目边界（UI 添加入口走同一 API） ==');
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '   ' });
  check('纯空白名称被拒绝', r.status === 400, `status=${r.status}`);
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '负数量项目', quantity: -0.5 });
  check('负数量被拒绝', r.status === 400, `status=${r.status}`);
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '负单价项目', unit_price: -1 });
  check('负单价被拒绝', r.status === 400, `status=${r.status}`);
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '零值项目', quantity: 0, unit_price: 0 });
  check('数量/单价为 0 合法（未买先登记）', r.status === 200 && r.json.quantity === 0 && r.json.unit_price === 0,
    `status=${r.status}`);
  const zeroItemId = r.json.id;
  r = await req('POST', '/sections/999999/items', { name: '孤儿项目' });
  check('不存在的板块 → 404', r.status === 404, `status=${r.status}`);
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '边界项目', spec: '规格', unit: '件', quantity: 2.5, unit_price: 12.34, note: '备注' });
  check('全字段添加成功且数量单价如实返回', r.status === 200 && r.json.quantity === 2.5 && Math.abs(r.json.unit_price - 12.34) < 0.001,
    `status=${r.status}`);
  r = (await req('GET', '/plan')).json;
  const boundaryItem = r.sections.flatMap((s) => s.items).find((i) => i.name === '边界项目');
  check('清单可见且预算 = 数量×单价（2.5×12.34=30.85）',
    !!boundaryItem && Math.abs(boundaryItem.budget_amount - 30.85) < 0.001, `budget=${boundaryItem?.budget_amount}`);
  await req('DELETE', `/items/${boundaryItem.id}`);
  await req('DELETE', `/items/${zeroItemId}`);

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
  // 板块小计契约字段必须是 budget_subtotal/actual_subtotal（分析页表格 dataIndex 依赖；
  // 曾经的重构把 SQL 别名改成 budget/actual 导致前端小计全为 0）
  const sumHard = r.sections.find((s) => s.name.includes('硬装'));
  check('硬装板块 budget_subtotal = 10 万', Math.abs(sumHard.budget_subtotal - 100000) < 1, `=${sumHard.budget_subtotal}`);
  check('硬装板块 actual_subtotal = 订单付款 3 万', Math.abs(sumHard.actual_subtotal - 30000) < 0.5, `=${sumHard.actual_subtotal}`);
  const sumElec = r.sections.find((s) => s.name.includes('电器'));
  check('电器板块 budget_subtotal = 28296.99', Math.abs(sumElec.budget_subtotal - 28296.99) < 0.5, `=${sumElec.budget_subtotal}`);
  check('电器板块 actual_subtotal = 已买三件（实付回退数量×单价）',
    Math.abs(sumElec.actual_subtotal - BOUGHT) < 0.5, `=${sumElec.actual_subtotal}`);
  const sumMisc = r.sections.find((s) => s.name.includes('其他'));
  check('零价板块小计为数字 0（字段存在，非 undefined）',
    sumMisc.budget_subtotal === 0 && sumMisc.actual_subtotal === 0,
    JSON.stringify({ b: sumMisc.budget_subtotal, a: sumMisc.actual_subtotal }));
  check('板块小计之和 = 清单/实际总计（口径一致）',
    Math.abs(r.sections.reduce((s, x) => s + x.budget_subtotal, 0) - r.plan_total) < 0.5
    && Math.abs(r.sections.reduce((s, x) => s + x.actual_subtotal, 0) - r.actual_total) < 0.5);
  r = (await req('GET', '/stats/charts')).json;
  check('板块数据', r.by_section.length === 5 && r.by_section[0].budget > 0);
  check('月度趋势 2026-08 = 30000', r.by_month.some((m) => m.month === '2026-08' && m.amount === 30000));
  check('最近付款含项目名', r.recent_payments[0]?.item_name === '硬装施工总价');
  // by_day：热力图数据源，与 by_month 同源同口径仅按日分组（契约先行，2026-10 分析页增强）
  check('by_day 按 2026-08-25 聚合硬装付款 30000',
    r.by_day.some((d) => d.date === '2026-08-25' && d.amount === 30000), JSON.stringify(r.by_day));
  const daySumByMonth = {};
  r.by_day.forEach((d) => { daySumByMonth[d.date.slice(0, 7)] = (daySumByMonth[d.date.slice(0, 7)] ?? 0) + d.amount; });
  check('by_day 按月聚合与 by_month 逐月一致（口径互检）',
    r.by_month.every((m) => Math.abs((daySumByMonth[m.month] ?? 0) - m.amount) < 0.01)
    && Object.keys(daySumByMonth).length === r.by_month.length,
    JSON.stringify({ day: daySumByMonth, month: r.by_month }));
  // 退款负数冲抵（spec 第 7 章点名的 by_day 口径断言；验完即删，不污染后续 paid 断言）
  r = await req('POST', `/orders/${orderId}/payments`, { amount: -200, pay_date: '2026-08-25', note: '测试退款' });
  check('记退款 -200', r.status === 200);
  const refundId = r.json.id;
  r = (await req('GET', '/stats/charts')).json;
  check('by_day 退款当日冲抵为 29800',
    r.by_day.some((d) => d.date === '2026-08-25' && Math.abs(d.amount - 29800) < 0.01), JSON.stringify(r.by_day));
  r = await req('DELETE', `/payments/${refundId}`);
  check('清理测试退款', r.status === 200);

  console.log('== 5a-b. 已买现金流口径（I1：paid_amount 优先于数量×单价） ==');
  const secI1 = (await (await req('GET', '/plan')).json).sections[0];
  r = await req('POST', `/sections/${secI1.id}/items`, { name: 'I1口径哨兵', quantity: 2, unit_price: 1000 });
  const i1Id = r.json?.id;
  check('造数：I1 哨兵项目（数量×单价 = 2000）', r.status === 200 && !!i1Id, `status=${r.status}`);
  r = await req('PUT', `/items/${i1Id}`, { bought: true, paid_amount: 1900, bought_date: '2026-07-15' });
  check('登记已买并登记实付 1900（抹零场景）', r.status === 200, `status=${r.status}`);
  r = (await req('GET', '/stats/charts')).json;
  check('by_month 2026-07 记实付 1900', r.by_month.some((m) => m.month === '2026-07' && Math.abs(m.amount - 1900) < 0.01),
    JSON.stringify(r.by_month.filter((m) => m.month === '2026-07')));
  check('by_month 2026-07 不按数量×单价记 2000', !r.by_month.some((m) => m.month === '2026-07' && Math.abs(m.amount - 2000) < 0.01));
  check('by_day 2026-07-15 记实付 1900', r.by_day.some((d) => d.date === '2026-07-15' && Math.abs(d.amount - 1900) < 0.01),
    JSON.stringify(r.by_day.filter((d) => d.date === '2026-07-15')));
  check('by_day 2026-07-15 不含 2000', !r.by_day.some((d) => d.date === '2026-07-15' && Math.abs(d.amount - 2000) < 0.01));
  r = await req('DELETE', `/items/${i1Id}`);
  check('清理 I1 哨兵（验完即删）', r.status === 200);

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

  console.log('== 5c. 购买登记（预算/实付分离：预算不动，实付单记） ==');
  const lamp2 = (await req('GET', '/plan')).json.sections.flatMap((s) => s.items).find((i) => i.name === '智能开关面板');
  // 调整预算单价：纯预算行为，无任何基线/漂移副作用
  r = await req('PUT', `/items/${lamp2.id}`, { unit_price: 150 });  // 129 → 150
  check('调整预算单价 → 单价与预算合计随之更新', r.json.unit_price === 150 && r.json.budget_amount === 3000,
    `=${r.json.unit_price}/${r.json.budget_amount}`);
  // 购买登记：登记实付金额，预算合计不受影响
  r = await req('PUT', `/items/${lamp2.id}`, { bought: true, paid_amount: 3000, bought_date: '2026-08-26' });
  check('购买登记成功（已买+日期）', r.json.bought === 1 && r.json.bought_date === '2026-08-26');
  check('实付金额如实记录', r.json.paid_amount === 3000, JSON.stringify(r.json.paid_amount));
  check('预算合计不受购买影响（仍 20×150=3000）', r.json.budget_amount === 3000, `=${r.json.budget_amount}`);
  check('实际 = 登记实付 3000（而非单价×数量）', Math.abs(r.json.actual_amount - 3000) < 0.5, `=${r.json.actual_amount}`);
  r = await req('PUT', `/items/${lamp2.id}`, { bought_date: '2026-13-01' });
  check('非法购买日期被拒绝', r.status === 400);
  // 实付可单独修正（抹零/砍价后补记），预算依旧不动
  r = await req('PUT', `/items/${lamp2.id}`, { paid_amount: 2300 });
  check('实付金额可单独修正', r.json.paid_amount === 2300 && Math.abs(r.json.actual_amount - 2300) < 0.5,
    `=${r.json.paid_amount}/${r.json.actual_amount}`);
  r = await req('PUT', `/items/${lamp2.id}`, { paid_amount: -1 });
  check('负实付金额被拒绝', r.status === 400, `status=${r.status}`);
  // 未填实付 → 实际回退 数量×单价（兼容只勾已买不填金额的用法）
  r = await req('POST', `/sections/${sec1.id}/items`, { name: '回退校验项目', quantity: 2, unit_price: 100 });
  const fallbackId = r.json.id;
  r = await req('PUT', `/items/${fallbackId}`, { bought: true, bought_date: '2026-08-27' });
  check('未填实付 → 实际回退 数量×单价 = 200', Math.abs(r.json.actual_amount - 200) < 0.5, `=${r.json.actual_amount}`);
  // 月度趋势含已买：2026-08 应有已买支出（基线测试中硬装订单付款 30000 也在 08）
  r = (await req('GET', '/stats/charts')).json;
  const aug = r.by_month.find((m) => m.month === '2026-08');
  // 08 = 硬装 30000 + 开关实付修正后 2300（I1：现金流跟实付，不再按数量×单价 3000）
  //      + 回退项 200（未填实付）；一次付清抽油烟机已软删不计
  check('月度趋势 08 = 30000 + 实付修正 2300 + 回退 200（I1 口径）',
    aug && Math.abs(aug.amount - 32500) < 0.01, JSON.stringify(aug));
  // 取消已买：实付与日期一并清空，状态回滚干净
  r = await req('PUT', `/items/${lamp2.id}`, { bought: false });
  check('取消已买 → 实付/日期清空、实际归 0',
    r.json.bought === 0 && r.json.paid_amount === null && r.json.bought_date === null && r.json.actual_amount === 0,
    JSON.stringify({ p: r.json.paid_amount, d: r.json.bought_date, a: r.json.actual_amount }));
  await req('DELETE', `/items/${fallbackId}`);
  await req('PUT', `/items/${lamp2.id}`, { unit_price: 129 }); // 还原

  console.log('== 5c+. 双算 force 守卫 ==');
  const sw2 = (await req('GET', '/plan')).json.sections.flatMap((s) => s.items).find((i) => i.name === '智能开关面板');
  const guardOrder = (await req('POST', '/orders', {
    title: '守卫测试', item_id: sw2.id, total_amount: 2580,
    paid_now: { amount: 2580, pay_date: '2026-08-26' },
  })).json;
  r = await req('PUT', `/items/${sw2.id}`, { bought: true });
  check('有订单付款时勾已买 → 409', r.status === 409 && r.json.needForce === true, JSON.stringify(r.json));
  r = await req('PUT', `/items/${sw2.id}`, { bought: true, force: true });
  check('force:true 放行', r.status === 200 && r.json.bought === 1);
  await req('PUT', `/items/${sw2.id}`, { bought: false });
  await req('DELETE', `/orders/${guardOrder.id}`);

  console.log('== 6. 导出 ==');
  const ex = await fetch(`${BASE}/export/excel`);
  const buf = Buffer.from(await ex.arrayBuffer());
  check('导出 xlsx（PK 魔数）', ex.status === 200 && buf.slice(0, 2).toString() === 'PK');

  // 票据 zip 导出
  let zipRes = await fetch(`${BASE}/export/receipts`);
  check('无票据时 zip 返回 404', zipRes.status === 404);
  const od = await req('POST', '/orders', { title: '票据测试', total_amount: 100, paid_now: { amount: 100, pay_date: '2026-08-26' } });
  const payId = od.json.payments[0].id;
  const pngFd = new FormData();
  pngFd.append('files', new Blob([Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64',
  )], { type: 'image/png' }), 'p.png');
  const upRes = await fetch(`${BASE}/payments/${payId}/receipts`, { method: 'POST', body: pngFd });
  check('上传测试票据', upRes.status === 200);
  zipRes = await fetch(`${BASE}/export/receipts?order_id=${od.json.id}`);
  const zb = Buffer.from(await zipRes.arrayBuffer());
  check('票据 zip 导出（PK 魔数）', zipRes.status === 200 && zb.slice(0, 2).toString() === 'PK', `status=${zipRes.status}`);
  check('zip 含票据清单与图片条目', zb.length > 500);
  await req('DELETE', `/orders/${od.json.id}`);

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

  console.log('== 10b. 导出→再导入 round-trip（H4） ==');
  const exBuf = Buffer.from(await (await fetch(`${BASE}/export/excel`)).arrayBuffer());
  const rtFd = new FormData();
  rtFd.append('file', new Blob([exBuf]), 'roundtrip.xlsx');
  const rtRes = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: rtFd });
  const rt = await rtRes.json();
  check('round-trip 导入成功', rtRes.status === 200, JSON.stringify(rt));
  check('round-trip 板块结构保留', rt.sections === 5, `=${rt.sections}`);
  check('round-trip 预算目标保留', rt.target === 160000, `=${rt.target}`);
  check('round-trip 项目数保留', rt.items === 9, `=${rt.items}`);
  r = (await req('GET', '/plan')).json;
  check(`round-trip 清单总计一致（${PLAN_TOTAL.toFixed(2)}）`, Math.abs(r.plan_total - PLAN_TOTAL) < 1, `=${r.plan_total}`);
  check('round-trip 已买语义保留（冰箱已勾）', r.sections.flatMap((s) => s.items).some((i) => i.name === '冰箱' && i.bought === 1));
  // 契约面断言：导出前后已买项目集合一致（防"恰好备注带字样"的巧合覆盖——
  // 2026-10 实测：备注无「已买」字样的 ✓ 专列项目导入即丢）
  const boughtBefore = new Set((await req('GET', '/plan')).json.sections.flatMap((s) => s.items ?? []).filter((i) => i.bought === 1).map((i) => i.name));
  const boughtAfter = new Set(r.sections.flatMap((s) => s.items ?? []).filter((i) => i.bought === 1).map((i) => i.name));
  const sameSet = boughtBefore.size === boughtAfter.size && [...boughtBefore].every((n) => boughtAfter.has(n));
  check(`round-trip 已买集合一致（${boughtBefore.size} 项）`, sameSet, `前[${[...boughtBefore]}] 后[${[...boughtAfter]}]`);

  console.log('== 10c. 文件内重名板块合并（M9） ==');
  const dupWb = new ExcelJS.Workbook();
  const dupWs = dupWb.addWorksheet('S');
  dupWs.addRow(['序号', '项目名称', '规格', '单位', '数量', '单价（元）', '总价（元）', '备注']);
  dupWs.addRow(['【板块X】重复板块', '', '', '', '', '', '', '']);
  dupWs.addRow([1, '甲物', '', '件', 1, 100, 100]);
  dupWs.addRow(['【板块X】重复板块', '', '', '', '', '', '', '']);
  dupWs.addRow([2, '乙物', '', '件', 1, 200, 200]);
  const dupPath = path.join(tmpDir, 'dup.xlsx');
  await dupWb.xlsx.writeFile(dupPath);
  const dupFd = new FormData();
  dupFd.append('file', new Blob([fs.readFileSync(dupPath)]), 'dup.xlsx');
  const dupRes = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: dupFd });
  const dup = await dupRes.json();
  check('重名板块导入不 500', dupRes.status === 200, JSON.stringify(dup).slice(0, 80));
  r = (await req('GET', '/plan')).json;
  check('重名板块合并为 1 个且两项都在',
    r.sections.filter((s) => s.name.includes('重复板块')).length === 1
    && r.sections.flatMap((s) => s.items).filter((i) => ['甲物', '乙物'].includes(i.name)).length === 2);
  // 还原现场：重新导入主 fixture
  const fdRestore = new FormData();
  fdRestore.append('file', new Blob([fs.readFileSync(fixturePath)]), 'fixture.xlsx');
  await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: fdRestore });

  console.log('== 10e. 导入还原已买列（导出契约：已买专列 ✓，2026-10 用户实测丢已买） ==');
  // 复现用户场景：已买写在独立「已买」列（本系统导出格式），备注/规格无「已买」字样。
  // 修复前导入只认备注/规格文本，✓ 列被无视 → 已买状态与实付金额全部丢失。
  const boughtWb = new ExcelJS.Workbook();
  const boughtWs = boughtWb.addWorksheet('预算评估表');
  boughtWs.addRow(['序号', '项目名称', '规格 / 品牌', '单位', '数量', '单价（元）', '总预算（元）', '实际支付（元）', '已买', '备注']);
  boughtWs.addRow(['【测试板块T】']);
  boughtWs.addRow([1, '甲项（✓列已买）', '', '件', 1, 100, null, 50, '✓', '']);            // ✓ 列已买 + 备注无字样
  boughtWs.addRow([2, '乙项（文本已买）', '', '件', 1, 200, null, 80, '', '二手已买']);      // ✓ 列空 + 备注含字样（旧表兼容）
  boughtWs.addRow([3, '丙项（未买）', '', '件', 1, 300, null, null, '', '']);               // 全空：未买
  boughtWs.addRow([4, '丁项（✓列未买但备注有字样）', '', '件', 1, 400, null, null, '', '还没买']); // 备注"还没买"不含"已买" → 未买
  const boughtPath = path.join(tmpDir, 'bought-col.xlsx');
  await boughtWb.xlsx.writeFile(boughtPath);
  const bFd = new FormData();
  bFd.append('file', new Blob([fs.readFileSync(boughtPath)]), 'bought-col.xlsx');
  const bRes = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: bFd });
  const bJson = await bRes.json();
  check('已买列文件导入成功', bRes.status === 200, JSON.stringify(bJson));
  r = (await req('GET', '/plan')).json;
  const bItems = Object.fromEntries(r.sections.flatMap((s) => s.items ?? []).map((i) => [i.name.split('（')[0], i]));
  check('✓ 列已买还原（甲项）', bItems['甲项']?.bought === 1, `bought=${bItems['甲项']?.bought}`);
  check('✓ 列已买实付入库（甲项 50）', Math.abs(bItems['甲项']?.paid_amount - 50) < 0.01, `paid=${bItems['甲项']?.paid_amount}`);
  check('备注文本已买兼容还原（乙项）', bItems['乙项']?.bought === 1, `bought=${bItems['乙项']?.bought}`);
  check('文本已买实付入库（乙项 80）', Math.abs(bItems['乙项']?.paid_amount - 80) < 0.01, `paid=${bItems['乙项']?.paid_amount}`);
  check('全空行未买（丙项）', bItems['丙项']?.bought === 0 && bItems['丙项']?.paid_amount === null,
    `${bItems['丙项']?.bought}/${bItems['丙项']?.paid_amount}`);
  check('「还没买」不误判为已买（丁项）', bItems['丁项']?.bought === 0, `bought=${bItems['丁项']?.bought}`);
  // 还原现场（FormData 里的 Blob 不可变，可重复提交）
  await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: fdRestore });

  console.log('== 10d. 软删边界（M10） ==');
  // ③ 订单不可挂软删项目
  r = (await req('GET', '/plan')).json;
  const lamp3 = r.sections.flatMap((s) => s.items).find((i) => i.name === '智能开关面板');
  await req('DELETE', `/items/${lamp3.id}`);
  r = await req('POST', '/orders', { title: '挂软删项目', item_id: lamp3.id, total_amount: 10 });
  check('创建订单挂软删项目被拒（400）', r.status === 400, `=${r.status}`);
  // ② PUT 软删资源返回 404
  r = await req('PUT', `/items/${lamp3.id}`, { name: '改名' });
  check('PUT 软删项目返回 404', r.status === 404, `=${r.status}`);
  // ① 孤儿恢复：删项目→删板块→恢复项目→板块连带恢复
  r = (await req('GET', '/plan')).json;
  const bed = r.sections.flatMap((s) => s.items).find((i) => i.name === '床');
  const furnSec = r.sections.find((s) => s.name.includes('家具'));
  await req('DELETE', `/items/${bed.id}`);
  await req('DELETE', `/sections/${furnSec.id}`);
  r = (await req('GET', '/plan')).json;
  check('板块+项目删除后清单 4 板块', r.sections.length === 4, `=${r.sections.length}`);
  r = await req('POST', `/items/${bed.id}/restore`);
  check('恢复项目成功', r.status === 200);
  r = (await req('GET', '/plan')).json;
  check('所属板块连带恢复（无孤儿，5 板块）', r.sections.length === 5, `=${r.sections.length}`);
  check('床回到清单', r.sections.flatMap((s) => s.items).some((i) => i.name === '床'));

  // by_month 口径：软删项目的挂单付款不计入月度趋势（by_day 与 by_month 同口径，一并断言）
  r = await req('POST', '/orders', { title: '口径测试单', item_id: bed.id, total_amount: 500 });
  const kjOrderId = r.json.id;
  await req('POST', `/orders/${kjOrderId}/payments`, { amount: 500, pay_date: '2026-07-01' });
  let charts1 = (await req('GET', '/stats/charts')).json;
  check('口径基准：07 月含 500', charts1.by_month.some((m) => m.month === '2026-07' && m.amount === 500), JSON.stringify(charts1.by_month));
  check('口径基准：by_day 07-01 含 500', charts1.by_day.some((d) => d.date === '2026-07-01' && d.amount === 500), JSON.stringify(charts1.by_day));
  await req('DELETE', `/items/${bed.id}`);
  let charts2 = (await req('GET', '/stats/charts')).json;
  check('软删项目后 07 月付款剔除（M1 口径统一）', !charts2.by_month.some((m) => m.month === '2026-07'), JSON.stringify(charts2.by_month));
  check('软删项目后 by_day 07-01 同步剔除', !charts2.by_day.some((d) => d.date === '2026-07-01'), JSON.stringify(charts2.by_day));
  await req('POST', `/items/${bed.id}/restore`);
  let charts3 = (await req('GET', '/stats/charts')).json;
  check('恢复项目后 07 月回来', charts3.by_month.some((m) => m.month === '2026-07' && m.amount === 500));
  check('恢复项目后 by_day 07-01 回来', charts3.by_day.some((d) => d.date === '2026-07-01' && d.amount === 500));
  await req('DELETE', `/orders/${kjOrderId}`);
  await req('POST', `/items/${bed.id}/restore`);

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

  console.log('== M19 现金流口径不对称（未挂付款进趋势不进 actual_total） ==');
  // 口径事实（PRD §2）：actual_total 只含清单内实际；by_month/by_day 额外含
  // 未挂项目付款（真实现金流）。此处钉住不对称本身，防 UNION 误加 WHERE
  r = await req('POST', '/orders', { title: 'M19未挂订单', total_amount: 777, paid_now: { amount: 777, pay_date: '2026-10-20' } });
  check('造数：未挂项目订单付款 777', r.status === 200, `status=${r.status}`);
  const sumM19 = (await (await req('GET', '/stats/summary')).json);
  const chartsM19 = (await (await req('GET', '/stats/charts')).json);
  const octM19 = chartsM19.by_month.find((m) => m.month === '2026-10');
  check('actual_total 不含未挂付款', Math.abs(sumM19.actual_total - sumM19.sections.reduce((s, x) => s + x.actual_subtotal, 0)) < 0.5,
    `actual=${sumM19.actual_total} sections=${sumM19.sections.reduce((s, x) => s + x.actual_subtotal, 0)}`);
  check('by_month 含未挂付款（真实现金流）', octM19 && Math.abs(octM19.amount - 777) < 0.01,
    JSON.stringify(chartsM19.by_month.filter((m) => m.month === '2026-10')));
  check('unassigned_paid 单独暴露', Math.abs(sumM19.unassigned_paid - 777) < 0.01, JSON.stringify(sumM19.unassigned_paid));
  r = await req('DELETE', `/orders/${r.json.id}`);
  check('清理 M19 订单', r.status === 200);

  console.log('== M1 import mode 显式非法值 ==');
  // 放在测试链末尾：修复回退时 appned 会被静默按 replace 执行清空清单，
  // 此时本文件已无比后续数据依赖的断言
  r = await req('POST', '/plan/import?mode=appned', undefined);
  check('mode 拼错回 400（不再静默按 replace 清空）',
    r.status === 400 && !r.json?.ok, `status=${r.status} resp=${JSON.stringify(r.json)}`);

  console.log('== M24 导入早退中文提示 ==');
  const badExtFd = new FormData();
  badExtFd.append('file', new Blob([new Uint8Array([0x50, 0x4b])]), 'not-excel.txt');
  const badExtRes = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: badExtFd });
  r = { status: badExtRes.status, json: await badExtRes.json().catch(() => null) };
  check('扩展名不符 400 且中文提示', r.status === 400 && r.json?.message?.includes('.xlsx'), `status=${r.status} ${JSON.stringify(r.json)}`);
} catch (e) {
  failed++;
  console.error('测试执行异常:', e);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
cleanup();
process.exit(failed ? 1 : 0);
