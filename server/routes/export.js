import ExcelJS from 'exceljs';
import db, { ITEM_ACTUAL_SQL } from '../db.js';

const MONEY = '#,##0.00';

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  row.height = 20;
}

export default async function (app) {
  app.get('/export/excel', async (_req, reply) => {
    const settingsRow = db.prepare("SELECT value FROM settings WHERE key = 'total_budget'").get();
    const totalBudget = Number(settingsRow?.value ?? 0);
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
    // 「实际已花」与应用首页口径对齐：已买项总价 + 有效订单(挂有效项目)付款；未关联付款单列
    const boughtTotal = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM items WHERE deleted = 0 AND bought = 1').get().s;
    const linkedPaid = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p
      JOIN orders o ON o.id = p.order_id
      JOIN items i ON i.id = o.item_id
      WHERE o.deleted = 0 AND i.deleted = 0`).get().s;
    const actualLikeApp = boughtTotal + linkedPaid;
    const unassignedPaid = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.item_id IS NULL AND o.deleted = 0`).get().s;

    const wb = new ExcelJS.Workbook();
    wb.creator = '装修账本';

    // ===== Sheet1 预算清单（与评估表同构，公式联动）=====
    const ws = wb.addWorksheet('预算评估表');
    ws.columns = [
      { header: '序号', key: 'seq', width: 6 },
      { header: '项目名称', key: 'name', width: 22 },
      { header: '规格 / 品牌', key: 'spec', width: 34 },
      { header: '单位', key: 'unit', width: 6 },
      { header: '数量', key: 'quantity', width: 7 },
      { header: '单价（元）', key: 'unit_price', width: 11, style: { numFmt: MONEY } },
      { header: '总价（元）', key: 'total_formula', width: 13, style: { numFmt: MONEY } },
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
      const secCell = ws.getCell(`B${r}`);
      secCell.value = `【${sec.name}】`;
      secCell.font = { bold: true, size: 12 };
      items.forEach((it) => {
        ++r;
        seq += 1;
        ws.getRow(r).values = [seq, it.name, it.spec, it.unit, it.quantity, it.unit_price,
          { formula: `E${r}*F${r}` },
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
    ws.getCell(`B${targetRow + 4}`).value = '未关联项目付款（不计入上方实际）';
    ws.getCell(`D${targetRow + 4}`).value = unassignedPaid;

    // ===== Sheet2 付款明细 =====
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

    // ===== Sheet3 板块汇总 =====
    const wss = wb.addWorksheet('板块汇总');
    wss.columns = [
      { header: '板块', key: 'name', width: 16 },
      { header: '项目数', key: 'item_count', width: 8 },
      { header: '预算小计', key: 'budget', width: 14, style: { numFmt: MONEY } },
      { header: '实际小计', key: 'actual', width: 14, style: { numFmt: MONEY } },
      { header: '差异（实际-预算）', key: 'diff', width: 16, style: { numFmt: MONEY } },
    ];
    styleHeader(wss);
    const sectionStats = db.prepare(`
      SELECT s.name,
             (SELECT COUNT(*) FROM items i WHERE i.section_id = s.id AND i.deleted = 0) AS item_count,
             COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS budget,
             COALESCE((SELECT SUM(${ITEM_ACTUAL_SQL}) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS actual
      FROM sections s WHERE s.deleted = 0 ORDER BY s.sort_order, s.id`).all();
    sectionStats.forEach((s) => wss.addRow({ ...s, diff: s.actual - s.budget }));

    const date = new Date().toLocaleDateString('sv-SE');
    const filename = encodeURIComponent(`装修预算清单_${date}.xlsx`);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
}
