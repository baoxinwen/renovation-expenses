// 备份/恢复回归测试：一键备份（F1）与恢复安全链（F2）。
// 隔离运行：自带临时数据库 + 票据 fixture，绝不触碰生产库。
// 依赖 server/zipParse.js（生产解析器，恢复端点共用同一实现——测试即契约校验）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';
import { parseZip } from '../zipParse.js';
import ExcelJS from 'exceljs';

const PORT = 5228;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

// 收集 archiver 输出为 Buffer（构造样例 zip 用）
const collectZip = (archive) => new Promise((resolve, reject) => {
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));
  archive.on('error', reject);
  archive.on('end', () => resolve(Buffer.concat(chunks)));
  archive.finalize();
});

// 构造备份格式样例：store 存储 + 中文文件名 + uploads 子目录（覆盖 parseZip 两种能力）
async function buildSampleZip() {
  const archive = new ZipArchive({ store: true });
  archive.append('fake-sqlite-bytes', { name: 'database.db' });
  archive.append('receipt-a', { name: 'uploads/a.png' });
  archive.append('收据-中文', { name: 'uploads/收据-中文.png' });
  return collectZip(archive);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-backup-test-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

const api = async (method, p, body) => {
  const res = await fetch(BASE + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), res };
};

try {
  // ===== F1-4 空库健壮性：服务刚起、无任何数据 =====
  console.log('== F1-4 空库备份 ==');
  let res = await fetch(`${BASE}/export/backup`);
  let buf = Buffer.from(await res.arrayBuffer());
  check('空库备份返回 200 且 zip 魔数', res.status === 200 && buf.subarray(0, 2).toString() === 'PK', `status=${res.status}`);
  const emptyEntries = parseZip(buf);
  check('空库备份含 database.db 条目', emptyEntries.some((e) => e.name === 'database.db'), JSON.stringify(emptyEntries.map((e) => e.name)));

  // ===== 造数：板块/项目/已买/订单付款/票据 =====
  console.log('== 造数 ==');
  let r = await api('POST', '/sections', { name: '备份测试硬装类' });
  const secId = r.json?.id;
  check('新增板块', r.status === 200 && !!secId, `status=${r.status} resp=${JSON.stringify(r.json).slice(0, 120)}`);
  r = await api('POST', `/sections/${secId}/items`, { name: '测试中央空调', quantity: 1, unit_price: 20000 });
  const itemId = r.json?.id;
  check('新增项目', r.status === 200 && !!itemId, `status=${r.status} resp=${JSON.stringify(r.json).slice(0, 120)}`);
  r = await api('PUT', `/items/${itemId}`, { bought: true, paid_amount: 19199, bought_date: '2026-11-02', force: true });
  check('登记已买（写入 WAL）', r.status === 200 && r.json.bought === 1, `status=${r.status} resp=${JSON.stringify(r.json).slice(0, 120)}`);
  r = await api('POST', '/orders', { title: '装修公司款', item_id: itemId, total_amount: 30000, force: true });
  check('建订单挂项目', r.status === 200, `status=${r.status} resp=${JSON.stringify(r.json).slice(0, 100)}`);
  const orderId = r.json.id;
  r = await api('POST', `/orders/${orderId}/payments`, { amount: 10000, pay_date: '2026-11-02' });
  check('记订单付款', r.status === 200);
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], { type: 'image/png' });
  const receiptFd = new FormData();
  receiptFd.append('files', png, '空调收据.png');
  const upRes = await fetch(`${BASE}/payments/${r.json.id}/receipts`, { method: 'POST', body: receiptFd });
  check('上传票据', upRes.status === 200, `status=${upRes.status} resp=${await upRes.clone().text().then((t) => t.slice(0, 100))}`);

  // ===== F1-1/F1-3 备份产物 =====
  console.log('== F1 备份产物 ==');
  const backupRes = await fetch(`${BASE}/export/backup`);
  buf = Buffer.from(await backupRes.arrayBuffer());
  check('备份 200 且 zip 魔数', backupRes.status === 200 && buf.subarray(0, 2).toString() === 'PK', `status=${backupRes.status}`);
  const disposition = backupRes.headers.get('content-disposition') ?? '';
  check('F1-3 文件名 renovation-backup-YYYY-MM-DD-HHmm.zip', /filename="renovation-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip"/.test(disposition), disposition);
  const entries = parseZip(buf);
  const names = entries.map((e) => e.name);
  check('F1-1 含 database.db 条目', names.includes('database.db'), JSON.stringify(names));
  check('F1-1 含票据 uploads 条目', names.some((n) => n.startsWith('uploads/') && n.endsWith('.png')), JSON.stringify(names));

  // ===== F1-2 WAL 一致性：刚写入的数据在快照中可读回 =====
  console.log('== F1-2 快照一致性 ==');
  const dbEntry = entries.find((e) => e.name === 'database.db');
  const snapPath = path.join(tmpDir, 'snap-from-backup.db');
  fs.writeFileSync(snapPath, dbEntry.data);
  const snap = new Database(snapPath, { readonly: true });
  const row = snap.prepare("SELECT paid_amount FROM items WHERE name = '测试中央空调'").get();
  check('刚登记的已买数据在快照中', !!row && Math.abs(row.paid_amount - 19199) < 0.01, JSON.stringify(row));
  const payRow = snap.prepare('SELECT amount FROM payments').get();
  check('订单付款在快照中', !!payRow && payRow.amount === 10000, JSON.stringify(payRow));
  snap.close();

  // ===== F2 恢复安全链 =====
  console.log('== F2 恢复 ==');
  const before = (await (await fetch(`${BASE}/plan`)).json());
  const beforeSummary = await (await fetch(`${BASE}/stats/summary`)).json();
  const beforeItems = before.sections.flatMap((s) => s.items ?? []).map((i) => ({ name: i.name, budget_amount: i.budget_amount, bought: i.bought, paid_amount: i.paid_amount }));
  const beforeReceipt = fs.existsSync(path.join(tmpDir, 'uploads')) ? fs.readdirSync(path.join(tmpDir, 'uploads')) : [];

  // F2-2 坏 zip：随机字节拒绝且原数据无损
  const badFd = new FormData();
  badFd.append('file', new Blob([new Uint8Array([0x50, 0x4b, 0x99, 0x88])]), 'backup.zip');
  const bad = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: badFd });
  check('F2-2 坏 zip 返回 400', bad.status === 400, `status=${bad.status}`);
  // F2-3 缺 database.db 的 zip
  const noDbArchive = new ZipArchive({ store: true });
  noDbArchive.append('x', { name: 'uploads/only.png' });
  const noDbBuf = await collectZip(noDbArchive);
  const noDbFd = new FormData();
  noDbFd.append('file', new Blob([noDbBuf]), 'backup.zip');
  const noDb = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: noDbFd });
  check('F2-3 缺 database.db 返回 400', noDb.status === 400, `status=${noDb.status}`);
  // F2-3b 损坏库：database.db 为随机字节
  const corruptArchive = new ZipArchive({ store: true });
  corruptArchive.append(Buffer.from(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), { name: 'database.db' });
  const corruptBuf = await collectZip(corruptArchive);
  const corruptFd = new FormData();
  corruptFd.append('file', new Blob([corruptBuf]), 'backup.zip');
  const corrupt = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: corruptFd });
  check('F2-3 损坏库返回 400', corrupt.status === 400, `status=${corrupt.status}`);
  // 路径穿越条目拒绝
  const traversalArchive = new ZipArchive({ store: true });
  traversalArchive.append('evil', { name: '../evil-outside.txt' });
  const travBuf = await collectZip(traversalArchive);
  const travFd = new FormData();
  travFd.append('file', new Blob([travBuf]), 'backup.zip');
  const trav = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: travFd });
  check('zip 条目路径穿越拒绝', trav.status === 400, `status=${trav.status}`);
  check('路径穿越未写出 data/ 外文件', !fs.existsSync(path.join(tmpDir, 'evil-outside.txt')));
  // 三次失败路径后原数据无损
  const intact = await (await fetch(`${BASE}/plan`)).json();
  check('失败路径后原数据无损', Math.abs(intact.plan_total - before.plan_total) < 0.01 && intact.sections.length === before.sections.length);

  // F2-1 round-trip：备份 → 导入空表覆盖（模拟数据丢失）→ 恢复 → 数据一致
  const emptyWb = new ExcelJS.Workbook();
  const emptyWs = emptyWb.addWorksheet('预算评估表');
  emptyWs.addRow(['序号', '项目名称', '规格 / 品牌', '单位', '数量', '单价（元）', '总价（元）', '备注']);
  emptyWs.addRow(['【空板块】']);
  emptyWs.addRow([1, '残留项', '', '件', 1, 100, 100]);
  const emptyPath = path.join(tmpDir, 'empty.xlsx');
  await emptyWb.xlsx.writeFile(emptyPath);
  const clearFd = new FormData();
  clearFd.append('file', new Blob([fs.readFileSync(emptyPath)]), 'empty.xlsx');
  const clearRes = await fetch(`${BASE}/plan/import?mode=replace`, { method: 'POST', body: clearFd });
  const cleared = (await (await fetch(`${BASE}/plan`)).json());
  // 空表含板块标记行 → replace 后仅剩 1 个空板块、项目清零；付款与票据不清（replace 只清板块/项目）
  check('已用最小表覆盖（模拟数据丢失）', clearRes.status === 200 && cleared.plan_total === 100,
    `status=${clearRes.status} sections=${cleared.sections.length} plan_total=${cleared.plan_total} resp=${JSON.stringify(clearRes).slice(0, 80)}`);

  const restoreFd = new FormData();
  restoreFd.append('file', new Blob([buf]), 'backup.zip');
  const restoreRes = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: restoreFd });
  const restoreJson = await restoreRes.json().catch(() => null);
  check('F2-1 恢复 200', restoreRes.status === 200 && restoreJson?.ok === true, `status=${restoreRes.status} resp=${JSON.stringify(restoreJson).slice(0, 80)}`);
  const afterRes = await fetch(`${BASE}/plan`);
  const afterText = await afterRes.text();
  const after = JSON.parse(afterText);
  const afterSummary = await (await fetch(`${BASE}/stats/summary`)).json();
  const afterItems = (after.sections ?? []).flatMap((s) => s.items ?? []).map((i) => ({ name: i.name, budget_amount: i.budget_amount, bought: i.bought, paid_amount: i.paid_amount }));
  if (!Array.isArray(after.sections)) console.log('  ⚠ 恢复后 /api/plan 响应异常:', afterText.slice(0, 200), 'status=', afterRes.status);
  check('F2-1 项目清单逐项一致', JSON.stringify(beforeItems) === JSON.stringify(afterItems));
  check('F2-1 汇总口径一致（plan_total/actual_total/unassigned_paid）',
    Math.abs(after.plan_total - before.plan_total) < 0.01
    && Math.abs(afterSummary.actual_total - beforeSummary.actual_total) < 0.01
    && Math.abs((afterSummary.unassigned_paid ?? 0) - (beforeSummary.unassigned_paid ?? 0)) < 0.01);
  // 票据文件恢复
  const uploadsAfter = fs.existsSync(path.join(tmpDir, 'uploads')) ? fs.readdirSync(path.join(tmpDir, 'uploads')) : [];
  check('F2-1 票据文件恢复', beforeReceipt.length > 0 && uploadsAfter.length === beforeReceipt.length,
    `before=${beforeReceipt.length} after=${uploadsAfter.length}`);
  // 重复恢复幂等
  const restoreFd2 = new FormData();
  restoreFd2.append('file', new Blob([buf]), 'backup.zip');
  const restore2 = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: restoreFd2 });
  check('重复恢复幂等', restore2.status === 200);

  // ===== parseZip 自测（样例 zip round-trip） =====
  console.log('== zipParse 自测 ==');
  const sample = await buildSampleZip();
  const parsed = parseZip(sample);
  const find = (n) => parsed.find((e) => e.name === n);
  check('条目数一致（3）', parsed.length === 3, `len=${parsed.length}`);
  check('database.db 内容一致', find('database.db')?.data.toString() === 'fake-sqlite-bytes');
  check('中文文件名解析', !!find('uploads/收据-中文.png') && find('uploads/收据-中文.png').data.toString() === '收据-中文');
  check('子目录条目解析', find('uploads/a.png')?.data.toString() === 'receipt-a');
} catch (e) {
  failed++;
  console.error('测试执行异常:', e);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
