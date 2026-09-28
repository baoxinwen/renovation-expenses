// 板块单独导出回归测试：指定板块过滤、价格开关、付款明细条件带、向后兼容。
// 隔离运行：自带临时数据库，不触碰生产库（helpers/spawn-server.mjs 保证不误测外部实例）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const PORT = 5214;
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

async function exportWb(query) {
  const res = await fetch(`${BASE}/export/excel${query}`);
  if (res.status !== 200) return { status: res.status, wb: null };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return { status: res.status, wb };
}

// 收集工作表指定列的文本（板块行/项目名/小计/总计都在 B 列，单元格 .text 兼容公式格）
function colTexts(ws, col) {
  const out = [];
  ws.eachRow((row) => { const v = row.getCell(col).text; if (v) out.push(v); });
  return out;
}
function findRow(ws, col, text) {
  let found = null;
  ws.eachRow((row) => { if (row.getCell(col).text === text) found = row; });
  return found;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-section-export-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  // 造数：板块甲（甲1 未买 10×100；甲2 已买实付 48）＋板块乙（乙1 2×30，挂 1 笔付款 60）
  console.log('== 造数 ==');
  const secA = await req('POST', '/sections', { name: '板块甲' });
  const secB = await req('POST', '/sections', { name: '板块乙' });
  check('造数：板块甲乙', secA.status === 200 && secB.status === 200);
  await req('POST', `/sections/${secA.json.id}/items`,
    { name: '甲1', spec: '规格1', unit: '㎡', quantity: 10, unit_price: 100 });
  const a2 = await req('POST', `/sections/${secA.json.id}/items`,
    { name: '甲2', quantity: 1, unit_price: 50, bought: true });
  // paid_amount 仅 PUT /items/:id 接收（POST 不收），创建后补登记实付
  await req('PUT', `/items/${a2.json.id}`, { paid_amount: 48 });
  const b1 = await req('POST', `/sections/${secB.json.id}/items`,
    { name: '乙1', quantity: 2, unit_price: 30 });
  await req('POST', '/orders', {
    title: '乙订单', item_id: b1.json.id, total_amount: 60,
    paid_now: { amount: 60, pay_date: '2026-09-01' },
  });

  console.log('== 单板块导出（含价格） ==');
  const withPrice = await exportWb(`?section_id=${secA.json.id}&include_price=1`);
  check('导出成功', withPrice.status === 200, `status=${withPrice.status}`);
  const ws1 = withPrice.wb.getWorksheet('预算评估表');
  check('仅一个工作表（甲无付款 → 不带付款明细）',
    withPrice.wb.worksheets.length === 1, `sheets=${withPrice.wb.worksheets.map((w) => w.name)}`);
  const bCol = colTexts(ws1, 2);
  // 板块标记行写在序号列（A 列），与用户评估表同构
  check('含【板块甲】标记行', colTexts(ws1, 1).some((t) => t.includes('【板块甲】')));
  check('仅含本板块项目（乙1 不出现）', bCol.includes('甲1') && bCol.includes('甲2') && !bCol.includes('乙1'));
  check('含板块小计行', bCol.includes('板块甲 小计'));
  check('不含全案总计/预算目标块', !bCol.some((t) => t.includes('全案') || t.includes('预算目标')));
  const subRow = findRow(ws1, 2, '板块甲 小计');
  check('小计为 SUM 公式', typeof subRow?.getCell(7).formula === 'string' && subRow.getCell(7).formula.startsWith('SUM(G'),
    `G=${JSON.stringify(subRow?.getCell(7).value)}`);
  const r1 = findRow(ws1, 2, '甲1');
  check('明细行数量/公式总价正确', r1?.getCell(5).value === 10 && typeof r1?.getCell(7).formula === 'string');
  const r2 = findRow(ws1, 2, '甲2');
  check('已买行实付取登记值 48、已买 ✓', r2?.getCell(8).value === 48 && r2?.getCell(9).value === '✓');

  console.log('== 单板块导出（不含价格） ==');
  const noPrice = await exportWb(`?section_id=${secA.json.id}&include_price=0`);
  const ws2 = noPrice.wb.getWorksheet('预算评估表');
  check('不含价表头 6 列', JSON.stringify(ws2.getRow(1).values.slice(1)) === JSON.stringify(
    ['序号', '项目名称', '规格 / 品牌', '单位', '数量', '备注']),
    `header=${JSON.stringify(ws2.getRow(1).values)}`);
  check('不含价无小计行', !colTexts(ws2, 2).some((t) => t.includes('小计')));
  const np1 = findRow(ws2, 2, '甲1');
  check('不含价行无价格单元格', np1?.getCell(1).value === 1 && np1?.getCell(2).value === '甲1'
    && np1?.getCell(5).value === 10 && (np1?.getCell(6).value ?? '') === '');

  console.log('== 参数校验与边界 ==');
  check('section_id 非数字 → 400', (await fetch(`${BASE}/export/excel?section_id=abc`)).status === 400);
  check('section_id 负数 → 400', (await fetch(`${BASE}/export/excel?section_id=-1`)).status === 400);
  check('include_price 非法 → 400',
    (await fetch(`${BASE}/export/excel?section_id=${secA.json.id}&include_price=abc`)).status === 400);
  check('板块不存在 → 404', (await exportWb('?section_id=999999')).status === 404);
  const del = await req('POST', '/sections', { name: '待删板块' });
  await req('DELETE', `/sections/${del.json.id}`);
  check('软删板块 → 404', (await exportWb(`?section_id=${del.json.id}`)).status === 404);
  const emptySec = await req('POST', '/sections', { name: '空板块' });
  const emptyRes = await exportWb(`?section_id=${emptySec.json.id}`);
  check('空板块导出成功', emptyRes.status === 200, `status=${emptyRes.status}`);
  check('空板块仅表头+板块行（2 行）', emptyRes.wb.getWorksheet('预算评估表').rowCount === 2,
    `rows=${emptyRes.wb.getWorksheet('预算评估表')?.rowCount}`);
} finally {
  // 清理由 exit 钩子完成，无常驻进程
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
