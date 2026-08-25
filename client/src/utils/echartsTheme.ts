import * as echarts from 'echarts';

/**
 * 居家暖木 · ECharts 主题（亮/暗）
 * 语义色：预算=浅木、实际=深木（亮）/亮木（暗），随主题返回
 */
const base = (dark: boolean) => {
  const ink = dark ? '#ede7df' : '#2b2622';
  const ink2 = dark ? '#a79c90' : '#6b6259';
  const line = dark ? '#3a342e' : '#e8e1d8';
  const surface = dark ? '#332d28' : '#ffffff';
  return { ink, ink2, line, surface };
};

function register(dark: boolean) {
  const c = base(dark);
  const name = dark ? 'warmwood-dark' : 'warmwood-light';
  if (registered.has(name)) return name;
  registered.add(name);
  // canvas 不支持 CSS 的 inherit 关键字，必须显式给字体栈
  const FONT = '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  echarts.registerTheme(name, {
    color: [
      dark ? '#c89b72' : '#8c5e3c',
      dark ? '#9bac8e' : '#7a8b6f',
      dark ? '#d9a55c' : '#c08a3e',
      dark ? '#d97b55' : '#b5542d',
      dark ? '#6e523a' : '#c9ad93',
      c.ink2,
    ],
    backgroundColor: 'transparent',
    textStyle: { color: c.ink, fontFamily: FONT },
    title: { textStyle: { color: c.ink, fontFamily: FONT }, subtextStyle: { color: c.ink2 } },
    legend: { textStyle: { color: c.ink2, fontFamily: FONT } },
    axisPointer: { lineStyle: { color: c.line } },
    tooltip: {
      backgroundColor: c.surface,
      borderColor: c.line,
      borderWidth: 1,
      textStyle: { color: c.ink, fontSize: 12, fontFamily: FONT },
      extraCssText: 'box-shadow: 0 2px 8px rgba(43,38,34,0.08); border-radius: 8px;',
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: c.line } },
      axisTick: { lineStyle: { color: c.line } },
      axisLabel: { color: c.ink2, fontFamily: FONT },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisLabel: { color: c.ink2, fontFamily: FONT },
      splitLine: { lineStyle: { color: c.line } },
    },
  });
  return name;
}

const registered = new Set<string>();

export function chartThemeName(isDark: boolean): string {
  return register(isDark);
}

/** 语义色：预算 vs 实际的成对色 */
export function chartColors(isDark: boolean) {
  return {
    budget: isDark ? '#6e523a' : '#c9ad93',
    actual: isDark ? '#c89b72' : '#8c5e3c',
  };
}
