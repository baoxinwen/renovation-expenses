// 零测试面补覆盖（M13/M14）：GET /orders 关键字 LIKE 转义（escapeLike 是 % _ \
// 转义口径的唯一出处，搜索词含通配符的行为此前无防护）、stats top_items 断言、
// 两个 reorder 端点（客户端拖拽实际调用，排序持久化回归此前两侧无防护）。
// 补覆盖性质：现状行为正确，用例写完即绿，价值在防回归。
// 隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5233;
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-query-reorder-test-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  console.log('== 造数 ==');
  const sec = await req('POST', '/sections', { name: '转义测试板块' });
  const sec2 = await req('POST', '/sections', { name: '排序板块B' });
  const sec3 = await req('POST', '/sections', { name: '排序板块C' });
  const it1 = await req('POST', `/sections/${sec.json.id}/items`, { name: '项目甲', quantity: 2, unit_price: 500 });
  const it2 = await req('POST', `/sections/${sec.json.id}/items`, { name: '项目乙', quantity: 1, unit_price: 2000 });
  // 订单标题覆盖 % _ \ 三个通配/转义字符的字面形态
  const o1 = await req('POST', '/orders', { title: 'A100%特价', total_amount: 10 });
  const o2 = await req('POST', '/orders', { title: 'A100特价', total_amount: 10 });
  const o3 = await req('POST', '/orders', { title: 'B100_型号', total_amount: 10 });
  const o4 = await req('POST', '/orders', { title: 'B100X型号', total_amount: 10 });
  const o5 = await req('POST', '/orders', { title: 'C100\\路径', total_amount: 10 });
  check('造数：板块/项目/订单', o1.status === 200 && o5.status === 200, `o5=${o5.status}`);

  console.log('== M13 GET /orders LIKE 转义 ==');
  let r = await req('GET', `/orders?q=${encodeURIComponent('100%')}`);
  let titles = (r.json ?? []).map((o) => o.title);
  check('q=100% 只按字面匹配（不展开通配）',
    titles.includes('A100%特价') && !titles.includes('A100特价'), JSON.stringify(titles));

  r = await req('GET', `/orders?q=${encodeURIComponent('100_')}`);
  titles = (r.json ?? []).map((o) => o.title);
  check('q=100_ 下划线按字面匹配',
    titles.includes('B100_型号') && !titles.includes('B100X型号'), JSON.stringify(titles));

  r = await req('GET', `/orders?q=${encodeURIComponent('100\\')}`);
  titles = (r.json ?? []).map((o) => o.title);
  check('q=100\\ 反斜杠按字面匹配', titles.includes('C100\\路径'), JSON.stringify(titles));

  r = await req('GET', '/orders?q=无此关键词');
  check('无命中返回空数组', r.status === 200 && r.json.length === 0, JSON.stringify(r.json));

  // r2 M20：筛选参数非法值必须 400（NaN 绑定 NULL 会让过滤静默失效）
  r = await req('GET', `/orders?item_id=${encodeURIComponent('abc')}`);
  check('GET item_id 非数字 400', r.status === 400, `status=${r.status}`);
  r = await req('GET', `/orders?section_id=${encodeURIComponent('abc')}`);
  check('GET section_id 非数字 400', r.status === 400, `status=${r.status}`);

  console.log('== M13 top_items ==');
  r = await req('GET', '/stats/charts');
  const top = r.json?.top_items ?? [];
  check('top_items 按预算降序', top.length >= 2 && top[0].name === '项目乙' && top[1].name === '项目甲',
    JSON.stringify(top.map((t) => `${t.name}:${t.budget}`)));
  check('top_items budget/actual 字段正确',
    top[0]?.budget === 2000 && top[0]?.actual === 0 && top[1]?.budget === 1000,
    JSON.stringify(top[0]));

  console.log('== M14 reorder ==');
  r = await req('PUT', '/sections/reorder', { ids: [sec3.json.id, sec.json.id, sec2.json.id] });
  check('板块 reorder 200', r.status === 200 && r.json?.ok === true, `status=${r.status}`);
  const secNames = (await req('GET', '/sections')).json.map((s) => s.name);
  const idx = (n) => secNames.indexOf(n);
  // 种子预置板块也在列表里，只断言造数板块之间的相对顺序被 reorder 改写
  check('板块顺序持久化（相对序 C < 转义 < B）',
    idx('排序板块C') < idx('转义测试板块') && idx('转义测试板块') < idx('排序板块B'),
    JSON.stringify(secNames));

  r = await req('PUT', '/items/reorder', { ids: [it2.json.id, it1.json.id] });
  check('项目 reorder 200', r.status === 200 && r.json?.ok === true, `status=${r.status}`);
  const itemOrder = ((await req('GET', '/plan')).json.sections.find((s) => s.id === sec.json.id).items ?? [])
    .map((i) => i.name);
  check('项目顺序持久化', JSON.stringify(itemOrder) === JSON.stringify(['项目乙', '项目甲']),
    JSON.stringify(itemOrder));

  r = await req('PUT', '/sections/reorder', { ids: [] });
  check('空 ids 400', r.status === 400, `status=${r.status}`);
  r = await req('PUT', '/items/reorder', {});
  check('缺 ids 400', r.status === 400, `status=${r.status}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
