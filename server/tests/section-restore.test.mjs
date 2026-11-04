// 板块恢复语义回归：撤销板块删除只复活「本次连带软删」的项目，不复活更早
// 被单独删除的项目（I2）；旧 schema 备份恢复到新代码上时 reopen 即补迁移，
// 软删 SQL 引用的列不会运行期报错（M19，防护性用例）。
// 隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5231;
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-sec-restore-test-'));
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

try {
  console.log('== I2 板块恢复只连带本次 ==');
  const sec = await req('POST', '/sections', { name: 'I2测试板块' });
  const secId = sec.json.id;
  const itemA = await req('POST', `/sections/${secId}/items`, { name: '提前删除的项目A', quantity: 1, unit_price: 100 });
  const itemB = await req('POST', `/sections/${secId}/items`, { name: '存活项目B', quantity: 1, unit_price: 200 });
  check('造数：板块与 A/B 项目', sec.status === 200 && itemA.status === 200 && itemB.status === 200);

  let r = await req('DELETE', `/items/${itemA.json.id}`);
  check('单独删除项目 A', r.status === 200, `status=${r.status}`);
  r = await req('DELETE', `/sections/${secId}`);
  check('删除板块（A 已是软删，不被二次连带）', r.status === 200, `status=${r.status}`);
  r = await req('POST', `/sections/${secId}/restore`);
  check('撤销恢复板块', r.status === 200, `status=${r.status}`);

  const plan = await req('GET', '/plan');
  const restoredSec = plan.json.sections.find((s) => s.name === 'I2测试板块');
  check('板块已恢复', !!restoredSec, JSON.stringify(plan.json.sections.map((s) => s.name)));
  const names = (restoredSec?.items ?? []).map((i) => i.name);
  check('本次连带的项目 B 复活', names.includes('存活项目B'), JSON.stringify(names));
  check('更早单独删的项目 A 不凭空复活', !names.includes('提前删除的项目A'), JSON.stringify(names));

  console.log('== M19 旧 schema 备份恢复后自动补迁移 ==');
  // 手工造一个「旧版本 schema」的库：items 无 bought_date/paid_amount/deleted_at、
  // sections 无 deleted_at——模拟旧版备份被恢复到新代码上
  const legacyPath = path.join(tmpDir, 'legacy-schema.db');
  const legacy = new Database(legacyPath);
  legacy.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      name TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0,
      bought INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '', item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      total_amount REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      amount REAL NOT NULL, pay_date TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
    CREATE TABLE receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, original_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
  `);
  legacy.prepare("INSERT INTO settings (key, value) VALUES ('total_budget', '12345')").run();
  const legacySec = legacy.prepare('INSERT INTO sections (name, sort_order) VALUES (?, ?)').run('旧备份板块', 0);
  legacy.prepare('INSERT INTO items (section_id, name, quantity, unit_price) VALUES (?, ?, 1, 500)')
    .run(legacySec.lastInsertRowid, '旧备份项目');
  legacy.close();

  const archive = new ZipArchive({ store: true });
  archive.append(fs.readFileSync(legacyPath), { name: 'database.db' });
  const zipBuf = await new Promise((resolve, reject) => {
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.finalize();
  });
  const fd = new FormData();
  fd.append('file', new Blob([zipBuf]), 'legacy-backup.zip');
  r = await fetch(`${BASE}/restore/backup`, { method: 'POST', body: fd });
  check('旧 schema 备份恢复 200', r.status === 200, `status=${r.status}`);

  // 恢复后新代码的全部软删/实付路径立即可用（缺列已在 reopen 时补齐）
  r = await req('GET', '/plan');
  const legacyPlanItem = (r.json?.sections ?? []).flatMap((s) => s.items ?? []).find((i) => i.name === '旧备份项目');
  check('恢复后清单可读（含旧数据）', r.status === 200 && !!legacyPlanItem,
    `status=${r.status} resp=${JSON.stringify(r.json)?.slice(0, 120)}`);
  r = await req('POST', '/sections', { name: '恢复后新增板块' });
  check('恢复后可写板块', r.status === 200, `status=${r.status}`);
  if (legacyPlanItem) {
    r = await req('PUT', `/items/${legacyPlanItem.id}`, { bought: true, paid_amount: 480, bought_date: '2026-11-03' });
    check('恢复后可登记实付/购买日期（缺列已补）', r.status === 200, `status=${r.status} resp=${JSON.stringify(r.json)?.slice(0, 120)}`);
    r = await req('DELETE', `/items/${legacyPlanItem.id}`);
    check('恢复后软删路径可用（deleted_at 列在）', r.status === 200, `status=${r.status}`);
  }

  console.log('== M2/M3 板块软删改名边界 ==');
  // M2：存量板块名恰为「原名#已删<本id>」时删板块 → 软删改名撞 UNIQUE → 400 而非 500
  const m2a = await req('POST', '/sections', { name: '撞名源板块' });
  const m2b = await req('POST', '/sections', { name: `撞名源板块#已删${m2a.json.id}` });
  check('造数：重名形态板块就位', m2a.status === 200 && m2b.status === 200,
    `a=${m2a.status} b=${m2b.status} ${JSON.stringify(m2b.json)}`);
  r = await req('DELETE', `/sections/${m2a.json.id}`);
  check('M2 软删改名撞 UNIQUE 回 400（而非 500）', r.status === 400, `status=${r.status} ${JSON.stringify(r.json)}`);

  // M3：原名含 #已删<同id> 子串 → 恢复只剥结尾后缀，原名完好不剥错位
  const m3 = await req('POST', '/sections', { name: '错位占位' });
  const m3Original = `前缀#已删${m3.json.id}后缀`;
  await req('PUT', `/sections/${m3.json.id}`, { name: m3Original });
  await req('DELETE', `/sections/${m3.json.id}`); // 软删改名 → `${m3Original}#已删${id}`
  r = await req('POST', `/sections/${m3.json.id}/restore`);
  check('M3 恢复剥结尾后缀（原名含同款子串不剥错位）',
    r.status === 200 && r.json?.name === m3Original, `name=${r.json?.name}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
