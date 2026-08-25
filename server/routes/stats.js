import db, { ITEM_ACTUAL_SQL } from '../db.js';

export default async function (app) {
  app.get('/stats/summary', async () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'total_budget'").get();
    const totalBudget = Number(row?.value ?? 0);
    const planTotal = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM items WHERE deleted = 0').get().s;
    // 预算基线：首次改价前的单价（未改过的用现价），用于展示"预算漂移"
    const initPlanTotal = db.prepare(
      'SELECT COALESCE(SUM(quantity * COALESCE(init_unit_price, unit_price)), 0) AS s FROM items WHERE deleted = 0'
    ).get().s;
    const actualTotal = db.prepare(
      `SELECT COALESCE(SUM(${ITEM_ACTUAL_SQL.replace(/i\./g, 't.')}), 0) AS s FROM items t WHERE t.deleted = 0`
    ).get().s;
    const unassignedPaid = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.item_id IS NULL AND o.deleted = 0`).get().s;
    const sections = db.prepare(`
      SELECT s.id, s.name, s.sort_order,
             COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS budget_subtotal,
             COALESCE((SELECT SUM(${ITEM_ACTUAL_SQL}) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS actual_subtotal,
             (SELECT COUNT(*) FROM items i WHERE i.section_id = s.id AND i.deleted = 0) AS item_count,
             (SELECT COUNT(*) FROM items i WHERE i.section_id = s.id AND i.deleted = 0 AND i.bought = 1) AS bought_count
      FROM sections s WHERE s.deleted = 0 ORDER BY s.sort_order, s.id`).all();
    return {
      total_budget: totalBudget,
      plan_total: planTotal,
      init_plan_total: initPlanTotal,
      actual_total: actualTotal,
      unassigned_paid: unassignedPaid,
      sections,
    };
  });

  app.get('/stats/charts', async () => {
    const bySection = db.prepare(`
      SELECT s.name AS name,
             COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS budget,
             COALESCE((SELECT SUM(${ITEM_ACTUAL_SQL}) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS actual
      FROM sections s
      WHERE s.deleted = 0 AND EXISTS (SELECT 1 FROM items i WHERE i.section_id = s.id AND i.deleted = 0)
      ORDER BY s.sort_order, s.id`).all();

    // 月度趋势 = 真实现金流：订单付款（含退款负数）+ 已买项支出（按购买日期）
    const byMonth = db.prepare(`
      SELECT month, ROUND(SUM(amount), 2) AS amount FROM (
        SELECT substr(p.pay_date, 1, 7) AS month, p.amount AS amount
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.deleted = 0
        UNION ALL
        SELECT substr(bought_date, 1, 7) AS month, quantity * unit_price AS amount
        FROM items WHERE deleted = 0 AND bought = 1 AND bought_date IS NOT NULL
      ) GROUP BY month ORDER BY month`).all();

    const topItems = db.prepare(`
      SELECT i.id AS id, i.name AS name, (i.quantity * i.unit_price) AS budget,
             (${ITEM_ACTUAL_SQL}) AS actual
      FROM items i WHERE i.deleted = 0 ORDER BY budget DESC LIMIT 10`).all();

    const recentPayments = db.prepare(`
      SELECT p.id, p.amount, p.pay_date, p.method, p.note,
             o.id AS order_id, o.title AS order_title,
             i.name AS item_name, s.name AS section_name
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN items i ON i.id = o.item_id
      LEFT JOIN sections s ON s.id = i.section_id
      WHERE o.deleted = 0
      ORDER BY p.pay_date DESC, p.id DESC LIMIT 10`).all();

    return { by_section: bySection, by_month: byMonth, top_items: topItems, recent_payments: recentPayments };
  });
}
