import { useMemo } from 'react';
import { Card, Empty } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { Summary } from '../../api';
import { useChartTheme } from './shared';

// 总预算仪表盘（spec 功能 C）：已花现金流 ÷ 预算目标。
// 现金流口径 = actual_total + unassigned_paid（与月度趋势一致，含未挂项目的订单付款）
export default function BudgetGauge({ summary }: { summary: Summary | null }) {
  const { themeName, pal } = useChartTheme();
  const budget = summary?.total_budget ?? 0;
  const cashSpent = (summary?.actual_total ?? 0) + (summary?.unassigned_paid ?? 0);
  const pct = budget > 0 ? cashSpent / budget : null;
  // 进度弧按 spec C-1 阈值取色：<80% 绿 / ≥80% 且 <100% 橙 / ≥100% 红
  const stageColor = pct === null ? pal.neutral : pct >= 1 ? pal.over : pct >= 0.8 ? pal.warn : pal.ok;

  const option = useMemo(() => ({
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      // 底槽色带只表达刻度区间：0~80% 健康、80%~100% 预警；≥100% 的超支红由进度弧承担
      axisLine: { lineStyle: { width: 14, color: [[0.8, pal.ok], [1, pal.warn]] } },
      progress: { show: true, width: 14, roundCap: true, itemStyle: { color: stageColor } },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        offsetCenter: [0, 0],
        fontSize: 22,
        fontWeight: 600,
        formatter: () => (pct === null ? '' : Math.round(pct * 100) + '%'),
      },
      data: [{ value: pct === null ? 0 : Math.min(pct * 100, 100) }],
    }],
  }), [pct, pal, stageColor]);

  // 未设预算：引导态，不出现除零（spec C-2）；option 的 useMemo 须在早退前执行（hook 顺序）
  if (pct === null) {
    return (
      <Card title="预算健康度" size="small">
        <Empty description="先到设置里填预算目标" style={{ padding: 24 }} />
      </Card>
    );
  }

  return (
    <Card title="预算健康度" size="small">
      <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, marginBottom: -8 }}>
        已花 {Math.round(cashSpent)} / 目标 {Math.round(budget)}（含未挂项目付款）
      </div>
      <div data-testid="budget-gauge-chart">
        <ReactECharts option={option} theme={themeName} notMerge style={{ height: 200 }} />
      </div>
    </Card>
  );
}
