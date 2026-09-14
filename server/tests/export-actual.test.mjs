// 回归测试：导出 Excel Sheet1「实际已花」必须与应用口径一致（已买 + 挂有效项目的付款）。
// 隔离运行：自带临时数据库，不触碰生产库。修复前该单元格写入的是全部付款总额（totalSpent）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5211;
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-export-test-'));
// 就绪判定凭就绪标记 + 子进程存活（端口被外部实例占用时快速失败，不误测外部实例）
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  console.log('== 导出口径 ==');
  // 造数：已买项目总价 100；挂单付款 30；未关联订单付款 5
  // 应用口径 actual = 100 + 30 = 130；全部付款合计 totalSpent = 35（两者必须可区分）
  const sec = await req('POST', '/sections', { name: '测试板块' });
  const item = await req('POST', `/sections/${sec.json.id}/items`,
    { name: '已买大件', quantity: 1, unit_price: 100, bought: true });
  check('造数：已买项目', item.status === 200 && item.json.bought === 1);
  const linked = await req('POST', '/orders', {
    title: '挂单订单', item_id: item.json.id, total_amount: 30,
    paid_now: { amount: 30, pay_date: '2026-09-01' },
    force: true, // 已买项目挂单触发建单双算守卫，测试场景即「确认后显式双算」
  });
  check('造数：挂单付款 30', linked.status === 200, `status=${linked.status}`);
  const loose = await req('POST', '/orders', {
    title: '未关联订单', total_amount: 5,
    paid_now: { amount: 5, pay_date: '2026-09-02' },
  });
  check('造数：未关联付款 5', loose.status === 200);

  const res = await fetch(`${BASE}/export/excel`);
  check('导出成功', res.status === 200, `status=${res.status}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const ws = wb.getWorksheet('预算评估表');
  check('Sheet1 存在', !!ws);

  let spentRow = 0;
  ws.eachRow((row) => {
    const label = String(row.getCell('B').value ?? '');
    if (label.startsWith('实际已花')) spentRow = row.number;
  });
  check('找到「实际已花」行', spentRow > 0);
  const cellValue = Number(ws.getCell(`D${spentRow}`).value);
  check(`Sheet1 实际已花 = 应用口径 130（而非付款合计 35）`, Math.abs(cellValue - 130) < 0.01, `实际值=${cellValue}`);

  // 实付金额优先于预算单价：登记实付 88（数量×单价=100）→ 实际已花 = 88 + 30 = 118
  const paid = await req('PUT', `/items/${item.json.id}`, { paid_amount: 88 });
  check('登记实付 88', paid.status === 200 && paid.json.paid_amount === 88, `status=${paid.status}`);
  check('预算合计不受实付影响（仍 100）', paid.json.budget_amount === 100, `=${paid.json.budget_amount}`);
  const res2 = await fetch(`${BASE}/export/excel`);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await res2.arrayBuffer());
  const ws2 = wb2.getWorksheet('预算评估表');
  let spentRow2 = 0;
  ws2.eachRow((row) => {
    const label = String(row.getCell('B').value ?? '');
    if (label.startsWith('实际已花')) spentRow2 = row.number;
  });
  const cellValue2 = Number(ws2.getCell(`D${spentRow2}`).value);
  check('Sheet1 实际已花随实付修正为 118（预算口径 100 不参与）', Math.abs(cellValue2 - 118) < 0.01, `实际值=${cellValue2}`);

  const wsp = wb2.getWorksheet('付款明细');
  let sumRow = 0;
  wsp.eachRow((row) => { if (String(row.getCell('A').value ?? '') === '合计') sumRow = row.number; });
  const sheet2Sum = Number(wsp.getCell(`F${sumRow}`).value);
  check('Sheet2 付款明细合计仍为全部付款 35', Math.abs(sheet2Sum - 35) < 0.01, `实际值=${sheet2Sum}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
