// @vitest-environment jsdom
// ItemFormModal 实付口径（2026-11-20 门禁桌面 I-2）：编辑「已买且未登记实付」
// （Excel 导入可达）的项目时，实付框必须保持空（placeholder「未登记」）——
// 预填数量×单价会让「不改直接保存」把动态回退口径静默固化成显式数值，
// 此后调整数量/单价时实际支出不再跟随。已登记的实付照常回填。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ItemFormModal, { type ItemFormResult } from '../src/components/ItemFormModal';
import type { Item } from '../src/api';

beforeAll(() => {
  // jsdom 缺 antd 依赖的浏览器 API，补最小桩
  window.matchMedia = window.matchMedia || ((media: string) => ({
    matches: false, media, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  (window as { ResizeObserver?: unknown }).ResizeObserver =
    window.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
});

// vitest 未开 globals，testing-library 的自动清理不生效——手动逐例清 DOM，
// 否则上一例的 modal 残留会让「取第一个匹配」的查询拿到旧值
afterEach(cleanup);

const baseItem = {
  id: 1, section_id: 1, name: '测试项目', spec: '', unit: '', quantity: 2,
  unit_price: 100, bought: 1, bought_date: null, paid_amount: null as number | null,
  note: '', sort_order: 0, budget_amount: 200, actual_amount: 200, order_count: 0, order_paid: 0,
} as Item;

/** 实付输入框（占位符「未登记」唯一，不受其他两个数字框干扰） */
const paidInput = () => document.querySelector<HTMLInputElement>('input[placeholder="未登记"]');
const openModal = (item: Item, onOk: (v: ItemFormResult) => void) =>
  render(<ItemFormModal open initial={item} onOk={onOk} onCancel={() => {}} />);

describe('ItemFormModal 实付口径', () => {
  it('已买未登记实付：打开编辑不预填回退值（保持空）', () => {
    openModal(baseItem, () => {});
    expect(paidInput()).not.toBeNull();
    expect(paidInput()!.value).toBe('');
  });

  it('已买且已登记实付：照常回填原值', () => {
    openModal({ ...baseItem, paid_amount: 88.5 }, () => {});
    expect(paidInput()!.value).toBe('88.50'); // InputNumber precision=2 两位显示
  });

  it('未登记时直接保存：提交 null（保持动态回退口径），不落预填数值', async () => {
    let captured: ItemFormResult | null = null;
    openModal(baseItem, (v) => { captured = v; });
    // antd Button 会在两个汉字间自动插空格，可访问名是「保 存」
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.paid_amount).toBeNull();
  });
});
