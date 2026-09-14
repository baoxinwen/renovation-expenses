// 回归测试：legacy reno.db 升级迁移必须携带 -wal/-shm，否则未 checkpoint 的数据丢失。
// 场景：旧版进程非干净退出（本项目全 server/ 无 db.close()、无信号处理器，WAL 从不
// 因干净关闭而 checkpoint）后升级启动新版——主库文件被 rename，而近期事务只存在于
// reno.db-wal；修复前旧 WAL 成为孤儿，迁移等于丢掉 WAL 里的全部数据。
// 隔离运行：RENOVATION_DATA_DIR 重定向到临时目录，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

// 1) 造一个「崩溃态」legacy 库：连接保持打开时数据只进 WAL（远低于 1000 页 auto-checkpoint 阈值）
const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-legacy-live-'));
const legacy = new Database(path.join(liveDir, 'reno.db'));
legacy.pragma('journal_mode = WAL');
legacy.exec('CREATE TABLE legacy_note(v TEXT)');
legacy.prepare('INSERT INTO legacy_note VALUES (?)').run('只存在于 WAL 的数据');

// 2) 连接打开时按字节拷出磁盘状态 = 模拟崩溃后的数据目录（主库旧页 + 未合并的 -wal）
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-legacy-mig-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join(liveDir, `reno.db${suffix}`);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, `reno.db${suffix}`));
}
legacy.close();
fs.rmSync(liveDir, { recursive: true, force: true });
check('造数：崩溃态目录含 reno.db 与 reno.db-wal',
  fs.existsSync(path.join(dataDir, 'reno.db')) && fs.existsSync(path.join(dataDir, 'reno.db-wal')));

// 3) 加载 db.js：模块加载即执行 legacy 迁移与建库
process.env.RENOVATION_DATA_DIR = dataDir;
const { default: db } = await import('../db.js');

try {
  console.log('== legacy 库迁移携带 WAL ==');
  check('主库已改名 renovation-expenses.db', fs.existsSync(path.join(dataDir, 'renovation-expenses.db')));
  check('reno.db 已迁移走', !fs.existsSync(path.join(dataDir, 'reno.db')));
  const row = db.prepare('SELECT v FROM legacy_note').get();
  check('WAL 中未 checkpoint 的旧数据可见（不丢失）', row?.v === '只存在于 WAL 的数据', `row=${JSON.stringify(row)}`);

  console.log('== items 表结构（预算/实付分离） ==');
  const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  check('items 表含 paid_amount（实际支付金额）', cols.includes('paid_amount'));
  check('init_unit_price 预算基线字段已退役', !cols.includes('init_unit_price'));
} finally {
  try { db.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows 文件占用时忽略 */ }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
