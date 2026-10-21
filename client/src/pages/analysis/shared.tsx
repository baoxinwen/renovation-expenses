import { useMemo } from 'react';
import { Card, Empty } from 'antd';
import type { ReactNode } from 'react';
import { paletteFor } from '../../styles/palette';
import { chartThemeName, chartColors } from '../../utils/echartsTheme';
import { useThemeModeCtx } from '../../App';

// 图表 Y 轴万元缩写（原 Analysis 内联函数迁入，多图共用）
export const fmtAxisWan = (v: number) => (v >= 10000 ? v / 10000 + '万' : String(v));

// 执行率语义色板（全站 sage=健康 / amber=预警 / clay=超支；neutral 中性灰供热力图退款日）。
// echarts 走 canvas 不识别 CSS 变量，必须按亮暗取具体色值；
// paletteFor 每次返回新对象，必须 memo，否则下游 option 的 useMemo 全部失效（旧 Analysis 既有教训）
export function executionPalette(isDark: boolean) {
  const p = paletteFor(isDark);
  return {
    ok: p.chart[1],
    warn: p.chart[2],
    over: p.chart[3],
    neutral: p.ink2,
    line: p.line,
  };
}

// 执行率着色阈值（与板块汇总表/项目排行既有口径一致）：>100% 红 / ≥90% 橙 / 其余绿
export function executionColor(pct: number, isDark: boolean) {
  const pal = executionPalette(isDark);
  return pct > 1 ? pal.over : pct >= 0.9 ? pal.warn : pal.ok;
}

// 图表主题一次取齐：主题名 + 语义色对（预算/实际）+ 执行率色板（memo 过），各图表组件共用
export function useChartTheme() {
  const { isDark } = useThemeModeCtx();
  const themeName = useMemo(() => chartThemeName(isDark), [isDark]);
  const colors = useMemo(() => chartColors(isDark), [isDark]);
  const pal = useMemo(() => executionPalette(isDark), [isDark]);
  return { isDark, themeName, colors, pal };
}

// 图表卡片统一包装：空态展示全站 Empty 风格，非空渲染 children（图高度由 children 自带 style 控制）。
// title 支持 ReactNode：饼图卡片头内嵌预算/实际切换开关
export function ChartCard({ title, isEmpty, emptyText, children }: {
  title: ReactNode;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <Card title={title} size="small">
      {isEmpty ? <Empty description={emptyText} style={{ padding: 32 }} /> : children}
    </Card>
  );
}
