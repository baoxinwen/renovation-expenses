import db, { itemActualSQL, sectionAggregatesSQL, getTotalBudget } from '../db.js';

export default async function (app) {
  app.get('/stats/summary', async () => {
    const totalBudget = getTotalBudget();
    const planTotal = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM items WHERE deleted = 0').get().s;
    const actualTotal = db.prepare(
      `SELECT COALESCE(SUM(${itemActualSQL('items').trim()}), 0) AS s FROM items WHERE items.deleted = 0`
    ).get().s;
    const unassignedPaid = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.item_id IS NULL AND o.deleted = 0`).get().s;
    const sections = db.prepare(`
      SELECT s.id, s.name, s.sort_order,
             ${sectionAggregatesSQL()},
             (SELECT COUNT(*) FROM items i WHERE i.section_id = s.id AND i.deleted = 0) AS item_count,
             (SELECT COUNT(*) FROM items i WHERE i.section_id = s.id AND i.deleted = 0 AND i.bought = 1) AS bought_count
      FROM sections s WHERE s.deleted = 0 ORDER BY s.sort_order, s.id`).all();
    return {
      total_budget: totalBudget,
      plan_total: planTotal,
      actual_total: actualTotal,
      unassigned_paid: unassignedPaid,
      sections,
    };
  });

  app.get('/stats/charts', async () => {
    const actual = itemActualSQL('i');
    const bySection = db.prepare(`
      SELECT s.name AS name,
             COALESCE((SELECT SUM(i.quantity * i.unit_price) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS budget,
             COALESCE((SELECT SUM(${actual}) FROM items i WHERE i.section_id = s.id AND i.deleted = 0), 0) AS actual
      FROM sections s
      WHERE s.deleted = 0 AND EXISTS (SELECT 1 FROM items i WHERE i.section_id = s.id AND i.deleted = 0)
      ORDER BY s.sort_order, s.id`).all();

    // 月度趋势 = 真实现金流：订单付款（含退款负数）+ 已买项支出（按购买日期）
    // 口径约定：挂在软删项目上的订单付款不计（与"实际已花"合计一致，恢复项目后自动回来）
    const byMonth = db.prepare(`
      SELECT month, ROUND(SUM(amount), 2) AS amount FROM (
        SELECT substr(p.pay_date, 1, 7) AS month, p.amount AS amount
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN items di ON di.id = o.item_id
        WHERE o.deleted = 0 AND (o.item_id IS NULL OR di.deleted = 0)
        UNION ALL
        SELECT substr(bought_date, 1, 7) AS month, quantity * unit_price AS amount
        FROM items WHERE deleted = 0 AND bought = 1 AND bought_date IS NOT NULL
      ) GROUP BY month ORDER BY month`).all();

    const topItems = db.prepare(`
      SELECT i.id AS id, i.name AS name, (i.quantity * i.unit_price) AS budget,
             (${actual}) AS actual
      FROM items i WHERE i.deleted = 0 ORDER BY budget DESC LIMIT 10`).all();

    const recentPayments = db.prepare(`
      SELECT p.id, p.amount, p.pay_date, p.method, p.note,
             o.id AS order_id, o.title AS order_title,
             i.name AS item_name, s.name AS section_name
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN items i ON i.id = o.item_id
      LEFT JOIN sections s ON s.id = i.section_id
      WHERE o.deleted = 0 AND (o.item_id IS NULL OR i.deleted = 0)
      ORDER BY p.pay_date DESC, p.id DESC LIMIT 10`).all();

    return { by_section: bySection, by_month: byMonth, top_items: topItems, recent_payments: recentPayments };
  });
}
