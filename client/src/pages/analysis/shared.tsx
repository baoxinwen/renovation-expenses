import { useMemo } from 'react';
import { Card, Empty } from 'antd';
import type { ReactNode } from 'react';
import { chartThemeName, chartColors } from '../../utils/echartsTheme';
import { executionColor, executionPalette } from '../../utils/planCalc';
import { useThemeModeCtx } from '../../App';
import { useIsMobile } from '../../hooks/useIsMobile';
import TypeReveal from '../../components/TypeReveal';

// 图表 Y 轴万元缩写（原 Analysis 内联函数迁入，多图共用）
export const fmtAxisWan = (v: number) => (v >= 10000 ? v / 10000 + '万' : String(v));

// 执行率语义色与着色阈值的定义已收敛至 utils/planCalc（可测纯逻辑），
// 此处 re-export 保持既有 import 路径不变
export { executionPalette, executionColor };

// 图表主题一次取齐：主题名 + 语义色对（预算/实际）+ 执行率色板（memo 过）+ 断点，
// 各图表组件共用——isMobile 供 grid 边距/日历范围做窄屏响应（canvas 内无法用 CSS）
export function useChartTheme() {
  const { isDark } = useThemeModeCtx();
  const isMobile = useIsMobile();
  const themeName = useMemo(() => chartThemeName(isDark), [isDark]);
  const colors = useMemo(() => chartColors(isDark), [isDark]);
  const pal = useMemo(() => executionPalette(isDark), [isDark]);
  return { isDark, isMobile, themeName, colors, pal };
}

// 图表卡片统一包装：空态展示全站 Empty 风格，非空渲染 children（图高度由 children 自带 style 控制）。
// title 支持 ReactNode；纯字符串标题走流式打字（铁律 4），复合节点（如饼图卡头含切换开关）原样渲染。
// 画布图对读屏是不可见的——卡体包 role="img" + 名称（默认取标题），读屏至少知道这里有什么图
export function ChartCard({ title, isEmpty, emptyText, children, ariaLabel }: {
  title: ReactNode;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
  /** 画布的读屏名称；缺省用字符串标题（复合标题的卡片应显式传入） */
  ariaLabel?: string;
}) {
  const shown = typeof title === 'string' ? <TypeReveal text={title} /> : title;
  const describedBy = ariaLabel ?? (typeof title === 'string' ? title : '图表');
  return (
    <Card title={shown} size="small" styles={{ body: { overflow: 'hidden' } }}>
      {isEmpty
        ? <Empty description={emptyText} style={{ padding: 32 }} />
        : <div role="img" aria-label={describedBy}>{children}</div>}
    </Card>
  );
}
