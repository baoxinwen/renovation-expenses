import { Card, Empty } from 'antd';
import type { Summary } from '../../api';
import { fmtMoney } from '../../format';
import { spendablePool } from '../../utils/budgetCalc';
import WoodProgress from '../../components/WoodProgress';

// 剩余预算缺口分析卡（spec 功能 H，现金流口径）：公式收敛至 budgetCalc.spendablePool
// （与清单页可花池提示条同一出处，消除双实现漂移）；推导细节见该文件注释。
// 预算健康度仪表盘（spec C）已并入本卡：顶部消耗进度条 + 已用百分比——单一
// 百分比的可视化与三行数字同源，独立成卡只有装饰价值（r2 B3）
export default function GapCard({ summary }: { summary: Summary | null }) {
  const budget = summary?.total_budget ?? 0;
  const cashSpent = (summary?.actual_total ?? 0) + (summary?.unassigned_paid ?? 0);
  const remainingBudget = budget - cashSpent;
  const remainingToSpend = (summary?.plan_total ?? 0) - (summary?.actual_total ?? 0);
  const { gap } = summary && budget > 0 ? spendablePool(summary) : { gap: 0 };
  const pct = budget > 0 ? Math.round((cashSpent / budget) * 100) : null;

  if (budget === 0) {
    return (
      <Card title="剩余预算缺口" size="small" style={CARD_FILL} styles={{ body: CARD_BODY_EVENLY }}>
        <Empty description="先设置预算目标后查看缺口分析" style={{ padding: 24 }} />
      </Card>
    );
  }

  const gapColor = gap > 0 ? 'var(--clay)' : 'var(--sage)';

  return (
    <Card title="剩余预算缺口" size="small" style={CARD_FILL} styles={{ body: CARD_BODY_EVENLY }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
          <span>已花 {fmtMoney(cashSpent)} / 目标 {fmtMoney(budget)}（含未挂项目付款）</span>
          <span className="tabular" style={{ fontWeight: 600, color: pct !== null && pct > 100 ? 'var(--clay)' : undefined }}>已用 {pct}%</span>
        </div>
        <WoodProgress value={cashSpent} budget={budget} size="md" />
      </div>
      <div style={{ borderTop: '1px dashed var(--line, #e8e1d8)', margin: '12px 0 4px' }} />
      <GapRow label="剩余可用（预算 − 累计支出）" value={remainingBudget} />
      <GapRow label="剩余要花（未落实项目预算）" value={remainingToSpend} />
      <div style={{ borderTop: '1px dashed var(--line, #e8e1d8)', margin: '4px 0' }} />
      <GapRow label={gap > 0 ? '缺口（钱不够）' : '富余（还够花）'} value={gap} color={gapColor} />
    </Card>
  );
}

// 与同行健康度卡等高：Card 拉满 Col 高度，数字行 space-evenly 均匀撑满卡身（不留大片空白）
const CARD_FILL: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column' };
const CARD_BODY_EVENLY: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' };

function GapRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}>
      <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{label}</span>
      <span className="tabular" style={{ fontSize: 16, fontWeight: 600, color }}>{fmtMoney(value)}</span>
    </div>
  );
}
