import db, { UPLOAD_DIR, LIMITS, escapeLike } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// HEIC 不在支持列表：Windows Chrome/Edge 无法解码会裂图。iPhone 请改拍 JPG（设置-相机-格式-兼容性最佳）
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 查询参数 id：非有限正数回 null（调用方转 400），避免 NaN 绑定成 NULL 静默失效
function safeId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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

// 订单详情（含付款与分组票据，单查询取票据避免 N+1）
function getOrderWithPayments(orderId) {
  const order = getOrder(orderId);
  if (!order) return null;
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY pay_date DESC, id DESC')
    .all(orderId);
  const receipts = db.prepare(`
    SELECT r.* FROM receipts r JOIN payments p ON p.id = r.payment_id
    WHERE p.order_id = ? ORDER BY r.id`).all(orderId);
  const byPayment = new Map();
  for (const r of receipts) {
    if (!byPayment.has(r.payment_id)) byPayment.set(r.payment_id, []);
    byPayment.get(r.payment_id).push(r);
  }
  return { ...order, payments: payments.map((p) => ({ ...p, receipts: byPayment.get(p.id) ?? [] })) };
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
  app.get('/orders', async (req, reply) => {
    const { item_id, section_id, status, q } = req.query;
    const where = ['o.deleted = 0'];
    const params = {};
    // 非法 id 参数直接 400（NaN 绑定会静默变成 NULL 使过滤失效）
    if (item_id && safeId(item_id) == null) return reply.status(400).send({ message: 'item_id 无效' });
    if (section_id && safeId(section_id) == null) return reply.status(400).send({ message: 'section_id 无效' });
    if (item_id) { where.push('o.item_id = @item_id'); params.item_id = safeId(item_id); }
    if (section_id) { where.push('i.section_id = @section_id'); params.section_id = safeId(section_id); }
    if (status) { where.push('o.status = @status'); params.status = String(status); }
    if (q) { where.push("(o.title LIKE @q ESCAPE '\\' OR o.vendor LIKE @q ESCAPE '\\' OR i.name LIKE @q ESCAPE '\\')"); params.q = `%${escapeLike(q)}%`; }
    const sql = ORDER_SELECT
      + ` WHERE ${where.join(' AND ')}`
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
      const targetItem = db.prepare('SELECT id, name, bought FROM items WHERE id = ? AND deleted = 0').get(itemId);
      if (!targetItem) return reply.status(400).send({ message: '关联的预算项目不存在（或已删除）' });
      // 双算守卫（API 级）：项目已勾「已买」再挂订单付款会重复计入实际；
      // 前端确认后带 force:true 可通过（与 PUT /items 的 needForce 模式一致，见 PRD 口径说明）
      if (targetItem.bought && !b.force) {
        return reply.status(409).send({
          message: `「${targetItem.name}」已勾「已买」，再挂订单付款会重复计入实际合计`,
          needForce: true,
        });
      }
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
      // 结清口径约定：仅「一次付清建单且付足」时自动 closed（金额已知确定）；
      // 之后的付款变动不自动改状态——结清与否由用户人工确认（防止补差价/退款误判）
      const status = paidNow && paidNow.amount >= total ? 'closed' : 'open';
      // db.transaction(fn) 返回包装函数，需再调用执行
      const orderId = db.transaction(() => {
        const info = db.prepare(`INSERT INTO orders (title, vendor, item_id, total_amount, note, status)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(title, String(b.vendor ?? ''), itemId, total, String(b.note ?? ''), status);
        const newId = Number(info.lastInsertRowid);
        if (paidNow) {
          // 与建单同一事务：崩溃不会留下「已结清却无首付款」的残缺订单
          db.prepare(`INSERT INTO payments (order_id, amount, pay_date, method, note) VALUES (?, ?, ?, ?, ?)`)
            .run(newId, paidNow.amount, paidNow.payDate, paidNow.method, paidNow.note || '一次付清');
        }
        return newId;
      })();
      return getOrderWithPayments(orderId);
    } catch (e) {
      return fkError(e, reply);
    }
  });

  app.get('/orders/:id', async (req, reply) => {
    const order = getOrder(Number(req.params.id));
    if (!order || order.deleted) return reply.status(404).send({ message: '订单不存在' });
    return getOrderWithPayments(order.id);
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
      const targetItem = db.prepare('SELECT id, name, bought FROM items WHERE id = ? AND deleted = 0').get(itemId);
      if (!targetItem) return reply.status(400).send({ message: '关联的预算项目不存在（或已删除）' });
      // 双算守卫（API 级）：换绑到已勾「已买」的项目会重复计入实际（与 POST /orders 守卫一致）。
      // 只拦换绑跃迁：订单本就挂在该项目上时改标题/金额不需要 force
      if (targetItem.bought && targetItem.id !== order.item_id && !b.force) {
        return reply.status(409).send({
          message: `「${targetItem.name}」已勾「已买」，再挂订单付款会重复计入实际合计`,
          needForce: true,
        });
      }
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
    const payment = db.prepare(`
      SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ? AND o.deleted = 0`).get(id);
    if (!payment) return reply.status(404).send({ message: '付款记录不存在（或订单已删除）' });
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
    const payment = db.prepare(`
      SELECT p.id FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ? AND o.deleted = 0`).get(id);
    if (!payment) return reply.status(404).send({ message: '付款记录不存在（或订单已删除）' });
    const files = receiptFilesOfPayment(id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
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
    // throwFileSizeLimit 已全局关闭（见 index.js），超限走 file.truncated 的中文提示
    // 张数/总量限制在流内生效：busboy files 上限截停后续部分 + 逐张计数/累计总量，
    // 内存上界 = RECEIPT_MAX_FILES × RECEIPT_FILE_MB，超限部分只排水不缓冲
    const incoming = [];
    let totalBytes = 0;
    let received = 0;
    let badRequest = null;
    const files = req.files({
      limits: {
        fileSize: LIMITS.RECEIPT_FILE_MB * 1024 * 1024,
        files: LIMITS.RECEIPT_MAX_FILES + 1, // 多放 1 个用于探测超限；再多的部分 busboy 直接丢弃
        throwFileSizeLimit: false,
      },
    });
    // 早退后必须排干剩余部分再回包，否则连接悬挂在未读完的 multipart 流上
    const drainRest = async () => {
      for await (const file of files) {
        for await (const _ of file.file) { void _; } // 丢弃数据块，不进内存
      }
    };
    for await (const file of files) {
      if (file.fieldname !== 'files') continue;
      received += 1;
      if (received > LIMITS.RECEIPT_MAX_FILES) {
        badRequest = `单次最多上传 ${LIMITS.RECEIPT_MAX_FILES} 张`;
        break;
      }
      const ext = path.extname(file.filename).toLowerCase().slice(1);
      if (!ALLOWED_EXT.includes(ext)) {
        badRequest = `不支持的图片格式：${file.filename}（支持 jpg/png/webp；HEIC 请转 JPG）`;
        break;
      }
      const buf = await file.toBuffer();
      if (file.truncated) {
        badRequest = `单张照片不能超过 10MB：${file.filename}`;
        break;
      }
      totalBytes += buf.length;
      if (totalBytes > LIMITS.RECEIPT_TOTAL_MB * 1024 * 1024) {
        badRequest = `单次上传总量超过 ${LIMITS.RECEIPT_TOTAL_MB}MB，请分批上传`;
        break;
      }
      incoming.push({ ext, buf, originalName: file.filename });
    }
    if (badRequest) {
      await drainRest();
      return reply.status(400).send({ message: badRequest });
    }
    if (!incoming.length) return reply.status(400).send({ message: '未收到任何文件' });

    // 先全部落盘，再单独事务插库（事务内不做文件 IO，进程崩溃也不会库回滚+文件残留错位）
    // buffer 必须随条目携带：按 ext+originalName 反查会在同名文件时串写内容
    const written = incoming.map(({ ext, buf, originalName }) => {
      const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
      return { filename, originalName };
    });
    const insert = db.prepare('INSERT INTO receipts (payment_id, filename, original_name) VALUES (?, ?, ?)');
    const saved = [];
    try {
      // 同步事务内收集 lastInsertRowid，安全
      db.transaction(() => {
        written.forEach(({ filename, originalName }) => {
          const info = insert.run(paymentId, filename, originalName);
          saved.push({ id: Number(info.lastInsertRowid), payment_id: paymentId, filename, original_name: originalName });
        });
      })();
    } catch (e) {
      // 插库失败：清掉刚写的文件，不留磁盘孤儿
      removeFiles(written.map((w) => w.filename));
      throw e;
    }
    return saved;
  });

  app.delete('/receipts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const receipt = db.prepare(`
      SELECT r.* FROM receipts r
      JOIN payments p ON p.id = r.payment_id
      JOIN orders o ON o.id = p.order_id
      WHERE r.id = ? AND o.deleted = 0`).get(id);
    if (!receipt) return reply.status(404).send({ message: '票据不存在（或订单已删除）' });
    db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
    removeFiles([receipt.filename]);
    return { ok: true };
  });
}
