import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { ChartCard, fmtAxisWan, useChartTheme } from './shared';

// 时间区：月度付款柱状图（含已买支出；自原 Analysis 迁入，口径与展示不变）
export default function MonthlyChart({ charts }: { charts: Charts | null }) {
  const { isMobile, themeName, colors } = useChartTheme();
  const byMonth = charts?.by_month ?? [];

  const option = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtMoney(v) },
    grid: { left: isMobile ? 56 : 70, right: isMobile ? 12 : 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: byMonth.map((m) => m.month) },
    yAxis: { type: 'value', axisLabel: { formatter: fmtAxisWan } },
    series: [{
      type: 'bar',
      data: byMonth.map((m) => m.amount),
      barMaxWidth: 42,
      itemStyle: { color: colors.actual, borderRadius: [4, 4, 0, 0] },
    }],
  }), [byMonth, isMobile, colors]);

  return (
    <ChartCard
      title="月度付款趋势（含已买支出）"
      isEmpty={byMonth.length === 0}
      emptyText="还没有付款记录——到订单页记第一笔定金"
    >
      <ReactECharts option={option} theme={themeName} notMerge style={{ height: 300 }} />
    </ChartCard>
  );
}
