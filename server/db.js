import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'reno.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 核心模型：板块(section) → 预算项目(item) → 订单(order,可选挂项目) → 付款(payment) → 票据(receipt)
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 板块（大类）：硬装施工 / 全屋电器 / 全屋智能 / 家具软装 / 其他杂费 …
CREATE TABLE IF NOT EXISTS sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
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
  note         TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 订单：定金→尾款等多次付款场景，可选挂在某个预算项目下
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  vendor        TEXT NOT NULL DEFAULT '',
  item_id       INTEGER REFERENCES items(id) ON DELETE SET NULL,
  total_amount  REAL NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
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
const itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
if (itemCols.includes('actual_price') && !itemCols.includes('bought')) {
  db.exec('ALTER TABLE items ADD COLUMN bought INTEGER NOT NULL DEFAULT 0');
  db.prepare('UPDATE items SET bought = 1 WHERE actual_price IS NOT NULL').run();
}

// 首次运行：默认预算目标 + 预置板块（与用户的评估表一致）
function seed() {
  const hasSetting = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  if (hasSetting === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('total_budget', '0')").run();
  }
  const hasSection = db.prepare('SELECT COUNT(*) AS c FROM sections').get().c;
  if (hasSection === 0) {
    const defaults = ['硬装施工类', '全屋电器类', '全屋智能类', '家具软装类', '其他杂费类'];
    const insert = db.prepare('INSERT INTO sections (name, sort_order) VALUES (?, ?)');
    defaults.forEach((name, i) => insert.run(name, i));
  }
}
seed();

// ===== 通用聚合：项目实际支出 = 已买项总价 + 挂单付款 =====
export const ITEM_ACTUAL_SQL = `
  (CASE WHEN i.bought = 1 THEN i.quantity * i.unit_price ELSE 0 END
   + COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id
               WHERE o.item_id = i.id), 0))`;

export default db;
