import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import type { PlanData } from '../../api';
import { ChartCard, executionColor, useChartTheme } from './shared';
import { escapeHtml } from '../../utils/planCalc';

// 项目执行率排行 TOP10（spec 功能 E，项目级）：actual/budget 降序；
// 预算 0 但有支出的项目排末尾、显示「—」（比率无意义不参与排序值）；点击行下钻该项目订单列表
export default function ExecutionRankChart({ plan }: { plan: PlanData | null }) {
  const nav = useNavigate();
  const { isDark, isMobile, themeName, pal } = useChartTheme();

  const rated = useMemo(() => {
    const items = (plan?.sections ?? []).flatMap((s) => s.items ?? []);
    return items
      .filter((i) => i.budget_amount > 0 || i.actual_amount > 0)
      .map((i) => ({
        id: i.id,
        name: i.name,
        rate: i.budget_amount > 0 ? i.actual_amount / i.budget_amount : null,
      }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
      .slice(0, 10);
  }, [plan]);

  const option = useMemo(() => {
    const maxRate = Math.max(1.2, ...rated.map((r) => r.rate ?? 0)) * 1.08;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = rated[p.dataIndex];
          if (!r) return '';
          const rateText = r.rate === null ? '—' : Math.round(r.rate * 100) + '%';
          return `${escapeHtml(r.name)}<br/>执行率 ${rateText}`;
        },
      },
      grid: { left: isMobile ? 84 : 110, right: isMobile ? 34 : 56, top: 12, bottom: 30 },
      xAxis: { type: 'value', max: maxRate, axisLabel: { formatter: (v: number) => Math.round(v * 100) + '%' } },
      yAxis: { type: 'category', inverse: true, data: rated.map((r) => r.name) },
      series: [{
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: rated.map((r) => ({
          value: r.rate ?? 0,
          itemStyle: { color: r.rate === null ? pal.neutral : executionColor(r.rate, isDark) },
          label: {
            show: true,
            position: 'right',
            formatter: r.rate === null ? '—' : Math.round(r.rate * 100) + '%',
            color: r.rate === null ? pal.neutral : executionColor(r.rate, isDark),
            fontSize: 11,
            fontWeight: 600,
          },
        })),
      }],
    };
  }, [rated, isDark, isMobile, pal]);

  return (
    <ChartCard
      title="项目执行率排行（TOP10）"
      isEmpty={rated.length === 0}
      emptyText="清单还没有项目"
    >
      <ReactECharts
        option={option}
        theme={themeName}
        notMerge
        style={{ height: 300 }}
        onEvents={{
          click: (p: { dataIndex: number }) => {
            const item = rated[p.dataIndex];
            if (item) nav(`/orders?item_id=${item.id}`);
          },
        }}
      />
    </ChartCard>
  );
}
