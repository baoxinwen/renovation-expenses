import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { ChartCard, fmtAxisWan, useChartTheme } from './shared';

// 月度累计支出曲线（spec 功能 D）：by_month 前缀和 + 预算目标水平虚线。
// 未设预算不画线、图内角标提示（D-2）；空数据显示空态（D-3）
export default function CumulativeChart({ charts, totalBudget }: {
  charts: Charts | null;
  totalBudget: number;
}) {
  const { isMobile, themeName, colors, pal } = useChartTheme();
  const byMonth = charts?.by_month ?? [];

  const cum = useMemo(() => {
    let acc = 0;
    return byMonth.map((m) => ({ month: m.month, cum: (acc += m.amount) }));
  }, [byMonth]);

  const option = useMemo(() => ({
    // hover 双行：当月金额 + 累计金额（spec D-1）
    tooltip: {
      trigger: 'axis',
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const m = byMonth[i];
        if (!m) return '';
        return `${m.month}<br/>当月 ${fmtMoney(m.amount)}<br/>累计 ${fmtMoney(cum[i]?.cum ?? 0)}`;
      },
    },
    grid: { left: isMobile ? 56 : 70, right: isMobile ? 16 : 24, top: 24, bottom: 30 },
    xAxis: { type: 'category', data: cum.map((c) => c.month) },
    yAxis: { type: 'value', axisLabel: { formatter: fmtAxisWan } },
    series: [{
      type: 'line',
      data: cum.map((c) => c.cum),
      smooth: true,
      itemStyle: { color: colors.actual },
      lineStyle: { width: 2.5 },
      areaStyle: { opacity: 0.1 },
      markLine: totalBudget > 0
        ? {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: pal.over, width: 1.5 },
            label: { formatter: '预算目标', position: 'insideEndTop', color: pal.over, fontSize: 11 },
            data: [{ yAxis: totalBudget }],
          }
        : undefined,
    }],
    graphic: totalBudget > 0
      ? undefined
      : [{ type: 'text', right: 14, top: 14, style: { text: '未设置预算目标', fill: pal.neutral, fontSize: 12 } }],
  }), [cum, byMonth, isMobile, colors, pal, totalBudget]);

  return (
    <ChartCard
      title="累计支出 vs 预算目标"
      isEmpty={cum.length === 0}
      emptyText="还没有付款记录——到订单页记第一笔定金"
    >
      <ReactECharts option={option} theme={themeName} notMerge style={{ height: 300 }} />
    </ChartCard>
  );
}
