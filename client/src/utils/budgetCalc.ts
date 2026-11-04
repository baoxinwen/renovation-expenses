// 预算差额与可花池的口径唯一出处（前端）。
// 口径与缺口卡/分析页同源：已花现金流 = actual_total + unassigned_paid（含未挂项目的付款）；
// 缺口 = 剩余要花(plan_total − actual_total) − 剩余可用(total_budget − 已花现金流)；
// 可花池 = 未买项目预算合计 − 缺口，超支时即"未买项目的实际花费上限"。

/** 单品差额：实付与预算的差。over=true 为超支；分内尾差（<0.005）视为持平。 */
export function budgetDelta(actual: number, budget: number): { over: boolean; amount: number } {
  const diff = Number((actual - budget).toFixed(2));
  return { over: diff > 0, amount: Math.abs(diff) };
}

/** 差额文案：超支带"超"字与前缀符号，结余带"省"，持平显示一致。 */
export function formatDelta(d: { over: boolean; amount: number }): string {
  if (d.amount === 0) return '与预算一致';
  const money = `¥${d.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return d.over ? `超 ${money}` : `省 ${money}`;
}

/** 可花池三态与关键数值。 */
export interface SpendablePool {
  state: 'over' | 'even' | 'under';
  /** 缺口：>0 超支未平衡，<0 结余富余 */
  gap: number;
  /** 未买项目预算合计（入参 sections 无 items 时为 0，此时仅 gap 可信） */
  unboughtBudget: number;
  /** 未买项目的实际花费上限：超支时 = 合计 − 缺口；结余时 = 合计 + 富余 */
  pool: number;
}

/** 结构化最小入参：Summary 与 PlanData 均满足。
 *  sections 仅按形状探测未买项目（元素含 items[].bought/budget_amount 即可计入未买预算）；
 *  缺省（如 Summary 语境不含 items）时 unboughtBudget/pool 返回 0，仅 gap 可信。 */
export interface SpendablePoolInput {
  total_budget: number;
  plan_total: number;
  actual_total: number;
  unassigned_paid: number;
  sections?: unknown[];
}

export function spendablePool(p: SpendablePoolInput): SpendablePool {
  // 已花现金流 = 项目实付合计 + 未挂项目的订单付款（与月度趋势/缺口卡口径一致）
  const cashSpent = p.actual_total + p.unassigned_paid;
  const remainingBudget = p.total_budget - cashSpent;
  const remainingToSpend = p.plan_total - p.actual_total;
  const gap = Number((remainingToSpend - remainingBudget).toFixed(2));
  // 未买项目预算合计：从 sections 汇总未买项（挂单未买的项目也按"未买"计，其实付已含在 cashSpent）
  const unboughtBudget = Number(
    (p.sections ?? [])
      .flatMap((s) => (Array.isArray((s as { items?: unknown }).items) ? (s as { items: { bought: number; budget_amount: number }[] }).items : []))
      .filter((it) => !it.bought)
      .reduce((sum, it) => sum + it.budget_amount, 0)
      .toFixed(2),
  );
  const state = gap > 0 ? 'over' : gap < 0 ? 'under' : 'even';
  return { state, gap, unboughtBudget, pool: Number((unboughtBudget - gap).toFixed(2)) };
}
