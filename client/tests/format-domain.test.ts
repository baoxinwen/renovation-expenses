// format.ts 与 domain.ts 纯函数的单元测试（金额格式化与订单口径）
import { describe, it, expect } from 'vitest';
import { fmtMoney } from '../src/format';
import { isUnsettled, unpaidOf, doubleCountRisk } from '../src/utils/domain';
import type { Item, Order } from '../src/api';

describe('fmtMoney（金额格式化）', () => {
  it('正数千分位 + 两位小数', () => expect(fmtMoney(1234.5)).toBe('¥1,234.50'));
  it('负数带减号前缀（无括号）', () => expect(fmtMoney(-86.7)).toBe('-¥86.70'));
  it('零显示 ¥0.00', () => expect(fmtMoney(0)).toBe('¥0.00'));
  it('null/undefined 回落为 0', () => {
    expect(fmtMoney(null)).toBe('¥0.00');
    expect(fmtMoney(undefined)).toBe('¥0.00');
  });
});

describe('isUnsettled / unpaidOf（待付尾款口径）', () => {
  const order = (total: number, paid?: number): Order =>
    ({ total_amount: total, paid } as Order);
  it('未付清且总额>0 → 未结清', () => expect(isUnsettled(order(100, 30))).toBe(true));
  it('零总额订单不算未结清', () => expect(isUnsettled(order(0, 0))).toBe(false));
  it('已付清不算未结清', () => expect(isUnsettled(order(100, 100))).toBe(false));
  it('无付款记录（paid undefined）全额待付', () => expect(unpaidOf(order(100))).toBe(100));
  it('部分付款取差值', () => expect(unpaidOf(order(100, 30))).toBe(70));
  it('超付不为负（钳到 0）', () => expect(unpaidOf(order(100, 120))).toBe(0));
});

describe('doubleCountRisk（双算守卫口径）', () => {
  const item = (bought: number, order_paid: number): Item =>
    ({ bought, order_paid } as Item);
  it('未买但有挂单付款 → 有双算风险', () => expect(doubleCountRisk(item(0, 500))).toBe(true));
  it('已买 + 有付款 → 不算风险（显式选择的口径）', () => expect(doubleCountRisk(item(1, 500))).toBe(false));
  it('未买无付款 → 无风险', () => expect(doubleCountRisk(item(0, 0))).toBe(false));
});
