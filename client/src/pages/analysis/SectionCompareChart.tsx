import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { ChartCard, executionColor, fmtAxisWan, useChartTheme } from './shared';

// 板块预算 vs 实际横向分组条形图（spec 功能 B，数据源 by_section）：
// 预算浅木 / 实际深木全站色板；实际条端执行率标签按阈值着色（预算 0 显示「—」，与汇总表口径一致）
export default function SectionCompareChart({ charts }: { charts: Charts | null }) {
  const { isDark, themeName, colors, pal } = useChartTheme();
  const neutral = pal.neutral;
  const sections = charts?.by_section ?? [];

  const option = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtMoney(v) },
    legend: { top: 0 },
    grid: { left: 90, right: 64, top: 30, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { formatter: fmtAxisWan } },
    yAxis: { type: 'category', inverse: true, data: sections.map((s) => s.name) },
    series: [
      {
        name: '预算', type: 'bar', barMaxWidth: 14,
        itemStyle: { color: colors.budget, borderRadius: [0, 4, 4, 0] },
        data: sections.map((s) => s.budget),
      },
      {
        name: '实际', type: 'bar', barMaxWidth: 14,
        itemStyle: { color: colors.actual, borderRadius: [0, 4, 4, 0] },
        data: sections.map((s) => {
          const pct = s.budget > 0 ? s.actual / s.budget : null;
          return {
            value: s.actual,
            // 预算 0 → 执行率无意义，显示中性「—」（spec B-2，与汇总表口径一致）
            label: pct === null
              ? { show: true, position: 'right', formatter: '—', color: neutral, fontSize: 11 }
              : {
                  show: true,
                  position: 'right',
                  formatter: () => Math.round(pct * 100) + '%',
                  color: executionColor(pct, isDark),
                  fontSize: 11,
                  fontWeight: 600,
                },
          };
        }),
      },
    ],
  }), [sections, colors, isDark]);

  return (
    <ChartCard title="板块对比：预算 vs 实际" isEmpty={sections.length === 0} emptyText="清单还没有项目">
      <ReactECharts option={option} theme={themeName} notMerge style={{ height: 320 }} />
    </ChartCard>
  );
}
