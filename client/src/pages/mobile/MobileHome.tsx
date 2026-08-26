import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Empty, Skeleton, Space } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Order, PlanData } from '../../api';
import { fmtMoney } from '../../format';
import WoodProgress from '../../components/WoodProgress';
import AnimatedMoney from '../../components/AnimatedMoney';
import QuickPayModal from '../../components/QuickPayModal';

/** 移动首页：预算健康 + 待付尾款（行内记款） */
export default function MobileHome() {
  const nav = useNavigate();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [unpaid, setUnpaid] = useState<Order[]>([]);
  const [payTarget, setPayTarget] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, orders] = await Promise.all([api.getPlan(), api.getOrders({ status: 'open' })]);
      setPlan(p);
      setUnpaid(orders.filter((o) => (o.paid ?? 0) < o.total_amount && o.total_amount > 0));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!plan) return <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>;

  const diff = plan.plan_total - plan.total_budget;
  const overBudget = plan.total_budget > 0 && diff > 0;
  const allItems = plan.sections.flatMap((s) => s.items ?? []);
  const bought = allItems.filter((i) => i.bought || i.actual_amount > 0).length;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card styles={{ body: { padding: 16 } }}>
        <div className="label-caption">预算健康 · 清单总计</div>
        <AnimatedMoney value={plan.plan_total} style={{ fontSize: 30, color: 'var(--ink)', display: 'block', marginTop: 4 }} />
        <div style={{ margin: '10px 0 6px' }}>
          <WoodProgress value={plan.plan_total} budget={plan.total_budget} size="lg" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="label-caption">目标 {fmtMoney(plan.total_budget)}</span>
          {plan.total_budget > 0 && (
            <span className="tabular" style={{ fontWeight: 600, color: overBudget ? 'var(--clay)' : 'var(--sage)' }}>
              {overBudget ? `超支 ${fmtMoney(diff)}` : `结余 ${fmtMoney(-diff)}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>
            <div className="label-caption">实际已花</div>
            <div className="tabular" style={{ fontWeight: 650, fontSize: 16 }}>{fmtMoney(plan.actual_total)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="label-caption">已落实</div>
            <div className="num-display" style={{ fontSize: 16 }}>{bought}<span style={{ fontSize: 12, color: 'var(--ink-3)' }}> / {allItems.length} 项</span></div>
          </div>
        </div>
      </Card>

      <Card
        title={<span style={{ fontSize: 15 }}>待付尾款 <span style={{ color: 'var(--clay)' }}>{unpaid.length ? `· ${unpaid.length} 笔` : ''}</span></span>}
        styles={{ body: { padding: '4px 12px 12px' } }}
      >
        {unpaid.length === 0 ? (
          <Empty description="没有待付尾款" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 12 }} />
        ) : (
          unpaid.map((o) => (
            <div
              key={o.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--line)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }} onClick={() => nav(`/orders/${o.id}`)}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {o.item_name || '未关联项目'} · 未付 <span className="tabular" style={{ color: 'var(--clay)', fontWeight: 600 }}>{fmtMoney(o.total_amount - (o.paid ?? 0))}</span>
                </div>
              </div>
              <Button size="small" onClick={() => setPayTarget(o)}>记一笔</Button>
            </div>
          ))
        )}
      </Card>

      <Card styles={{ body: { padding: 14 } }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button block size="large" onClick={() => nav('/record')}>＋ 记一笔</Button>
          <Button block size="large" onClick={() => nav('/items')}>看清单</Button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <Button type="link" size="small" onClick={() => nav('/analysis')}>查看统计图表</Button>
        </div>
      </Card>

      <QuickPayModal order={payTarget} onClose={() => setPayTarget(null)} onDone={load} />
    </Space>
  );
}
