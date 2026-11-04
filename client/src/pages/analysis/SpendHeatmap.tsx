import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { heatLevels } from '../../utils/planCalc';
import { ChartCard, useChartTheme } from './shared';

// 花费日历热力图（spec 功能 J，Could）：GitHub 风格周格子，数据源 by_day（与 by_month 同口径按日分组）。
// 色深随当日金额递增；净额为负（退款日）或零用中性灰（spec J-1，不与有支出日混同）
export default function SpendHeatmap({ charts }: { charts: Charts | null }) {
  const { isMobile, themeName, pal } = useChartTheme();
  const byDay = charts?.by_day ?? [];

  const active = useMemo(() => byDay.filter((d) => d.amount > 0).map((d) => d.amount), [byDay]);
  const levels = useMemo(() => heatLevels(active), [active]);
  const range = useMemo(() => {
    if (!byDay.length) return [];
    const months = [...new Set(byDay.map((d) => d.date.slice(0, 7)))];
    // 手机上多月日历每格只剩几像素、月标签叠字——只看最近两个月，格子宽到
    // 可读；桌面保持数据全跨度（范围外的日历格不渲染，无越界风险）
    if (isMobile && months.length > 2) return months.slice(-2);
    return [months[0], months[months.length - 1]];
  }, [byDay, isMobile]);

  const option = useMemo(() => {
    if (!active.length) return {};
    // 分位阈值随数据自适应（计算在 planCalc.heatLevels，可测），热力层次在大小金额悬殊时仍可读
    const { q50, q90 } = levels;
    return {
      tooltip: {
        formatter: (p: { value: [string, number] }) => `${p.value[0]}<br/>${fmtMoney(p.value[1])}`,
      },
      visualMap: {
        type: 'piecewise',
        show: false,
        pieces: [
          { max: 0, color: pal.neutral },          // 无支出 / 退款负数日
          { min: 0.01, max: q50, color: pal.ok },
          { gt: q50, lte: q90, color: pal.warn },
          { gt: q90, color: pal.over },
        ],
      },
      calendar: {
        top: 40,
        left: 40,
        right: 16,
        cellSize: ['auto', 16],
        range,
        itemStyle: { color: 'transparent', borderWidth: 2, borderColor: 'transparent' },
        yearLabel: { show: false },
        monthLabel: { color: pal.neutral, fontSize: 11 },
        dayLabel: {
          color: pal.neutral, fontSize: 10,
          nameMap: ['日', '一', '二', '三', '四', '五', '六'],
        },
        splitLine: { show: true, lineStyle: { color: pal.line, width: 1 } },
      },
      series: [{
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: byDay.map((d) => [d.date, d.amount]),
      }],
    };
  }, [byDay, active, range, pal, levels]);

  return (
    <ChartCard
      title="花费日历"
      isEmpty={active.length === 0}
      emptyText="还没有付款记录——到订单页记第一笔定金"
    >
      <ReactECharts option={option} theme={themeName} notMerge style={{ height: 200 }} />
    </ChartCard>
  );
}
