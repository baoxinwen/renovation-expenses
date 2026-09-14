import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// RENOVATION_DATA_DIR 供测试隔离使用（默认为项目内 data/）
export const DATA_DIR = process.env.RENOVATION_DATA_DIR
  ? path.resolve(process.env.RENOVATION_DATA_DIR)
  : path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 旧版数据库名为 reno.db：首次用新命名启动时自动改名，兼容旧数据目录与旧备份还原。
// -wal/-shm 必须随主库一起改名：旧进程非干净退出（本项目从不主动关库）时，
// 未 checkpoint 的事务只存在于 reno.db-wal，落在旧名下会被新库弃用造成数据丢失
const DB_FILE = path.join(DATA_DIR, 'renovation-expenses.db');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'reno.db');
if (!fs.existsSync(DB_FILE) && fs.existsSync(LEGACY_DB_FILE)) {
  fs.renameSync(LEGACY_DB_FILE, DB_FILE);
  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = LEGACY_DB_FILE + suffix;
    if (fs.existsSync(legacySidecar)) fs.renameSync(legacySidecar, DB_FILE + suffix);
  }
}

const db = new Database(DB_FILE);
// WAL 需要 mmap 共享内存，Windows Docker Desktop 的 bind mount 不支持（IOERR_SHMOPEN），
// 容器环境通过 SQLITE_JOURNAL_MODE=DELETE 规避；裸机默认 WAL（读并发更好）
db.pragma(`journal_mode = ${process.env.SQLITE_JOURNAL_MODE || 'WAL'}`);
db.pragma('foreign_keys = ON');

// 核心模型：板块(section) → 预算项目(item) → 订单(order,可选挂项目) → 付款(payment) → 票据(receipt)
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 板块（大类）：硬装施工 / 全屋电器 / 全屋智能 / 家具软装 / 其他杂费 …
-- deleted=1 为软删除（名称加 #已删{id} 后缀避免占用 UNIQUE）
CREATE TABLE IF NOT EXISTS sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- 预算项目：清单里的每一"东西"
-- 总价 = quantity * unit_price（单价即当前评估价，成交后更新为实际价并勾 bought）
-- 多次付款的大件另建订单挂到 item 上，付款计入项目实际
CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id   INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  spec         TEXT NOT NULL DEFAULT '',
  unit         TEXT NOT NULL DEFAULT '',
  quantity     REAL NOT NULL DEFAULT 1,
  unit_price   REAL NOT NULL DEFAULT 0,
  bought       INTEGER NOT NULL DEFAULT 0,
  bought_date  TEXT,
  paid_amount  REAL,     -- 实际支付金额：登记「已买」时填写（抹零/打包价不受单价×数量约束）；空则实际回退数量×单价
  note         TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 订单：定金→尾款等多次付款场景，可选挂在某个预算项目下
-- deleted=1 为软删除（可在删除 toast 里撤销恢复）
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  vendor        TEXT NOT NULL DEFAULT '',
  item_id       INTEGER REFERENCES items(id) ON DELETE SET NULL,
  total_amount  REAL NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount     REAL NOT NULL,
  pay_date   TEXT NOT NULL,
  method     TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id    INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_items_section ON items(section_id);
CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);
`);

// 存量库迁移：v2 的 actual_price（直填实际价）→ v2.1 的 bought（已买勾选）
let itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
if (itemCols.includes('actual_price') && !itemCols.includes('bought')) {
  // 事务性 DDL：中途崩溃不会留下半迁移状态
  db.transaction(() => {
    db.exec('ALTER TABLE items ADD COLUMN bought INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE items SET bought = 1 WHERE actual_price IS NOT NULL').run();
  })();
  itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
}
// v2.2：软删除标记（订单与项目删除后可撤销）
if (!itemCols.includes('deleted')) {
  db.exec('ALTER TABLE items ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
}
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
if (!orderCols.includes('deleted')) {
  db.exec('ALTER TABLE orders ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
}
const sectionCols = db.prepare('PRAGMA table_info(sections)').all().map((c) => c.name);
if (!sectionCols.includes('deleted')) {
  db.exec('ALTER TABLE sections ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
}
// v2.4：购买登记（bought_date）；v2.6：实付金额（paid_amount），预算/实付语义分离，
// 旧基线字段 init_unit_price 随漂移机制一并退役
if (!itemCols.includes('bought_date')) {
  db.exec('ALTER TABLE items ADD COLUMN bought_date TEXT');
}
if (!itemCols.includes('paid_amount')) {
  db.exec('ALTER TABLE items ADD COLUMN paid_amount REAL');
}
if (itemCols.includes('init_unit_price')) {
  db.exec('ALTER TABLE items DROP COLUMN init_unit_price');
}

// 首次初始化：写入 seeded 标记 + 预置板块（之后清空板块/重导不会再触发预置）
function seed() {
  const seeded = db.prepare("SELECT COUNT(*) AS c FROM settings WHERE key = 'seeded'").get().c;
  if (seeded > 0) return;
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('total_budget', '0');
  const hasSection = db.prepare('SELECT COUNT(*) AS c FROM sections').get().c;
  if (hasSection === 0) {
    const defaults = ['硬装施工类', '全屋电器类', '全屋智能类', '家具软装类', '其他杂费类'];
    const insert = db.prepare('INSERT INTO sections (name, sort_order) VALUES (?, ?)');
    defaults.forEach((name, i) => insert.run(name, i));
  }
  insertSetting.run('seeded', '1');
}

// 三段写包事务：中途崩溃不至于留下残缺的预置板块（重启时 hasSection>0 会跳过补种）
db.transaction(seed)();

// ===== 共享常量（上传/导入上限，各处必须一致） =====
export const LIMITS = {
  RECEIPT_FILE_MB: 10,    // 单张票据
  RECEIPT_TOTAL_MB: 30,   // 单次上传总量
  RECEIPT_MAX_FILES: 10,  // 单次张数
  IMPORT_FILE_MB: 20,     // Excel 文件
  IMPORT_MAX_ROWS: 3000,  // 工作表行数
};

// ===== 共享查询片段（口径唯一出处，勿在各路由复制） =====
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? Number(row.value) : 0;
}

export function getTotalBudget() {
  return getSetting('total_budget');
}

// 项目实际支出 = 已买项总价 + 挂有效订单的付款合计（退款负数冲抵）。
// 注：既勾「已买」又挂订单付款时两路都会计入——前端有双算确认，此为显式选择的口径。
export function itemActualSQL(alias = 'i') {
  return `
  (CASE WHEN ${alias}.bought = 1 THEN COALESCE(${alias}.paid_amount, ${alias}.quantity * ${alias}.unit_price) ELSE 0 END
   + COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id
               WHERE o.item_id = ${alias}.id AND o.deleted = 0), 0))`;
}

// 板块预算/实际小计（plan、stats、export 三处统一出处）
export function sectionAggregatesSQL() {
  const actual = itemActualSQL('i');
  return `
    COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS budget,
    COALESCE((SELECT SUM(${actual}) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS actual`;
}

// 清单总计 / 实际合计（items 全表口径）
export function totalsSQL() {
  const actual = itemActualSQL('items').trim();
  return {
    planTotal: 'COALESCE(SUM(quantity * unit_price), 0)',
    actualTotal: `COALESCE(SUM(${actual}), 0)`,
  };
}

// LIKE 关键字转义（% _ \），配合 ESCAPE 使用
export function escapeLike(q) {
  return String(q).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export default db;
