// 备份回归测试：备份脚本对运行中的 SQLite 做一致性快照，失败可见。
// 1) 成功路径：产出的 tar.gz 内含一致性快照 renovation-expenses.db（数据可读）与 uploads；
// 2) 失败路径：数据目录不存在 → 非零退出 + backup.log 留痕；
// 3) 保留策略：KEEP 生效。
// 直接以 sh 运行 docker/backup.sh，用 DATA_DIR/BACKUP_DIR/APP_DIR 重定向到临时目录。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

const winPath = (p) => p.replaceAll('\\', '/');
// tar 是 GNU tar：C:/ 会被当作「远程主机:路径」，tar 面向的路径须用 MSYS 风格（/c/...）。
// DATA_DIR 同时被 node（需 Windows 盘符路径）与 sh 消费，保持 C:/ 形式（MSYS 的 cp/test 均可识别）。
const msysPath = (p) => '/' + winPath(p).replace(/^([A-Za-z]):\//, (_, d) => `${d.toLowerCase()}/`);
const makeBackup = (tmpBase, { keep = '30' } = {}) => {
  const dataDir = path.join(tmpBase, 'data');
  const backupDir = path.join(tmpBase, 'backups');
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  // 源库：真实 SQLite（含数据），模拟运行中的库
  const src = new Database(path.join(dataDir, 'renovation-expenses.db'));
  src.exec('CREATE TABLE IF NOT EXISTS t(x INTEGER)');
  src.prepare('INSERT INTO t VALUES (99)').run();
  src.close();
  fs.writeFileSync(path.join(dataDir, 'uploads', 'r1.png'), 'fake-image');
  return { dataDir, backupDir };
};

const runBackup = (env) => spawnSync('sh', ['docker/backup.sh'], {
  cwd: repoRoot,
  env: { ...process.env, ...env },
  encoding: 'utf8',
});

const extract = (tarGz, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  spawnSync('tar', ['-xzf', msysPath(tarGz), '-C', msysPath(dest)], { encoding: 'utf8' });
};

try {
  console.log('== 备份一致性 ==');
  const base1 = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-backup-'));
  const { dataDir, backupDir } = makeBackup(base1);
  const r = runBackup({ DATA_DIR: winPath(dataDir), BACKUP_DIR: msysPath(backupDir), APP_DIR: winPath(repoRoot), KEEP: '2' });
  check('备份脚本退出码 0', r.status === 0, `status=${r.status} stderr=${r.stderr?.slice(0, 200)}`);
  const archives = fs.readdirSync(backupDir).filter((f) => f.startsWith('renovation-expenses-') && f.endsWith('.tar.gz'));
  check('产出 tar.gz', archives.length === 1, `files=${archives}`);
  if (archives.length === 1) {
    const dest = path.join(base1, 'extract');
    extract(path.join(backupDir, archives[0]), dest);
    const snapDb = path.join(dest, 'data', 'renovation-expenses.db');
    check('快照含 renovation-expenses.db', fs.existsSync(snapDb));
    if (fs.existsSync(snapDb)) {
      const db = new Database(snapDb, { readonly: true });
      const v = db.prepare('SELECT x FROM t').get();
      check('快照库数据可读（一致性快照而非撕裂页）', v?.x === 99, `x=${JSON.stringify(v)}`);
      db.close();
    }
    check('快照含 uploads 附件', fs.existsSync(path.join(dest, 'data', 'uploads', 'r1.png')));
    check('未把运行中库的 -journal/-wal 一起打包', !fs.existsSync(path.join(dest, 'data', 'renovation-expenses.db-journal')));
  }
  fs.rmSync(base1, { recursive: true, force: true });

  console.log('== 失败可见 ==');
  const base2 = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-backup-fail-'));
  const backupDir2 = path.join(base2, 'backups');
  fs.mkdirSync(backupDir2, { recursive: true });
  const r2 = runBackup({ DATA_DIR: winPath(path.join(base2, 'not-exist')), BACKUP_DIR: msysPath(backupDir2), APP_DIR: winPath(repoRoot) });
  check('数据目录不存在 → 非零退出', r2.status !== 0, `status=${r2.status}`);
  const logPath = path.join(backupDir2, 'backup.log');
  check('backup.log 留痕失败', fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes('失败'),
    `log=${fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '(无)'}`);
  fs.rmSync(base2, { recursive: true, force: true });

  console.log('== 保留策略 ==');
  const base3 = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-backup-keep-'));
  const { dataDir: d3, backupDir: b3 } = makeBackup(base3);
  ['20260101-000001', '20260102-000001', '20260103-000001'].forEach((s) =>
    fs.writeFileSync(path.join(b3, `renovation-expenses-${s}.tar.gz`), 'old'));
  const r3 = runBackup({ DATA_DIR: winPath(d3), BACKUP_DIR: msysPath(b3), APP_DIR: winPath(repoRoot), KEEP: '2' });
  const left = fs.readdirSync(b3).filter((f) => f.startsWith('renovation-expenses-') && f.endsWith('.tar.gz'));
  check('KEEP=2 生效（新备份 + 1 份最新旧备份）', r3.status === 0 && left.length === 2, `left=${left}`);
  fs.rmSync(base3, { recursive: true, force: true });
} finally {
  // 无常驻进程
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
