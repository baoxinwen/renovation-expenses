/**
 * 木嵌预算条（签名元素）
 * 浅木色凹槽 + CSS 木纹填充；超支变陶土色并在槽右端出现溢出刻度。
 * 纯 CSS 变量驱动，亮暗模式自动适配。
 */
export default function WoodProgress({ value, budget, size = 'md' }: {
  value: number;   // 已花
  budget: number;  // 预算
  size?: 'sm' | 'md' | 'lg';
}) {
  const hasBudget = budget > 0;
  const over = hasBudget && value > budget;
  const pct = hasBudget ? Math.min(100, (value / budget) * 100) : 0;

  const heights = { sm: 6, md: 10, lg: 16 } as const;
  const h = heights[size];

  if (!hasBudget) {
    return (
      <div
        aria-label="未设预算"
        style={{ height: h, borderRadius: h / 2, background: 'var(--surface-2)' }}
      />
    );
  }

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        position: 'relative',
        height: h,
        borderRadius: h / 2,
        background: 'var(--wood-50)',
        boxShadow: 'inset 0 1px 2px rgba(43,38,34,0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: h / 2,
          transition: 'width 400ms var(--ease-out), background-color 240ms var(--ease-out)',
          background: over
            ? 'repeating-linear-gradient(45deg, var(--clay) 0 6px, color-mix(in srgb, var(--clay) 88%, #000) 6px 12px)'
            : 'repeating-linear-gradient(45deg, var(--wood-600) 0 6px, color-mix(in srgb, var(--wood-600) 86%, #fff) 6px 12px)',
        }}
      />
      {over && (
        // 溢出刻度：槽右端的警戒标记
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 4,
            borderRadius: 2,
            background: 'var(--clay)',
          }}
        />
      )}
    </div>
  );
}
