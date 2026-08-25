// V2 模型场景测试：清单 CRUD、聚合、订单挂项目、导入导出
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:5174/api';
let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log('== 1. 导入用户真实评估表 ==');
const xlsxPath = 'C:/Users/18527/Downloads/家庭装修全案预算评估表.xlsx';
const fd = new FormData();
fd.append('file', new Blob([fs.readFileSync(xlsxPath)]), '家庭装修全案预算评估表.xlsx');
let res = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: fd });
let r = await res.json();
check('导入成功', res.status === 200, JSON.stringify(r));
check('5 个板块', r.sections === 5, `sections=${r.sections}`);
check('目标 16 万', r.target === 160000, `target=${r.target}`);
check('项目数量 ≥ 45', r.items >= 45, `items=${r.items}`);

console.log('== 2. 清单聚合与用户表数字对齐 ==');
r = (await req('GET', '/plan')).json;
check('清单总计 = 177478（与表一致）', Math.abs(r.plan_total - 177478) < 1, `plan_total=${r.plan_total}`);
const sec1 = r.sections.find((s) => s.name.includes('硬装'));
check('硬装板块小计 10 万', Math.abs(sec1.budget_subtotal - 100000) < 1, `${sec1.name}=${sec1.budget_subtotal}`);
const sec2 = r.sections.find((s) => s.name.includes('电器'));
check('电器板块小计 37133.2', Math.abs(sec2.budget_subtotal - 37133.2) < 1, `=${sec2.budget_subtotal}`);
const iceBox = sec2.items.find((i) => i.name === '冰箱');
check('冰箱为已买项（勾选 bought）', iceBox?.bought === 1, JSON.stringify(iceBox?.bought));
const ac = sec2.items.find((i) => i.name === '空调');
check('空调已买', ac?.bought === 1);
const lamp = sec2.items.find((i) => i.name === '晾衣架');
check('晾衣架单价为空 → 0、数量 1', lamp.unit_price === 0 && lamp.quantity === 1, `${lamp.unit_price}/${lamp.quantity}`);
// 已买三件：冰箱 3684.02 + 洗衣机 2166.77 + 空调 19999 = 25849.79
check('实际合计 = 已买三件总价 25849.79', Math.abs(r.actual_total - 25849.79) < 0.5, `actual_total=${r.actual_total}`);

console.log('== 3. 手工增改项目 ==');
r = await req('POST', `/sections/${sec1.id}/items`, { name: '水电改造增项', unit: '项', quantity: 1, unit_price: 3000 });
check('新增项目', r.status === 200 && r.json.budget_amount === 3000, JSON.stringify(r.json));
const newItemId = r.json.id;
r = await req('PUT', `/items/${newItemId}`, { quantity: 2, unit_price: 1500 });
check('改数量×单价 → 总价仍 3000', r.json.budget_amount === 3000);
r = await req('PUT', `/items/${newItemId}`, { quantity: -1 });
check('负数量被拒绝', r.status === 400);
r = await req('PUT', `/items/${newItemId}`, { bought: true });
check('勾选已买 → 实际 = 2×1500 = 3000', r.json.actual_amount === 3000, JSON.stringify(r.json.actual_amount));
r = await req('PUT', `/items/${newItemId}`, { bought: false });
check('取消已买 → 实际归 0', r.json.actual_amount === 0 && r.json.bought === 0);
r = await req('DELETE', `/items/${newItemId}`);
check('删除项目', r.status === 200);

console.log('== 4. 订单挂项目 ==');
r = (await req('GET', '/plan')).json;
const tile = r.sections.flatMap((s) => s.items).find((i) => i.name === '硬装施工总价');
r = await req('POST', '/orders', { title: '装修公司首期款', vendor: 'XX装饰', item_id: tile.id, total_amount: 100000 });
check('创建挂项目的订单', r.status === 200 && r.json.item_name === '硬装施工总价', JSON.stringify(r.json));
const orderId = r.json.id;
r = await req('POST', `/orders/${orderId}/payments`, { amount: 30000, pay_date: '2026-08-25', method: '银行卡', note: '首期款' });
check('记付款 3 万', r.status === 200);
r = (await req('GET', '/plan')).json;
const tileAfter = r.sections.flatMap((s) => s.items).find((i) => i.name === '硬装施工总价');
check('订单付款计入该项目实际（该项目=30000）', Math.abs(tileAfter.actual_amount - 30000) < 0.5, `=${tileAfter.actual_amount}`);
check('实际合计同步', Math.abs(r.actual_total - 55849.79) < 0.5, `=${r.actual_total}`);
r = await req('GET', `/orders?item_id=${tile.id}`);
check('按项目筛选订单', r.json.length === 1 && r.json[0].id === orderId);

console.log('== 5. 统计与图表 ==');
r = (await req('GET', '/stats/summary')).json;
check('summary 板块数 5', r.sections.length === 5);
check('清单总计/实际合计一致', Math.abs(r.plan_total - 177478) < 1 && Math.abs(r.actual_total - 55849.79) < 0.5);
r = (await req('GET', '/stats/charts')).json;
check('板块预算/实际数据', r.by_section.length === 5 && r.by_section[0].budget > 0);
check('月度趋势 2026-08 = 30000', r.by_month.some((m) => m.month === '2026-08' && m.amount === 30000));
check('最近付款含项目/板块名', r.recent_payments[0]?.item_name === '硬装施工总价');

console.log('== 6. 导出 ==');
const ex = await fetch(`${BASE}/export/excel`);
const buf = Buffer.from(await ex.arrayBuffer());
check('导出 xlsx', ex.status === 200 && buf.slice(0, 2).toString() === 'PK');

console.log('== 7. 清理测试订单（保留导入的清单与目标） ==');
await req('DELETE', `/orders/${orderId}`);
r = (await req('GET', '/plan')).json;
check('订单删除后实际恢复 25849.79', Math.abs(r.actual_total - 25849.79) < 0.5, `=${r.actual_total}`);
check('清单与目标保留', Math.abs(r.plan_total - 177478) < 1 && r.total_budget === 160000);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
