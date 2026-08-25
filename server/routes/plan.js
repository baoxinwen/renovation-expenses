import db, { ITEM_ACTUAL_SQL } from '../db.js';

const ITEM_SELECT = `
  SELECT i.*,
         (i.quantity * i.unit_price) AS budget_amount,
         (${ITEM_ACTUAL_SQL}) AS actual_amount,
         (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id) AS order_count,
         COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id
                   WHERE o.item_id = i.id), 0) AS order_paid
  FROM items i`;

function uniqueError(e, reply, message) {
  if (String(e?.message || '').includes('UNIQUE constraint failed')) {
    return reply.status(400).send({ message });
  }
  throw e;
}

// 数量/单价校验：非负有限数
function validNum(v, { allowZero = true } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return null;
  return n;
}

export default async function (app) {
  // ===== 整张清单（含板块/项目两级聚合，不含软删项） =====
  app.get('/plan', async () => {
    const settingsRow = db.prepare("SELECT value FROM settings WHERE key = 'total_budget'").get();
    const totalBudget = Number(settingsRow?.value ?? 0);
    const sections = db.prepare('SELECT * FROM sections ORDER BY sort_order, id').all();
    const itemsBySection = db.prepare(`${ITEM_SELECT} WHERE i.section_id = ? AND i.deleted = 0 ORDER BY i.sort_order, i.id`);
    const planTotal = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM items WHERE deleted = 0').get().s;
    const actualTotal = db.prepare(`SELECT COALESCE(SUM(${ITEM_ACTUAL_SQL.replace(/i\./g, 'items.')}), 0) AS s FROM items WHERE items.deleted = 0`).get().s;
    const unassignedPaid = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.item_id IS NULL AND o.deleted = 0`).get().s;

    return {
      total_budget: totalBudget,
      plan_total: planTotal,
      actual_total: actualTotal,
      unassigned_paid: unassignedPaid,
      sections: sections.map((sec) => {
        const items = itemsBySection.all(sec.id);
        return {
          ...sec,
          budget_subtotal: items.reduce((s, it) => s + it.budget_amount, 0),
          actual_subtotal: items.reduce((s, it) => s + it.actual_amount, 0),
          items,
        };
      }),
    };
  });

  // ===== 板块 =====
  app.get('/sections', async () => db.prepare('SELECT * FROM sections ORDER BY sort_order, id').all());

  app.post('/sections', async (req, reply) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return reply.status(400).send({ message: '板块名称不能为空' });
    try {
      const info = db.prepare(`INSERT INTO sections (name, sort_order)
        VALUES (?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sections))`).run(name);
      return db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid);
    } catch (e) {
      return uniqueError(e, reply, '板块名称已存在');
    }
  });

  app.put('/sections/reorder', async (req, reply) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return reply.status(400).send({ message: 'ids 不能为空' });
    const update = db.prepare('UPDATE sections SET sort_order = ? WHERE id = ?');
    db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
    return { ok: true };
  });

  app.put('/sections/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const sec = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    if (!sec) return reply.status(404).send({ message: '板块不存在' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : sec.name;
    if (!name) return reply.status(400).send({ message: '板块名称不能为空' });
    try {
      db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, id);
      return db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    } catch (e) {
      return uniqueError(e, reply, '板块名称已存在');
    }
  });

  app.delete('/sections/:id', async (req, reply) => {
    // 级联删除项目；项目下订单的 item_id 置空（数据保留）
    const info = db.prepare('DELETE FROM sections WHERE id = ?').run(Number(req.params.id));
    if (info.changes === 0) return reply.status(404).send({ message: '板块不存在' });
    return { ok: true };
  });

  // ===== 预算项目 =====
  app.post('/sections/:id/items', async (req, reply) => {
    const sectionId = Number(req.params.id);
    const sec = db.prepare('SELECT id FROM sections WHERE id = ?').get(sectionId);
    if (!sec) return reply.status(404).send({ message: '板块不存在' });
    const b = req.body || {};
    const name = String(b.name ?? '').trim();
    if (!name) return reply.status(400).send({ message: '项目名称不能为空' });
    const quantity = b.quantity !== undefined ? validNum(b.quantity) : 1;
    if (quantity === null) return reply.status(400).send({ message: '数量必须是非负数字' });
    const unitPrice = b.unit_price !== undefined ? validNum(b.unit_price) : 0;
    if (unitPrice === null) return reply.status(400).send({ message: '单价必须是非负数字' });
    const bought = b.bought ? 1 : 0;
    const info = db.prepare(`INSERT INTO items (section_id, name, spec, unit, quantity, unit_price, bought, note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?,
              (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items WHERE section_id = ?))`)
      .run(sectionId, name, String(b.spec ?? ''), String(b.unit ?? ''), quantity, unitPrice, bought,
           String(b.note ?? ''), sectionId);
    return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(info.lastInsertRowid);
  });

  app.put('/items/reorder', async (req, reply) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return reply.status(400).send({ message: 'ids 不能为空' });
    const update = db.prepare('UPDATE items SET sort_order = ? WHERE id = ?');
    db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
    return { ok: true };
  });

  app.put('/items/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) return reply.status(404).send({ message: '项目不存在' });
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : item.name;
    if (!name) return reply.status(400).send({ message: '项目名称不能为空' });

    const quantity = b.quantity !== undefined ? validNum(b.quantity) : item.quantity;
    if (quantity === null) return reply.status(400).send({ message: '数量必须是非负数字' });
    const unitPrice = b.unit_price !== undefined ? validNum(b.unit_price) : item.unit_price;
    if (unitPrice === null) return reply.status(400).send({ message: '单价必须是非负数字' });

    const bought = b.bought !== undefined ? (b.bought ? 1 : 0) : item.bought;

    db.prepare(`UPDATE items SET name = ?, spec = ?, unit = ?, quantity = ?, unit_price = ?,
                bought = ?, note = ? WHERE id = ?`)
      .run(name,
           b.spec !== undefined ? String(b.spec) : item.spec,
           b.unit !== undefined ? String(b.unit) : item.unit,
           quantity, unitPrice, bought,
           b.note !== undefined ? String(b.note) : item.note,
           id);
    return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
  });

  app.delete('/items/:id', async (req, reply) => {
    // 软删除：可撤销；其订单保留（付款不再计入清单实际，恢复后自动回来）
    const info = db.prepare('UPDATE items SET deleted = 1 WHERE id = ? AND deleted = 0').run(Number(req.params.id));
    if (info.changes === 0) return reply.status(404).send({ message: '项目不存在' });
    return { ok: true, deleted: true };
  });

  app.post('/items/:id/restore', async (req, reply) => {
    const info = db.prepare('UPDATE items SET deleted = 0 WHERE id = ? AND deleted = 1').run(Number(req.params.id));
    if (info.changes === 0) return reply.status(404).send({ message: '没有可恢复的项目' });
    return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(Number(req.params.id));
  });
}
