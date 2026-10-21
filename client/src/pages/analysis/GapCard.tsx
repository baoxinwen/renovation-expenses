import { Card, Empty } from 'antd';
import type { Summary } from '../../api';
import { fmtMoney } from '../../format';

// 剩余预算缺口分析卡（spec 功能 H，现金流口径，公式推导见 spec 第 3 章）：
// 剩余可用 = total_budget − (actual_total + unassigned_paid)——已花含未挂项目付款，与月度趋势一致
// 剩余要花 = plan_total − actual_total——已买项实付偏差与未买项已付定金均被该式自动正确处理
// 缺口 = 剩余要花 − 剩余可用：> 0 钱不够（红）/ ≤ 0 有富余（绿）
export default function GapCard({ summary }: { summary: Summary | null }) {
  const budget = summary?.total_budget ?? 0;
  const cashSpent = (summary?.actual_total ?? 0) + (summary?.unassigned_paid ?? 0);
  const remainingBudget = budget - cashSpent;
  const remainingToSpend = (summary?.plan_total ?? 0) - (summary?.actual_total ?? 0);
  const gap = remainingToSpend - remainingBudget;

  if (budget === 0) {
    return (
      <Card title="剩余预算缺口" size="small">
        <Empty description="先设置预算目标后查看缺口分析" style={{ padding: 24 }} />
      </Card>
    );
  }

  const gapColor = gap > 0 ? 'var(--clay)' : 'var(--sage)';

  return (
    <Card title="剩余预算缺口" size="small">
      <GapRow label="剩余可用（预算 − 已花）" value={remainingBudget} />
      <GapRow label="剩余要花（未落实项目预算）" value={remainingToSpend} />
      <div style={{ borderTop: '1px dashed var(--line, #e8e1d8)', margin: '4px 0' }} />
      <GapRow label={gap > 0 ? '缺口（钱不够）' : '富余（还够花）'} value={gap} color={gapColor} />
    </Card>
  );
}

function GapRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}>
      <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{label}</span>
      <span className="tabular" style={{ fontSize: 16, fontWeight: 600, color }}>{fmtMoney(value)}</span>
    </div>
  );
}
