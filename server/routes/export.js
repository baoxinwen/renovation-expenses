import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';
import { ZipArchive } from 'archiver';
import db, { itemActualSQL, UPLOAD_DIR, getTotalBudget } from '../db.js';

const MONEY = '#,##0.00';

// finalize() 返回的 Promise 必须接住：打包中 zip 模块读流出错时，error 事件侧已有监听记日志，
// 但该 Promise 若无消费者会以 unhandledRejection 终止整个进程（Node ≥15 默认 throw）
export function finalizeArchive(archive, log) {
  archive.finalize().catch((err) => log.error({ err }, '票据打包 finalize 失败'));
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  row.height = 20;
}

// ===== Sheet 构建函数（导出主流程拆分）=====

// Sheet1 预算评估表：与用户评估表同构，公式联动
function buildBudgetSheet(wb, { sections, itemsBySection, totalBudget, actualLikeApp }) {
  const ws = wb.addWorksheet('预算评估表');
  ws.columns = [
    { header: '序号', key: 'seq', width: 6 },
    { header: '项目名称', key: 'name', width: 22 },
    { header: '规格 / 品牌', key: 'spec', width: 34 },
    { header: '单位', key: 'unit', width: 6 },
    { header: '数量', key: 'quantity', width: 7 },
    { header: '单价（元）', key: 'unit_price', width: 11, style: { numFmt: MONEY } },
    { header: '总预算（元）', key: 'total_formula', width: 13, style: { numFmt: MONEY } },
    { header: '实际支付（元）', key: 'paid_amount', width: 13, style: { numFmt: MONEY } },
    { header: '已买', key: 'bought_cn', width: 6 },
    { header: '备注', key: 'note', width: 28 },
  ];
  styleHeader(ws);

  let seq = 0;
  let r = 1; // 当前行号（1 起）
  const subtotalCells = [];
  sections.forEach((sec) => {
    const items = itemsBySection.all(sec.id);
    if (!items.length) return;
    const secRow = ++r;
    // 板块名写在第 1 列（与用户评估表一致），保证导出文件可再导入还原板块结构
    const secCell = ws.getCell(`A${r}`);
    secCell.value = `【${sec.name}】`;
    secCell.font = { bold: true, size: 12 };
    items.forEach((it) => {
      ++r;
      seq += 1;
      // 实付金额：已买填登记值（未登记回退数量×单价），未买留空
      const paidVal = it.bought ? (it.paid_amount ?? Number((it.quantity * it.unit_price).toFixed(2))) : '';
      ws.getRow(r).values = [seq, it.name, it.spec, it.unit, it.quantity, it.unit_price,
        { formula: `E${r}*F${r}` },
        paidVal,
        it.bought ? '✓' : '',
        it.note];
    });
    const subRow = ++r;
    ws.getCell(`B${subRow}`).value = `${sec.name} 小计`;
    ws.getCell(`G${subRow}`).value = { formula: `SUM(G${secRow + 1}:G${subRow - 1})` };
    subtotalCells.push(`G${subRow}`);
    ws.getRow(subRow).font = { bold: true };
  });
  const totalRow = ++r;
  ws.getCell(`B${totalRow}`).value = '全案预算总计';
  ws.getCell(`G${totalRow}`).value = subtotalCells.length
    ? { formula: subtotalCells.join('+') }
    : 0;
  ws.getRow(totalRow).font = { bold: true, size: 12 };

  const targetRow = ++r + 1;
  ws.getCell(`B${targetRow}`).value = '预算目标（元）';
  ws.getCell(`D${targetRow}`).value = totalBudget;
  ws.getCell(`B${targetRow + 1}`).value = '清单总计（元）';
  ws.getCell(`D${targetRow + 1}`).value = { formula: `G${totalRow}` };
  ws.getCell(`B${targetRow + 2}`).value = '超支 / 结余（元）';
  ws.getCell(`D${targetRow + 2}`).value = { formula: `D${targetRow + 1}-D${targetRow}` };
  ws.getCell(`F${targetRow + 2}`).value = '正数=清单超目标，负数=未超';
  ws.getCell(`B${targetRow + 3}`).value = '实际已花（口径同应用：已买+挂单付款）';
  ws.getCell(`D${targetRow + 3}`).value = actualLikeApp;
}

// Sheet2 付款明细
function buildPaymentSheet(wb, { payments, totalSpent }) {
  const wsp = wb.addWorksheet('付款明细');
  wsp.columns = [
    { header: '付款日期', key: 'pay_date', width: 12 },
    { header: '订单', key: 'order_title', width: 22 },
    { header: '预算项目', key: 'item_name', width: 18 },
    { header: '板块', key: 'section_name', width: 14 },
    { header: '商家', key: 'vendor', width: 16 },
    { header: '金额', key: 'amount', width: 12, style: { numFmt: MONEY } },
    { header: '付款方式', key: 'method', width: 10 },
    { header: '备注', key: 'note', width: 26 },
  ];
  styleHeader(wsp);
  payments.forEach((p) => wsp.addRow(p));
  if (payments.length) {
    const sumRow = wsp.addRow({ pay_date: '合计', amount: totalSpent });
    sumRow.font = { bold: true };
  }
}

// Sheet3 板块汇总
function buildSectionSheet(wb, sectionStats) {
  const wss = wb.addWorksheet('板块汇总');
  wss.columns = [
    { header: '板块', key: 'name', width: 16 },
    { header: '项目数', key: 'item_count', width: 8 },
    { header: '预算小计', key: 'budget', width: 14, style: { numFmt: MONEY } },
    { header: '实际小计', key: 'actual', width: 14, style: { numFmt: MONEY } },
    { header: '差异（实际-预算）', key: 'diff', width: 16, style: { numFmt: MONEY } },
  ];
  styleHeader(wss);
  sectionStats.forEach((s) => wss.addRow({ ...s, diff: s.actual - s.budget }));
}

export default async function (app) {
  app.get('/export/excel', async (_req, reply) => {
    const totalBudget = getTotalBudget();
    const sections = db.prepare('SELECT * FROM sections WHERE deleted = 0 ORDER BY sort_order, id').all();
    const itemsBySection = db.prepare('SELECT * FROM items WHERE section_id = ? AND deleted = 0 ORDER BY sort_order, id');
    const payments = db.prepare(`
      SELECT p.pay_date, p.amount, p.method, p.note,
             o.title AS order_title, o.vendor,
             i.name AS item_name, s.name AS section_name
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN items i ON i.id = o.item_id
      LEFT JOIN sections s ON s.id = i.section_id
      WHERE o.deleted = 0
      ORDER BY p.pay_date, p.id`).all();
    const totalSpent = payments.reduce((s, p) => s + p.amount, 0);
    // 「实际已花」与应用首页口径对齐：已买项总价 + 有效订单(挂有效项目)付款（口径唯一出处见 db.js itemActualSQL）
    const boughtTotal = db.prepare('SELECT COALESCE(SUM(COALESCE(paid_amount, quantity * unit_price)), 0) AS s FROM items WHERE deleted = 0 AND bought = 1').get().s;
    const linkedPaid = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p
      JOIN orders o ON o.id = p.order_id
      JOIN items i ON i.id = o.item_id
      WHERE o.deleted = 0 AND i.deleted = 0`).get().s;
    const actualLikeApp = boughtTotal + linkedPaid;

    const wb = new ExcelJS.Workbook();
    wb.creator = '装修账本';

    buildBudgetSheet(wb, { sections, itemsBySection, totalBudget, actualLikeApp });

    buildPaymentSheet(wb, { payments, totalSpent });

    const sectionStats = db.prepare(`
      SELECT s.name,
             (SELECT COUNT(*) FROM items i WHERE i.section_id = s.id AND i.deleted = 0) AS item_count,
             COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS budget,
             COALESCE((SELECT SUM(${itemActualSQL('i')}) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS actual
      FROM sections s WHERE s.deleted = 0 ORDER BY s.sort_order, s.id`).all();
    buildSectionSheet(wb, sectionStats);

    const date = new Date().toLocaleDateString('sv-SE');
    const filename = encodeURIComponent(`装修预算清单_${date}.xlsx`);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });

  // ===== 票据照片打包 zip（按订单，维权/对账直接发人） =====
  app.get('/export/receipts', async (req, reply) => {
    const rawOrderId = req.query.order_id;
    const orderId = rawOrderId ? Number(rawOrderId) : null;
    if (orderId != null && (!Number.isInteger(orderId) || orderId <= 0)) {
      return reply.status(400).send({ message: 'order_id 无效' });
    }
    const params = orderId ? [orderId] : [];
    const rows = db.prepare(`
      SELECT o.id AS order_id, o.title, o.vendor, p.pay_date, p.amount, p.method, p.note AS pay_note,
             r.filename, r.original_name
      FROM orders o
      JOIN payments p ON p.order_id = o.id
      JOIN receipts r ON r.payment_id = p.id
      WHERE o.deleted = 0 ${orderId ? 'AND o.id = ?' : ''}
      ORDER BY o.id, p.pay_date, r.id`).all(...params);
    if (!rows.length) return reply.status(404).send({ message: '没有可导出的票据照片' });

    // 磁盘缺失的票据跳过并留痕（备份部分恢复/手工清理会出现）：
    // archiver 对 ENOENT 只发 warning 仍出包，但清单若按库记录生成会「声称 N 张、包里 M 张」；
    // 其余读流错误若无监听会变成 uncaught exception，故显式接管 error。
    const existing = rows.filter((r) => fs.existsSync(path.join(UPLOAD_DIR, r.filename)));
    const missing = rows.length - existing.length;
    if (missing) req.log.warn(`票据导出：${missing} 个文件已不在磁盘，已跳过`);
    if (!existing.length) return reply.status(404).send({ message: '没有可导出的票据照片' });

    const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_');
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', (err) => req.log.error({ err }, '票据打包失败'));
    const seen = new Set();
    existing.forEach((r) => {
      let entry = `${safe(r.title)}_${r.order_id}/${r.pay_date}_${r.amount}元/${safe(r.original_name)}`;
      let n = 2;
      while (seen.has(entry)) entry = `${safe(r.title)}_${r.order_id}/${r.pay_date}_${r.amount}元/${n++}_${safe(r.original_name)}`;
      seen.add(entry);
      archive.file(path.join(UPLOAD_DIR, r.filename), { name: entry });
    });
    const manifest = existing.map((r) =>
      `${r.title}（${r.vendor || '商家未填'}）｜${r.pay_date}｜${r.amount} 元｜${r.method || '方式未填'}｜票据：${r.original_name}${r.pay_note ? `｜${r.pay_note}` : ''}`
    ).join('\n');
    archive.append(`票据清单（${existing.length} 张${missing ? `，另有 ${missing} 张文件缺失未打包` : ''}）\n生成时间：${new Date().toLocaleString('zh-CN')}\n\n${manifest}\n`, { name: '票据清单.txt' });
    finalizeArchive(archive, req.log);

    const label = orderId ? safe(existing[0].title) : '全部订单';
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`票据_${label}.zip`)}`);
    return reply.send(archive);
  });
}
