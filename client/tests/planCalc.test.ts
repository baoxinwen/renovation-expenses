// planCalc（清单/统计可测纯逻辑）单元测试
import { describe, it, expect } from 'vitest';
import { fmtAxisWan, executionColor, pieData, heatLevels, matchSearch, escapeHtml } from '../src/utils/planCalc';
import { paidPrefill } from '../src/utils/domain';

describe('fmtAxisWan（万元缩写）', () => {
  it('万级缩写', () => expect(fmtAxisWan(20000)).toBe('2万'));
  it('小数万保留小数', () => expect(fmtAxisWan(25000)).toBe('2.5万'));
  it('千级原样', () => expect(fmtAxisWan(9999)).toBe('9999'));
  it('零与负数原样', () => {
    expect(fmtAxisWan(0)).toBe('0');
    expect(fmtAxisWan(-300)).toBe('-300');
  });
});

describe('executionColor（执行率阈值着色）', () => {
  const dark = false;
  const [ok, warn, over] = (() => {
    // 三态色互不相同且按阈值切换
    return [
      executionColor(0.5, dark),
      executionColor(0.95, dark),
      executionColor(1.05, dark),
    ];
  })();
  it('健康区（<90%）为绿', () => expect(executionColor(0.5, dark)).toBe(ok));
  it('预警区（≥90%）为橙', () => expect(executionColor(0.9, dark)).toBe(warn));
  it('超支区（>100%）为红', () => expect(executionColor(1.001, dark)).toBe(over));
  it('边界：90% 整属预警、100% 整属预警（未超不算红）', () => {
    expect(executionColor(0.9, dark)).toBe(warn);
    expect(executionColor(1.0, dark)).toBe(warn);
  });
  it('三档颜色互不相同', () => {
    expect(new Set([ok, warn, over]).size).toBe(3);
  });
});

describe('pieData（零值过滤）', () => {
  const sections = [
    { name: 'A', budget: 100, actual: 0 },
    { name: 'B', budget: 0, actual: 200 },
    { name: 'C', budget: 0, actual: 0 },
  ];
  it('预算口径：0 值板块不出扇区', () => {
    expect(pieData(sections, 'budget')).toEqual([{ name: 'A', value: 100 }]);
  });
  it('实际口径：0 值板块不出扇区', () => {
    expect(pieData(sections, 'actual')).toEqual([{ name: 'B', value: 200 }]);
  });
});

describe('heatLevels（热力图分位阈值）', () => {
  it('常规分布取中位与高分位', () => {
    const { q50, q90 } = heatLevels([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(q50).toBe(600); // floor(10*0.5)=5 → sorted[5]
    expect(q90).toBe(1000); // floor(10*0.9)=9 → sorted[9]
  });
  it('单元素：两档收敛到同一值', () => {
    expect(heatLevels([500])).toEqual({ q50: 500, q90: 500 });
  });
  it('悬殊分布：分位自适应不失效', () => {
    const { q50, q90 } = heatLevels([1, 2, 3, 100000]);
    expect(q90).toBeGreaterThanOrEqual(q50);
    expect(q50).toBeGreaterThan(0);
  });
});

describe('matchSearch（清单搜索过滤）', () => {
  const it_ = { name: '米家冰箱Pro', spec: '法式508L', note: '已买' };
  it('命中项目名（大小写不敏感）', () => {
    expect(matchSearch(it_, '冰箱')).toBe(true);
    expect(matchSearch(it_, 'MIX')).toBe(false);
  });
  it('命中规格', () => expect(matchSearch(it_, '508l')).toBe(true));
  it('命中备注', () => expect(matchSearch(it_, '已买')).toBe(true));
  it('空串视为全通过', () => expect(matchSearch(it_, '')).toBe(true));
  it('未命中返回 false', () => expect(matchSearch(it_, '洗衣机')).toBe(false));
});

describe('escapeHtml（tooltip 注入防护）', () => {
  it('尖括号与引号全部转义', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('文本中的 & 与引号转义且不影响普通中文', () => {
    expect(escapeHtml('瓷砖&大理石 "A" \'B\''))
      .toBe('瓷砖&amp;大理石 &quot;A&quot; &#39;B&#39;');
  });
  it('转义后不再包含裸 <', () => {
    expect(escapeHtml('<script>').includes('<')).toBe(false);
  });
});

describe('paidPrefill（购买登记实付预填）', () => {
  const base = { bought: 0, paid_amount: null as number | null, quantity: 4, unit_price: 25 };
  it('未买项预填数量×单价（数量>1 不再记错账）', () => {
    expect(paidPrefill({ ...base })).toBe(100);
  });
  it('已买且登记过实付 → 预填原实付（修正语义）', () => {
    expect(paidPrefill({ ...base, bought: 1, paid_amount: 90 })).toBe(90);
  });
  it('已买但实付为空 → 回退数量×单价', () => {
    expect(paidPrefill({ ...base, bought: 1, paid_amount: null })).toBe(100);
  });
  it('浮点合计按两位归整', () => {
    expect(paidPrefill({ ...base, quantity: 3, unit_price: 33.333 })).toBe(100);
  });
});
