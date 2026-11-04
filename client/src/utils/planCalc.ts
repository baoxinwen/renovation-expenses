// 预算清单与统计页的可测纯逻辑（从组件中抽出，渲染层保持薄壳）。
// 口径注释随各函数；全部为无副作用纯函数，Node 环境可直接测试。
// 注：不 import pages/ 下任何模块（utils 不得反向依赖页面层，避免循环）。
import type { Item } from '../api';
import { paletteFor } from '../styles/palette';

/** 万元缩写：echarts 轴标签用（>=10000 显示 X万） */
export const fmtAxisWan = (v: number) => (v >= 10000 ? v / 10000 + '万' : String(v));

/** HTML 转义：echarts tooltip formatter 的返回值按 HTML 渲染，项目名等来自
 *  Excel 导入的用户输入必须先转义——`<img onerror=…>` 之类标签会在应用
 *  origin 内执行（r2 C3）。与新工具相同的原则：拼 HTML 的用户输入一律过这里。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 轴/饼图标签截断（r2 M11）：长项目名在窄屏 canvas 上被静默裁切，主动按
 *  宽度截断加省略号；tooltip 用全文，截断只影响轴标签。 */
export function truncateLabel(s: string, max = 8): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 执行率语义色板（全站 sage=健康 / amber=预警 / clay=超支；neutral/line 供热力图等场景）。
 *  echarts 走 canvas 不识别 CSS 变量，必须按亮暗取具体色值；
 *  paletteFor 每次返回新对象，消费侧必须 memo（旧 Analysis 既有教训） */
export function executionPalette(dark: boolean) {
  const p = paletteFor(dark);
  return {
    ok: p.chart[1],
    warn: p.chart[2],
    over: p.chart[3],
    neutral: p.ink2,
    line: p.line,
  };
}

/** 执行率着色阈值（与板块汇总表/项目排行既有口径一致）：>100% 红 / ≥90% 橙 / 其余绿 */
export function executionColor(pct: number, dark: boolean): string {
  const pal = executionPalette(dark);
  return pct > 1 ? pal.over : pct >= 0.9 ? pal.warn : pal.ok;
}

/** 饼图数据：指定口径下过滤 0 值板块（0 值不出扇区） */
export function pieData(sections: { name: string; budget: number; actual: number }[], mode: 'budget' | 'actual') {
  return sections.filter((s) => s[mode] > 0).map((s) => ({ name: s.name, value: s[mode] }));
}

/** 热力图分位阈值：随数据自适应的三档分界（q50/q90），大小金额悬殊时仍可读 */
export function heatLevels(amounts: number[]): { q50: number; q90: number } {
  const sorted = [...amounts].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { q50: q(0.5), q90: q(0.9) };
}

/** 清单搜索过滤：项目名/规格/备注任一命中（大小写不敏感） */
export function matchSearch(it: Pick<Item, 'name' | 'spec' | 'note'>, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return it.name.toLowerCase().includes(t)
    || it.spec.toLowerCase().includes(t)
    || it.note.toLowerCase().includes(t);
}
