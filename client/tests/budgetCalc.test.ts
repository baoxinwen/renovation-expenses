// 预算差额与可花池口径的单元测试（vitest）。
// 公式与缺口卡（GapCard）同源：已花现金流 = actual_total + unassigned_paid；
// 缺口 = 剩余要花(plan_total − actual_total) − 剩余可用(total_budget − 已花现金流)；
// 可花池 = 未买项目预算合计 − 缺口（超支时为未买项目的实际花费上限）。
import { describe, it, expect } from 'vitest';
import { budgetDelta, formatDelta, spendablePool } from '../src/utils/budgetCalc';
import type { PlanData } from '../src/api';

const plan = (over: Partial<PlanData>): PlanData => ({
  total_budget: 180000,
  plan_total: 183476.9,
  actual_total: 25049.79,
  unassigned_paid: 0,
  sections: [],
  ...over,
});

describe('budgetDelta（单品差额）', () => {
  it('超支：实付大于预算', () => {
    expect(budgetDelta(22000, 20000)).toEqual({ over: true, amount: 2000 });
  });
  it('结余：实付小于预算', () => {
    expect(budgetDelta(19199, 20000)).toEqual({ over: false, amount: 801 });
  });
  it('持平：amount 为 0、over 为 false', () => {
    expect(budgetDelta(20000, 20000)).toEqual({ over: false, amount: 0 });
  });
  it('分粒度差额如实归整（金额登记精度为分）', () => {
    expect(budgetDelta(20000.01, 20000)).toEqual({ over: true, amount: 0.01 });
  });
});

describe('formatDelta（差额文案）', () => {
  it('超支带加号前缀', () => {
    expect(formatDelta({ over: true, amount: 2000 })).toBe('超 ¥2,000.00');
  });
  it('结余带省字', () => {
    expect(formatDelta({ over: false, amount: 801 })).toBe('省 ¥801.00');
  });
  it('持平显示「与预算一致」', () => {
    expect(formatDelta({ over: false, amount: 0 })).toBe('与预算一致');
  });
});

describe('spendablePool（可花池三态）', () => {
  it('超支未平衡：pool = 未买预算合计 − 缺口', () => {
    // 已花 25049.79；剩余可用 = 180000−25049.79 = 154950.21；
    // 剩余要花 = 183476.9−25049.79 = 158427.11 → 缺口 3476.9 → 可花池 154950.21
    const p = plan({
      sections: [
        { id: 1, name: 'A', budget_subtotal: 25049.79, actual_subtotal: 25049.79, items: [{ bought: 1, budget_amount: 25049.79 }] },
        { id: 2, name: 'B', budget_subtotal: 158427.11, actual_subtotal: 0, items: [{ bought: 0, budget_amount: 158427.11 }] },
      ],
    } as Partial<PlanData>);
    const r = spendablePool(p);
    expect(r.state).toBe('over');
    expect(Math.abs(r.gap - 3476.9)).toBeLessThan(0.01);
    expect(Math.abs(r.unboughtBudget - 158427.11)).toBeLessThan(0.01);
    expect(Math.abs(r.pool - 154950.21)).toBeLessThan(0.01);
  });
  it('结余：缺口为负，pool 含富余', () => {
    const p = plan({
      total_budget: 5000,
      actual_total: 1000,
      plan_total: 4000,
      sections: [
        { id: 1, name: 'A', budget_subtotal: 1000, actual_subtotal: 1000, items: [{ bought: 1, budget_amount: 1000 }] },
        { id: 2, name: 'B', budget_subtotal: 3000, actual_subtotal: 0, items: [{ bought: 0, budget_amount: 3000 }] },
      ],
    } as Partial<PlanData>);
    const r = spendablePool(p);
    expect(r.state).toBe('under');
    expect(Math.abs(r.gap - (-1000))).toBeLessThan(0.01);
    expect(Math.abs(r.pool - 4000)).toBeLessThan(0.01);
  });
  it('持平：缺口为 0', () => {
    const p = plan({
      total_budget: 2000,
      actual_total: 1000,
      plan_total: 2000,
      sections: [
        { id: 1, name: 'A', budget_subtotal: 1000, actual_subtotal: 1000, items: [{ bought: 1, budget_amount: 1000 }] },
        { id: 2, name: 'B', budget_subtotal: 1000, actual_subtotal: 0, items: [{ bought: 0, budget_amount: 1000 }] },
      ],
    } as Partial<PlanData>);
    expect(spendablePool(p).state).toBe('even');
  });
  it('未挂项目的付款计入已花现金流（现金流口径）', () => {
    const base = plan({
      actual_total: 0,
      plan_total: 2000,
      unassigned_paid: 500,
      sections: [
        { id: 1, name: 'A', budget_subtotal: 1000, actual_subtotal: 0, items: [{ bought: 1, budget_amount: 1000 }] },
        { id: 2, name: 'B', budget_subtotal: 1000, actual_subtotal: 0, items: [{ bought: 0, budget_amount: 1000 }] },
      ],
    } as Partial<PlanData>);
    // 已花现金流 = 0 + 500；剩余可用 = 180000 − 500 = 179500；
    // 剩余要花 = 2000 − 0 = 2000 → 缺口 −177500（结余）。不计 unassigned 则为 −178000，可区分
    const r = spendablePool(base);
    expect(r.state).toBe('under');
    expect(Math.abs(r.gap - (-177500))).toBeLessThan(0.01);
    expect(Math.abs(r.pool - 178500)).toBeLessThan(0.01);
  });
});
