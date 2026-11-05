import db, { itemActualSQL, getTotalBudget } from '../db.js';

const ITEM_ACTUAL = itemActualSQL('i');
const ITEM_SELECT = `
  SELECT i.*,
         (i.quantity * i.unit_price) AS budget_amount,
         (${ITEM_ACTUAL}) AS actual_amount,
         (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND o.deleted = 0) AS order_count,
         COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id
                   WHERE o.item_id = i.id AND o.deleted = 0), 0) AS order_paid
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

// 只剥结尾的 #已删<id> 后缀（M3）：原名本身含 #已删<同id> 子串时，
// String.replace 的非锚定替换会剥掉错位的那一处，恢复出错位的板块名
function stripDeletedSuffix(name, id) {
  const suffix = `#已删${id}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

export default async function (app) {
  // ===== 整张清单（含板块/项目两级聚合，不含软删项） =====
  app.get('/plan', async () => {
    const totalBudget = getTotalBudget();
    const sections = db.prepare('SELECT * FROM sections WHERE deleted = 0 ORDER BY sort_order, id').all();
    const itemsBySection = db.prepare(`${ITEM_SELECT} WHERE i.section_id = ? AND i.deleted = 0 ORDER BY i.sort_order, i.id`);
    const planTotal = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM items WHERE deleted = 0').get().s;
    const actualTotal = db.prepare(`SELECT COALESCE(SUM(${itemActualSQL('items').trim()}), 0) AS s FROM items WHERE items.deleted = 0`).get().s;
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
  app.get('/sections', async () => db.prepare('SELECT * FROM sections WHERE deleted = 0 ORDER BY sort_order, id').all());

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
    const sec = db.prepare('SELECT * FROM sections WHERE id = ? AND deleted = 0').get(id);
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
    // 软删除板块：名称加后缀避免占用 UNIQUE，其下项目一并软删（均可在 8 秒内撤销）。
    // 连带软删记同一个时刻（deleted_at），恢复时据此只复活本次连带的项目（I2）——
    // 之前被单独删除的项目不凭空复活
    const id = Number(req.params.id);
    const sec = db.prepare('SELECT * FROM sections WHERE id = ? AND deleted = 0').get(id);
    if (!sec) return reply.status(404).send({ message: '板块不存在' });
    const deletedAt = new Date().toISOString();
    const rename = db.transaction(() => {
      db.prepare('UPDATE sections SET deleted = 1, deleted_at = ?, name = ? WHERE id = ?')
        .run(deletedAt, `${sec.name}#已删${id}`, id);
      db.prepare('UPDATE items SET deleted = 1, deleted_at = ? WHERE section_id = ? AND deleted = 0')
        .run(deletedAt, id);
    });
    // 软删改名可能撞 UNIQUE（存量板块名恰为「原名#已删<本id>」，M2）：
    // 与 POST/PUT 的唯一冲突口径一致回 400，而不是裸 500
    try {
      rename();
    } catch (e) {
      return uniqueError(e, reply, '板块名称已存在');
    }
    return { ok: true, deleted: true };
  });

  app.post('/sections/:id/restore', async (req, reply) => {
    const id = Number(req.params.id);
    const sec = db.prepare('SELECT * FROM sections WHERE id = ? AND deleted = 1').get(id);
    if (!sec) return reply.status(404).send({ message: '没有可恢复的板块' });
    // 恢复双算守卫（r3 C1）：连带复活「已买且名下订单有付款」的项目会让已买
    // 实付与订单付款同刻回归实际合计——needForce 确认后才放行，与勾选/付款/
    // 订单恢复守卫同一模式。恢复条件与下方复活 UPDATE 完全同构（含旧版 NULL 兼容）
    if (!req.body?.force) {
      const risky = db.prepare(`
        SELECT i.name FROM items i
        WHERE i.section_id = ? AND i.deleted = 1 AND i.bought = 1
          AND (i.deleted_at = ? OR (i.deleted_at IS NULL AND ? IS NULL))
          AND EXISTS (SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id
                      WHERE o.item_id = i.id AND o.deleted = 0)
        LIMIT 1`).get(id, sec.deleted_at, sec.deleted_at);
      if (risky) {
        return reply.status(409).send({
          message: `「${risky.name}」已勾「已买」且名下订单有付款，恢复板块后已买实付与订单付款会重复计入实际合计`,
          needForce: true,
        });
      }
    }
    const originalName = stripDeletedSuffix(sec.name, id);
    const nameTaken = db.prepare('SELECT COUNT(*) AS c FROM sections WHERE name = ? AND id != ?').get(originalName, id).c > 0;
    const restore = db.transaction(() => {
      db.prepare('UPDATE sections SET deleted = 0, deleted_at = NULL, name = ? WHERE id = ?')
        .run(nameTaken ? `${originalName}（恢复）` : originalName, id);
      // 只复活与板块同刻连带软删的项目；IS NULL 分支兼容旧版本删除的存量数据
      //（旧版不写 deleted_at，板块与其连带项都为 NULL，行为与旧版一致）
      db.prepare(`UPDATE items SET deleted = 0, deleted_at = NULL
                  WHERE section_id = ? AND deleted = 1
                    AND (deleted_at = ? OR (deleted_at IS NULL AND ? IS NULL))`)
        .run(id, sec.deleted_at, sec.deleted_at);
    });
    restore();
    return db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  });

  // ===== 预算项目 =====
  app.post('/sections/:id/items', async (req, reply) => {
    const sectionId = Number(req.params.id);
    const sec = db.prepare('SELECT id FROM sections WHERE id = ? AND deleted = 0').get(sectionId);
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
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND deleted = 0').get(id);
    if (!item) return reply.status(404).send({ message: '项目不存在' });
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : item.name;
    if (!name) return reply.status(400).send({ message: '项目名称不能为空' });

    const quantity = b.quantity !== undefined ? validNum(b.quantity) : item.quantity;
    if (quantity === null) return reply.status(400).send({ message: '数量必须是非负数字' });
    const unitPrice = b.unit_price !== undefined ? validNum(b.unit_price) : item.unit_price;
    if (unitPrice === null) return reply.status(400).send({ message: '单价必须是非负数字' });

    const bought = b.bought !== undefined ? (b.bought ? 1 : 0) : item.bought;
    // 双算守卫（API 级）：把未买项目勾成「已买」（0→1 跃迁）且项目下已有有效订单付款 → 409；
    // 前端确认后带 force:true 可通过（此时双计是用户显式选择，见 PRD 口径说明）。
    // 守卫只拦跃迁：本就已买的项目做普通编辑（改备注/名称/单价）不带 bought 字段，不触发
    if (bought === 1 && item.bought !== 1 && !b.force) {
      const orderPaid = db.prepare(`
        SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.item_id = ? AND o.deleted = 0`).get(id).s;
      if (orderPaid > 0) {
        return reply.status(409).send({
          message: `该项目下订单已付 ${orderPaid} 元，勾「已买」会重复计入实际合计`,
          needForce: true,
        });
      }
    }
    // 实付金额：登记「已买」时填写（抹零/打包价不受单价×数量约束）；
    // 不填则实际支出回退 数量×单价；传 null/空串表示清除
    let paidAmount = item.paid_amount;
    if ('paid_amount' in b) {
      if (b.paid_amount == null || b.paid_amount === '') {
        paidAmount = null;
      } else {
        paidAmount = validNum(b.paid_amount);
        if (paidAmount === null) return reply.status(400).send({ message: '实付金额必须是非负数字' });
      }
    }
    let boughtDate = item.bought_date;
    if ('bought_date' in b) {
      if (b.bought_date == null || b.bought_date === '') boughtDate = null;
      else {
        const d = String(b.bought_date);
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
        const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
        const ok = dt && dt.getFullYear() === Number(m[1]) && dt.getMonth() === Number(m[2]) - 1 && dt.getDate() === Number(m[3]);
        if (!ok) return reply.status(400).send({ message: '购买日期无效（应为真实日期）' });
        boughtDate = d;
      }
    }
    // 取消已买：实付与日期一并清空，状态回滚干净
    if (bought === 0 && item.bought === 1) {
      paidAmount = null;
      boughtDate = null;
    }

    db.prepare(`UPDATE items SET name = ?, spec = ?, unit = ?, quantity = ?, unit_price = ?,
                bought = ?, bought_date = ?, paid_amount = ?, note = ? WHERE id = ?`)
      .run(name,
           b.spec !== undefined ? String(b.spec) : item.spec,
           b.unit !== undefined ? String(b.unit) : item.unit,
           quantity, unitPrice, bought, boughtDate, paidAmount,
           b.note !== undefined ? String(b.note) : item.note,
           id);
    return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
  });

  app.delete('/items/:id', async (req, reply) => {
    // 软删除：可撤销；其订单保留（付款不再计入清单实际，恢复后自动回来）；
    // deleted_at 记自身删除时刻，与板块连带删除的时刻区分（I2）
    const info = db.prepare('UPDATE items SET deleted = 1, deleted_at = ? WHERE id = ? AND deleted = 0')
      .run(new Date().toISOString(), Number(req.params.id));
    if (info.changes === 0) return reply.status(404).send({ message: '项目不存在' });
    return { ok: true, deleted: true };
  });

  app.post('/items/:id/restore', async (req, reply) => {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND deleted = 1').get(id);
    if (!item) return reply.status(404).send({ message: '没有可恢复的项目' });
    // 恢复双算守卫（r3 C1）：已买项目名下订单有付款时，恢复会让已买实付与
    // 订单付款同刻回归实际合计——needForce 确认后才放行
    if (!req.body?.force && item.bought) {
      const paid = db.prepare(`
        SELECT COUNT(*) AS c FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.item_id = ? AND o.deleted = 0`).get(id).c;
      if (paid > 0) {
        return reply.status(409).send({
          message: `「${item.name}」已勾「已买」且名下订单有付款，恢复后已买实付与订单付款会重复计入实际合计`,
          needForce: true,
        });
      }
    }
    // 所属板块已软删时连带恢复，避免出现"计入总计但任何列表不可见"的孤儿
    const sec = db.prepare('SELECT * FROM sections WHERE id = ? AND deleted = 1').get(item.section_id);
    const restore = db.transaction(() => {
      if (sec) {
        const originalName = stripDeletedSuffix(sec.name, sec.id);
        const taken = db.prepare('SELECT COUNT(*) AS c FROM sections WHERE name = ? AND id != ?').get(originalName, sec.id).c > 0;
        db.prepare('UPDATE sections SET deleted = 0, deleted_at = NULL, name = ? WHERE id = ?')
          .run(taken ? `${originalName}（恢复）` : originalName, sec.id);
      }
      db.prepare('UPDATE items SET deleted = 0, deleted_at = NULL WHERE id = ?').run(id);
    });
    restore();
    return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
  });
}
