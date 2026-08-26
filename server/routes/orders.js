import db, { UPLOAD_DIR } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// HEIC 不在支持列表：Windows Chrome/Edge 无法解码会裂图。iPhone 请改拍 JPG（设置-相机-格式-兼容性最佳）
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 真实日期校验（拦下 2026-99-99 / 0000-00-00）
function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const ORDER_SELECT = `
  SELECT o.*, i.name AS item_name, i.section_id AS section_id, s.name AS section_name,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) AS paid,
         (SELECT COUNT(*) FROM receipts r JOIN payments p ON p.id = r.payment_id
          WHERE p.order_id = o.id) AS receipt_count
  FROM orders o
  LEFT JOIN items i ON i.id = o.item_id
  LEFT JOIN sections s ON s.id = i.section_id`;

function getOrder(id) {
  return db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
}

function fkError(e, reply) {
  if (String(e?.message || '').includes('FOREIGN KEY constraint failed')) {
    return reply.status(400).send({ message: '关联的预算项目不存在' });
  }
  throw e;
}

function receiptFilesOfPayment(paymentId) {
  return db.prepare('SELECT filename FROM receipts WHERE payment_id = ?').all(paymentId)
    .map((r) => r.filename);
}

function removeFiles(filenames) {
  filenames.forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f), (err) => {
    if (err) console.warn('清理文件失败（可能已不存在）:', f, err.message);
  }));
}

export default async function (app) {
  app.get('/orders', async (req) => {
    const { item_id, section_id, status, q } = req.query;
    const where = ['o.deleted = 0'];
    const params = {};
    if (item_id) { where.push('o.item_id = @item_id'); params.item_id = Number(item_id); }
    if (section_id) { where.push('i.section_id = @section_id'); params.section_id = Number(section_id); }
    if (status) { where.push('o.status = @status'); params.status = String(status); }
    if (q) { where.push('(o.title LIKE @q OR o.vendor LIKE @q OR i.name LIKE @q)'); params.q = `%${q}%`; }
    const sql = ORDER_SELECT
      + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
      + ' ORDER BY o.created_at DESC, o.id DESC';
    return db.prepare(sql).all(params);
  });

  app.post('/orders', async (req, reply) => {
    const b = req.body || {};
    const title = String(b.title ?? '').trim();
    if (!title) return reply.status(400).send({ message: '订单名称不能为空' });
    const total = Number(b.total_amount);
    if (!Number.isFinite(total) || total <= 0) return reply.status(400).send({ message: '订单总额必须是正数' });
    const itemId = b.item_id ? Number(b.item_id) : null;
    if (itemId != null) {
      const targetItem = db.prepare('SELECT id FROM items WHERE id = ? AND deleted = 0').get(itemId);
      if (!targetItem) return reply.status(400).send({ message: '关联的预算项目不存在（或已删除）' });
    }

    // 一次付清：创建订单的同时记首笔付款；付足自动结清（小件购买一步到位）
    let paidNow = null;
    if (b.paid_now != null) {
      const amt = Number(b.paid_now.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return reply.status(400).send({ message: '一次付清金额必须是正数' });
      }
      const payDate = String(b.paid_now.pay_date ?? '');
      if (!validDate(payDate)) return reply.status(400).send({ message: '付款日期无效（应为真实日期，格式 YYYY-MM-DD）' });
      paidNow = { amount: amt, payDate, method: String(b.paid_now.method ?? ''), note: String(b.paid_now.note ?? '') };
    }

    try {
      const status = paidNow && paidNow.amount >= total ? 'closed' : 'open';
      const info = db.prepare(`INSERT INTO orders (title, vendor, item_id, total_amount, note, status)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(title, String(b.vendor ?? ''), itemId, total, String(b.note ?? ''), status);
      const orderId = Number(info.lastInsertRowid);
      if (paidNow) {
        db.transaction(() => {
          db.prepare(`INSERT INTO payments (order_id, amount, pay_date, method, note) VALUES (?, ?, ?, ?, ?)`)
            .run(orderId, paidNow.amount, paidNow.payDate, paidNow.method, paidNow.note || '一次付清');
        })();
      }
      const order = getOrder(orderId);
      const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY pay_date DESC, id DESC')
        .all(orderId)
        .map((p) => ({ ...p, receipts: db.prepare('SELECT * FROM receipts WHERE payment_id = ? ORDER BY id').all(p.id) }));
      return { ...order, payments };
    } catch (e) {
      return fkError(e, reply);
    }
  });

  app.get('/orders/:id', async (req, reply) => {
    const order = getOrder(Number(req.params.id));
    if (!order || order.deleted) return reply.status(404).send({ message: '订单不存在' });
    const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY pay_date DESC, id DESC')
      .all(order.id)
      .map((p) => ({
        ...p,
        receipts: db.prepare('SELECT * FROM receipts WHERE payment_id = ? ORDER BY id').all(p.id),
      }));
    return { ...order, payments };
  });

  app.put('/orders/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND deleted = 0').get(id);
    if (!order) return reply.status(404).send({ message: '订单不存在' });
    const b = req.body || {};
    const title = b.title !== undefined ? String(b.title).trim() : order.title;
    if (!title) return reply.status(400).send({ message: '订单名称不能为空' });
    const total = b.total_amount !== undefined ? Number(b.total_amount) : order.total_amount;
    if (!Number.isFinite(total) || total <= 0) return reply.status(400).send({ message: '订单总额必须是正数' });
    const status = b.status !== undefined ? String(b.status) : order.status;
    if (!['open', 'closed'].includes(status)) return reply.status(400).send({ message: '状态不合法' });
    const itemId = 'item_id' in b ? (b.item_id ? Number(b.item_id) : null) : order.item_id;
    if (itemId != null) {
      const targetItem = db.prepare('SELECT id FROM items WHERE id = ? AND deleted = 0').get(itemId);
      if (!targetItem) return reply.status(400).send({ message: '关联的预算项目不存在（或已删除）' });
    }
    try {
      db.prepare(`UPDATE orders SET title = ?, vendor = ?, item_id = ?, total_amount = ?, note = ?, status = ?
                  WHERE id = ?`)
        .run(title,
             b.vendor !== undefined ? String(b.vendor) : order.vendor,
             itemId, total,
             b.note !== undefined ? String(b.note) : order.note,
             status, id);
      return getOrder(id);
    } catch (e) {
      return fkError(e, reply);
    }
  });

  app.delete('/orders/:id', async (req, reply) => {
    // 软删除：付款与票据全部保留，可撤销恢复
    const info = db.prepare('UPDATE orders SET deleted = 1 WHERE id = ? AND deleted = 0').run(Number(req.params.id));
    if (info.changes === 0) return reply.status(404).send({ message: '订单不存在' });
    return { ok: true, deleted: true };
  });

  app.post('/orders/:id/restore', async (req, reply) => {
    const info = db.prepare('UPDATE orders SET deleted = 0 WHERE id = ? AND deleted = 1').run(Number(req.params.id));
    if (info.changes === 0) return reply.status(404).send({ message: '没有可恢复的订单' });
    return getOrder(Number(req.params.id));
  });

  // ===== 付款记录 =====
  app.post('/orders/:id/payments', async (req, reply) => {
    const orderId = Number(req.params.id);
    const order = db.prepare('SELECT id, total_amount, deleted FROM orders WHERE id = ?').get(orderId);
    if (!order || order.deleted) return reply.status(404).send({ message: '订单不存在（或已删除）' });
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return reply.status(400).send({ message: '金额必须是非零数字（付款为正，退款为负）' });
    }
    const payDate = String(b.pay_date ?? '');
    if (!validDate(payDate)) return reply.status(400).send({ message: '付款日期无效（应为真实日期，格式 YYYY-MM-DD）' });
    const info = db.prepare(`INSERT INTO payments (order_id, amount, pay_date, method, note)
      VALUES (?, ?, ?, ?, ?)`)
      .run(orderId, amount, payDate, String(b.method ?? ''), String(b.note ?? ''));
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
  });

  app.put('/payments/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return reply.status(404).send({ message: '付款记录不存在' });
    const b = req.body || {};
    const amount = b.amount !== undefined ? Number(b.amount) : payment.amount;
    if (!Number.isFinite(amount) || amount === 0) {
      return reply.status(400).send({ message: '金额必须是非零数字（付款为正，退款为负）' });
    }
    const payDate = b.pay_date !== undefined ? String(b.pay_date) : payment.pay_date;
    if (!validDate(payDate)) return reply.status(400).send({ message: '付款日期无效（应为真实日期，格式 YYYY-MM-DD）' });
    db.prepare('UPDATE payments SET amount = ?, pay_date = ?, method = ?, note = ? WHERE id = ?')
      .run(amount, payDate,
           b.method !== undefined ? String(b.method) : payment.method,
           b.note !== undefined ? String(b.note) : payment.note,
           id);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  });

  app.delete('/payments/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const files = receiptFilesOfPayment(id);
    const info = db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    if (info.changes === 0) return reply.status(404).send({ message: '付款记录不存在' });
    removeFiles(files);
    return { ok: true };
  });

  // ===== 票据照片 =====
  app.post('/payments/:id/receipts', async (req, reply) => {
    const paymentId = Number(req.params.id);
    const payment = db.prepare(`
      SELECT p.id FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ? AND o.deleted = 0`).get(paymentId);
    if (!payment) return reply.status(404).send({ message: '付款记录不存在（或订单已删除）' });

    // 两遍式：先全部读取并校验，任一失败直接 400，不落任何文件（避免半传残留）
    const incoming = [];
    const files = req.files({ limits: { fileSize: 10 * 1024 * 1024 } });
    for await (const file of files) {
      if (file.fieldname !== 'files') continue;
      const ext = path.extname(file.filename).toLowerCase().slice(1);
      if (!ALLOWED_EXT.includes(ext)) {
        return reply.status(400).send({ message: `不支持的图片格式：${file.filename}（支持 jpg/png/webp；HEIC 请转 JPG）` });
      }
      const buf = await file.toBuffer();
      if (file.truncated) {
        return reply.status(400).send({ message: `单张照片不能超过 10MB：${file.filename}` });
      }
      incoming.push({ ext, buf, originalName: file.filename });
    }
    if (!incoming.length) return reply.status(400).send({ message: '未收到任何文件' });
    if (incoming.length > 10) return reply.status(400).send({ message: '单次最多上传 10 张' });
    const totalBytes = incoming.reduce((n, f) => n + f.buf.length, 0);
    if (totalBytes > 30 * 1024 * 1024) {
      return reply.status(400).send({ message: '单次上传总量超过 30MB，请分批上传' });
    }

    const saved = [];
    const insert = db.prepare('INSERT INTO receipts (payment_id, filename, original_name) VALUES (?, ?, ?)');
    try {
      db.transaction(() => {
        incoming.forEach(({ ext, buf, originalName }) => {
          const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
          fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
          // 先登记再插库：若 insert 失败，catch 也能清掉刚写入的这个文件（不留孤儿）
          saved.push({ payment_id: paymentId, filename, original_name: originalName });
          const info = insert.run(paymentId, filename, originalName);
          saved[saved.length - 1].id = Number(info.lastInsertRowid);
        });
      })();
    } catch (e) {
      // 落盘/插库中途失败：清掉已写文件，不留脏数据
      removeFiles(saved.map((s) => s.filename));
      throw e;
    }
    return saved;
  });

  app.delete('/receipts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
    if (!receipt) return reply.status(404).send({ message: '票据不存在' });
    db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
    removeFiles([receipt.filename]);
    return { ok: true };
  });
}
