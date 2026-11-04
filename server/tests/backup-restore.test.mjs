// 备份/恢复回归测试：一键备份（F1）与恢复安全链（F2）。
// 隔离运行：自带临时数据库 + 票据 fixture，绝不触碰生产库。
// 依赖 server/zipParse.js（生产解析器，恢复端点共用同一实现——测试即契约校验）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
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
  r = await api('POST', `/orders/${orderId}/payments`, { amount: 10000, pay_date: '2026-11-02', force: true });
  check('记订单付款（已买项目付款，force 确认双算）', r.status === 200, `status=${r.status}`);
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

  // I8：zip 炸弹——高压缩比条目解压超上限必须抛错，不整量进内存。
  // 条目直接给未压缩的 310MB 全零数据，由 archiver level 6 压小；这样 zip 里
  // 只有一层 deflate，parseZip 解压一次就会撞上限（预先 deflate 会把炸弹藏到第二层）
  console.log('== I8 解压上限 ==');
  const bombArchive = new ZipArchive({ zlib: { level: 6 } });
  bombArchive.append('ok-db', { name: 'database.db' });
  bombArchive.append(Buffer.alloc(310 * 1024 * 1024, 0), { name: 'uploads/bomb.png' });
  const bombBuf = await collectZip(bombArchive);
  check('造数：炸弹 zip 体积在备份上限内（压缩后）', bombBuf.length < 10 * 1024 * 1024, `size=${bombBuf.length}`);
  let bombThrew = '';
  try {
    parseZip(bombBuf);
  } catch (e) {
    bombThrew = e.message;
  }
  check('高压缩比条目解压被上限拦截', bombThrew.includes('zip 炸弹'), `err=${bombThrew.slice(0, 120)}`);

  // ===== C4/C5/M17/M21 恢复链安全 =====
  console.log('== C4/C5 恢复链 ==');
  // 取一份真实合法备份（database.db 是活库快照，恢复必成功）
  const goodRes = await fetch(`${BASE}/export/backup`);
  const goodBuf = Buffer.from(await goodRes.arrayBuffer());
  const realDb = parseZip(goodBuf).find((e) => e.name === 'database.db');

  // M21：同名条目写回不互相覆盖（恶意/损坏 zip 内同名票据静默丢文件）
  const dupArchive = new ZipArchive({ store: true });
  dupArchive.append(realDb.data, { name: 'database.db' });
  dupArchive.append('FIRST-CONTENT', { name: 'uploads/dup.png' });
  dupArchive.append('SECOND-CONTENT', { name: 'uploads/dup.png' });
  const dupBuf = await collectZip(dupArchive);
  const dupFd = new FormData();
  dupFd.append('file', new Blob([dupBuf]), 'backup.zip');
  const dupRes = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: dupFd });
  check('M21 同名条目恢复 200', dupRes.status === 200, `status=${dupRes.status}`);
  const dupContents = fs.readdirSync(path.join(tmpDir, 'uploads'))
    .map((f) => fs.readFileSync(path.join(tmpDir, 'uploads', f), 'utf8'));
  check('M21 同名票据两份内容都在（不覆盖丢文件）',
    dupContents.includes('FIRST-CONTENT') && dupContents.includes('SECOND-CONTENT'),
    JSON.stringify(dupContents));

  // M17：成功恢复后回滚点/暂存目录用毕即清，不在数据目录留残骸
  const dirTop = fs.readdirSync(tmpDir);
  check('M17 成功后无 .pre-restore / staging / restore-check 残留',
    !dirTop.some((f) => f.includes('.pre-restore') || f.includes('.staging') || f.startsWith('.restore-check')),
    JSON.stringify(dirTop));

  // Windows 保留设备名条目不把写回卡死（C4 的 basename 未清洗面）
  const reservedArchive = new ZipArchive({ store: true });
  reservedArchive.append(realDb.data, { name: 'database.db' });
  reservedArchive.append('reserved', { name: 'uploads/con.png' });
  const reservedBuf = await collectZip(reservedArchive);
  const reservedFd = new FormData();
  reservedFd.append('file', new Blob([reservedBuf]), 'backup.zip');
  const reservedRes = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: reservedFd });
  check('Windows 保留名条目恢复 200（清洗后写回）', reservedRes.status === 200, `status=${reservedRes.status}`);

  // C4+C5：恢复中途失败时库与票据都必须可还原（Windows：句柄锁住 uploads 内文件，
  // 使目录 rename/删除失败——单用户 Windows 裸机是主要部署形态，其余平台跳过注入）
  if (process.platform === 'win32') {
    const r0 = fs.readdirSync(path.join(tmpDir, 'uploads')).sort();
    // 恢复前最后写入：进 WAL、不触发 checkpoint（服务从不主动关库）；
    // 基线状态在哨兵写入之后取（哨兵必须计入基线，C5 断言它不丢）
    const sentinel = await api('POST', '/sections', { name: '失败注入哨兵' });
    check('造数：哨兵板块已写入', sentinel.status === 200, `status=${sentinel.status}`);
    const p0 = await (await fetch(`${BASE}/plan`)).json();
    const lockPath = path.join(tmpDir, 'uploads', r0[0]);
    const lockHandle = fs.openSync(lockPath, 'r');
    const failFd = new FormData();
    failFd.append('file', new Blob([goodBuf]), 'backup.zip');
    const failRes = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: failFd });
    fs.closeSync(lockHandle);
    check('注入失败返回 500', failRes.status === 500, `status=${failRes.status}`);
    const p1 = await (await fetch(`${BASE}/plan`)).json();
    check('C5 失败还原保留最近未 checkpoint 写入（哨兵还在）',
      p1.sections.some((s) => s.name === '失败注入哨兵'), JSON.stringify(p1.sections.map((s) => s.name)));
    check('C5 失败还原后清单与恢复前一致',
      JSON.stringify(p1.sections) === JSON.stringify(p0.sections),
      `items ${p0.sections.length}→${p1.sections.length}`);
    check('C4 失败还原票据目录无损',
      JSON.stringify(fs.readdirSync(path.join(tmpDir, 'uploads')).sort()) === JSON.stringify(r0),
      JSON.stringify(fs.readdirSync(path.join(tmpDir, 'uploads'))));
    check('C4/C5 失败后无回滚点残留（还原完成即清）',
      !fs.readdirSync(tmpDir).some((f) => f.includes('.pre-restore') || f.includes('.staging')),
      JSON.stringify(fs.readdirSync(tmpDir)));
    // 失败后链路仍可用：再次恢复成功
    const okFd = new FormData();
    okFd.append('file', new Blob([goodBuf]), 'backup.zip');
    const okRes = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: okFd });
    check('失败后再次恢复成功（链路可自愈）', okRes.status === 200, `status=${okRes.status}`);

    // 变体 a：回滚点创建即失败——预锁 .pre-restore 文件名，copyFileSync 写不进去。
    // 此刻库文件尚未被替换，修复前 catch 会「回滚点缺失 → rmSync(主库) 建空库」，
    // 直接销毁全部数据；修复后必须保留现场、绝不碰主库
    const beforeA = await (await fetch(`${BASE}/plan`)).json();
    const rollbackPath = path.join(tmpDir, 'renovation-expenses.db.pre-restore');
    fs.writeFileSync(rollbackPath, 'dead-beef');
    const rollbackLock = fs.openSync(rollbackPath, 'r+');
    const varAFd = new FormData();
    varAFd.append('file', new Blob([goodBuf]), 'backup.zip');
    const varARes = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: varAFd });
    fs.closeSync(rollbackLock);
    check('变体 a（回滚点创建失败）返回 500', varARes.status === 500, `status=${varARes.status}`);
    check('变体 a 后主库文件未被销毁（非空库）',
      fs.existsSync(path.join(tmpDir, 'renovation-expenses.db'))
      && fs.statSync(path.join(tmpDir, 'renovation-expenses.db')).size > 4096,
      `size=${fs.existsSync(path.join(tmpDir, 'renovation-expenses.db')) ? fs.statSync(path.join(tmpDir, 'renovation-expenses.db')).size : 'missing'}`);
    const afterA = await (await fetch(`${BASE}/plan`)).json();
    check('变体 a 后原数据完整可读（不删活库、不建空库）',
      JSON.stringify(afterA.sections) === JSON.stringify(beforeA.sections),
      `sections=${JSON.stringify(afterA.sections)?.slice(0, 120)}`);
    check('变体 a 后再次恢复成功（数据在，链路可自愈）',
      (await fetch(`${BASE}/restore/backup`, { method: 'POST', body: okFd })).status === 200);
  } else {
    console.log('  (C4/C5 失败注入依赖 Windows 句柄锁语义，本平台跳过)');
  }
} catch (e) {
  failed++;
  console.error('测试执行异常:', e);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
